/* ===================================================
   AgriWatch — MQTT Custom Subscriber
   Real-time sensor dashboard via Adafruit IO WebSocket
   =================================================== */

// -------- ADAFRUIT IO MQTT CONFIG --------
const AIO_USERNAME = "vince17";
const AIO_KEY      = "aio_mHRb586J17oOxuzoQHaMFnMjCmeG";
const AIO_WS_URL   = "wss://io.adafruit.com/mqtt/";

// Feed keys (must match what the Arduino publisher uses)
const FEEDS = {
  brightness : `${AIO_USERNAME}/f/node1-brightness`,
  temperature: `${AIO_USERNAME}/f/node1-temperature`,
  humidity   : `${AIO_USERNAME}/f/node1-humidity`,
  mode       : `${AIO_USERNAME}/f/node1-mode`,
  warning    : `${AIO_USERNAME}/f/node1-temp-warning`,
};

// -------- DATA STORES --------
const MAX_HISTORY = 30; // points on chart

const sensorData = {
  temperature: { history: [], labels: [], min: Infinity, max: -Infinity, current: null },
  humidity:    { history: [], labels: [], min: Infinity, max: -Infinity, current: null },
  brightness:  { history: [], labels: [], min: Infinity, max: -Infinity, current: null },
};

// -------- DOM REFS --------
const dom = {
  status:     document.getElementById("connection-status"),
  statusText: document.querySelector("#connection-status .status-text"),
  clock:      document.getElementById("clock"),
  nodeMode:   document.getElementById("node-mode"),
  lastUpdate: document.getElementById("last-update"),
  valTemp:    document.getElementById("val-temperature"),
  valHum:     document.getElementById("val-humidity"),
  valBri:     document.getElementById("val-brightness"),
  minTemp:    document.getElementById("min-temperature"),
  maxTemp:    document.getElementById("max-temperature"),
  minHum:     document.getElementById("min-humidity"),
  maxHum:     document.getElementById("max-humidity"),
  minBri:     document.getElementById("min-brightness"),
  maxBri:     document.getElementById("max-brightness"),
  alertBody:  document.getElementById("alert-body"),
  alertIcon:  document.getElementById("alert-icon"),
  alertMsg:   document.getElementById("alert-message"),
  log:        document.getElementById("mqtt-log"),
  clearBtn:   document.getElementById("btn-clear-log"),
};

// -------- CHARTS --------
const chartOptions = (borderColor, bgColor) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 600, easing: "easeOutQuart" },
  plugins: { legend: { display: false } },
  scales: {
    x: { display: false },
    y: {
      display: true,
      ticks: { font: { size: 9, family: "'JetBrains Mono'" }, color: "#64748b", maxTicksLimit: 4 },
      grid: { color: "rgba(255,255,255,0.04)", drawBorder: false },
      border: { display: false },
    },
  },
  elements: {
    point: { radius: 2, hoverRadius: 5, backgroundColor: borderColor },
    line:  { tension: 0.4, borderWidth: 2 },
  },
});

function createChart(canvasId, borderColor, bgColor) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 100);
  gradient.addColorStop(0, bgColor);
  gradient.addColorStop(1, "rgba(0,0,0,0)");

  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: borderColor,
        backgroundColor: gradient,
        fill: true,
      }],
    },
    options: chartOptions(borderColor, bgColor),
  });
}

const charts = {
  temperature: createChart("chart-temperature", "#f87171", "rgba(248,113,113,0.15)"),
  humidity:    createChart("chart-humidity",    "#60a5fa", "rgba(96,165,250,0.15)"),
  brightness:  createChart("chart-brightness",  "#fbbf24", "rgba(251,191,36,0.15)"),
};

// -------- HELPERS --------
function timestamp() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function addLog(message, type = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry log-${type}`;
  entry.textContent = `[${timestamp()}] ${message}`;
  dom.log.appendChild(entry);
  dom.log.scrollTop = dom.log.scrollHeight;

  // Limit log size
  while (dom.log.children.length > 100) {
    dom.log.removeChild(dom.log.firstChild);
  }
}

function setStatus(state, text) {
  dom.status.className = `status-badge ${state}`;
  dom.statusText.textContent = text;
}

function flashValue(el) {
  el.classList.remove("value-updated");
  void el.offsetWidth; // force reflow
  el.classList.add("value-updated");
}

function updateSensorUI(key, value) {
  const numVal = parseFloat(value);
  if (isNaN(numVal)) return;

  const data = sensorData[key];
  data.current = numVal;
  data.min = Math.min(data.min, numVal);
  data.max = Math.max(data.max, numVal);

  // Push to history
  const label = timestamp();
  data.history.push(numVal);
  data.labels.push(label);
  if (data.history.length > MAX_HISTORY) {
    data.history.shift();
    data.labels.shift();
  }

  // Update DOM
  const valEl = key === "temperature" ? dom.valTemp : key === "humidity" ? dom.valHum : dom.valBri;
  valEl.textContent = numVal.toFixed(1);
  flashValue(valEl);

  const minEl = key === "temperature" ? dom.minTemp : key === "humidity" ? dom.minHum : dom.minBri;
  const maxEl = key === "temperature" ? dom.maxTemp : key === "humidity" ? dom.maxHum : dom.maxBri;
  minEl.textContent = `Min: ${data.min.toFixed(1)}`;
  maxEl.textContent = `Max: ${data.max.toFixed(1)}`;

  // Update Chart
  const chart = charts[key];
  chart.data.labels = [...data.labels];
  chart.data.datasets[0].data = [...data.history];
  chart.update("none");

  // Update last-update timestamp
  dom.lastUpdate.textContent = timestamp();
}

function updateMode(value) {
  const mode = value.toString().trim().toUpperCase();
  dom.nodeMode.textContent = mode;
  dom.nodeMode.className = "info-value";

  if (mode === "DAY") {
    dom.nodeMode.classList.add("mode-day");
  } else if (mode === "NIGHT") {
    dom.nodeMode.classList.add("mode-night");
  } else {
    dom.nodeMode.classList.add("mode-unknown");
  }
}

function updateWarning(value) {
  const msg = value.toString().trim().toUpperCase();

  if (msg === "HIGH_TEMP_ALERT") {
    dom.alertBody.className = "alert-body alert-active";
    dom.alertIcon.textContent = "🔴";
    dom.alertMsg.textContent = `HIGH TEMPERATURE ALERT — Temperature ≥ 32°C detected! (${timestamp()})`;
    addLog("⚠ HIGH_TEMP_ALERT received!", "warning");
  } else {
    dom.alertBody.className = "alert-body alert-none";
    dom.alertIcon.textContent = "✅";
    dom.alertMsg.textContent = `Normal — Temperature within safe range. (${timestamp()})`;
  }
}

// -------- MQTT CONNECTION --------
function connectMQTT() {
  setStatus("connecting", "Connecting...");
  addLog("Connecting to Adafruit IO via WebSocket...", "info");

  const clientId = `agriwatch-${Math.random().toString(16).slice(2, 10)}`;

  const client = mqtt.connect(AIO_WS_URL, {
    clientId: clientId,
    username: AIO_USERNAME,
    password: AIO_KEY,
    protocol: "wss",
    reconnectPeriod: 5000,
    keepalive: 60,
  });

  client.on("connect", () => {
    setStatus("connected", "Connected");
    addLog("Connected to Adafruit IO MQTT broker!", "connect");

    // Subscribe to all feeds
    const topics = Object.values(FEEDS);
    topics.forEach((topic) => {
      client.subscribe(topic, { qos: 0 }, (err) => {
        if (!err) {
          addLog(`Subscribed → ${topic}`, "connect");
        } else {
          addLog(`Failed to subscribe to ${topic}: ${err.message}`, "error");
        }
      });
    });
  });

  client.on("message", (topic, message) => {
    const payload = message.toString();
    addLog(`📥 ${topic.split("/").pop()}: ${payload}`, "data");

    // Route message to correct handler
    if (topic === FEEDS.temperature) {
      updateSensorUI("temperature", payload);
    } else if (topic === FEEDS.humidity) {
      updateSensorUI("humidity", payload);
    } else if (topic === FEEDS.brightness) {
      updateSensorUI("brightness", payload);
    } else if (topic === FEEDS.mode) {
      updateMode(payload);
    } else if (topic === FEEDS.warning) {
      updateWarning(payload);
    }
  });

  client.on("reconnect", () => {
    setStatus("connecting", "Reconnecting...");
    addLog("Reconnecting to MQTT broker...", "warning");
  });

  client.on("error", (err) => {
    setStatus("disconnected", "Error");
    addLog(`MQTT error: ${err.message}`, "error");
  });

  client.on("close", () => {
    setStatus("disconnected", "Disconnected");
    addLog("Connection closed.", "error");
  });

  client.on("offline", () => {
    setStatus("disconnected", "Offline");
    addLog("Client went offline.", "error");
  });
}

// -------- CLOCK --------
function updateClock() {
  dom.clock.textContent = new Date().toLocaleTimeString("en-US", { hour12: true });
}
setInterval(updateClock, 1000);
updateClock();

// -------- CLEAR LOG --------
dom.clearBtn.addEventListener("click", () => {
  dom.log.innerHTML = "";
  addLog("Log cleared.", "info");
});

// -------- INIT --------
connectMQTT();
