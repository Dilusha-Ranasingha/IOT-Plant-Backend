// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectMongo, Device, Display, Reading } from "./models.js"; // get Display, Reading here
import { connectMqtt } from "./mqtt.js";
import { startEmailFetcher } from "./email.js";
import { handleSensorMessage } from "./pipeline.js";
import { warmDeviceCache, setPlantName, getPlantName, setNotifyEmail, getNotifyEmail } from "./deviceCache.js";
import { initMailer } from "./mailer.js";

const {
  MQTT_URL, MQTT_USER, MQTT_PASS, DEVICE_ID,
  MONGODB_URI, GEMINI_API_KEY,
  IMAP_HOST, IMAP_PORT, IMAP_SECURE, IMAP_USER, IMAP_PASS,
  PORT
} = process.env;

console.log("[env] GEMINI_API_KEY set:", GEMINI_API_KEY ? (GEMINI_API_KEY.slice(0,6)+"***") : "NO");

const topics = {
  in:  `plant/sensors/${DEVICE_ID}`,
  out: `plant/device/${DEVICE_ID}/display`,
  will:`plant/alerts/${DEVICE_ID}`
};

// --- Simple API server ---
const app = express();
app.use(express.json());

// set/update plant name for a device
app.post("/api/device/:id/plant", async (req, res) => {
  const deviceId = req.params.id;
  const { plantName } = req.body || {};
  if (!plantName || !plantName.trim()) {
    return res.status(400).json({ ok: false, error: "plantName required" });
  }
  const doc = await Device.findOneAndUpdate(
    { deviceId },
    { $set: { plantName: plantName.trim() } },
    { upsert: true, new: true }
  );
  setPlantName(deviceId, doc.plantName);
  return res.json({ ok: true, deviceId, plantName: doc.plantName });
});

// NEW: set/update notify email for a device
app.post("/api/device/:id/notify-email", async (req, res) => {
  const deviceId = req.params.id;
  const { email } = req.body || {};
  if (!email || !email.trim()) {
    return res.status(400).json({ ok: false, error: "email required" });
  }
  const doc = await Device.findOneAndUpdate(
    { deviceId },
    { $set: { notifyEmail: email.trim() } },
    { upsert: true, new: true }
  );
  setNotifyEmail(deviceId, doc.notifyEmail);
  return res.json({ ok: true, deviceId, notifyEmail: doc.notifyEmail });
});

// NEW: get current notify email
app.get("/api/device/:id/notify-email", async (req, res) => {
  const deviceId = req.params.id;
  const cached = getNotifyEmail(deviceId);
  if (cached) return res.json({ ok: true, deviceId, notifyEmail: cached });

  const doc = await Device.findOne({ deviceId }).lean();
  return res.json({ ok: true, deviceId, notifyEmail: doc?.notifyEmail || "" });
});

// health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use(cors({ origin: "http://localhost:5173" })); // your frontend origin


// ---- data reading APIs for dashboard ----

// current plant name (uses cache, falls back to DB)
app.get("/api/device/:id/plant", async (req, res) => {
  const deviceId = req.params.id;
  const cached = getPlantName(deviceId);
  if (cached) return res.json({ ok: true, deviceId, plantName: cached });

  const doc = await Device.findOne({ deviceId }).lean();
  return res.json({ ok: true, deviceId, plantName: doc?.plantName || "" });
});

// latest display payload (what was last sent to the device)
app.get("/api/device/:id/display/latest", async (req, res) => {
  const deviceId = req.params.id;
  const doc = await Display.findOne({ deviceId }).sort({ createdAt: -1 }).lean();
  if (!doc) return res.status(404).json({ ok: false, error: "no display yet" });
  // Return exactly what front-end needs; include timestamps for charts
  return res.json({
    ok: true,
    deviceId,
    createdAt: doc.createdAt,
    ts: doc.ts,
    payload: doc.payload
  });
});

// recent display history (default: 20)
app.get("/api/device/:id/displays", async (req, res) => {
  const deviceId = req.params.id;
  const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
  const docs = await Display.find({ deviceId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return res.json({
    ok: true,
    deviceId,
    count: docs.length,
    items: docs.map(d => ({
      createdAt: d.createdAt,
      ts: d.ts,
      payload: d.payload
    }))
  });
});

// recent sensor readings (default: 50)
app.get("/api/device/:id/readings", async (req, res) => {
  const deviceId = req.params.id;
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 500);
  const docs = await Reading.find({ deviceId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return res.json({
    ok: true,
    deviceId,
    count: docs.length,
    items: docs.map(r => ({
      createdAt: r.createdAt,
      ts: r.ts,
      t_c: r.t_c,
      h_pct: r.h_pct,
      soil_pct: r.soil_pct
    }))
  });
});

const httpPort = Number(PORT || 3000);
app.listen(httpPort, () => console.log(`[api] listening on http://localhost:${httpPort}`));

// --- Main runtime ---
(async () => {
  await connectMongo(MONGODB_URI);
  await warmDeviceCache(DEVICE_ID);

  await initMailer(); // will log [mail] smtp ready if creds loaded

  // only run if all IMAP creds exist (you’re not reading inbox anyway)
  if (IMAP_HOST && IMAP_USER && IMAP_PASS) {
    await startEmailFetcher({
      host: IMAP_HOST, port: IMAP_PORT, secure: IMAP_SECURE,
      user: IMAP_USER, pass: IMAP_PASS
    });
  } else {
    console.log("[email] fetcher skipped (no IMAP creds)");
  }

  const client = connectMqtt({ url: MQTT_URL, username: MQTT_USER, password: MQTT_PASS, willTopic: topics.will });
  client.on("connect", () => client.subscribe(topics.in, { qos: 1 }, () =>
    console.log("[mqtt] subscribed:", topics.in)));

  client.on("message", async (topic, buf) => {
    if (topic !== topics.in) return;
    let msg;
    try { msg = JSON.parse(buf.toString()); }
    catch { return console.warn("[mqtt] bad JSON"); }
    msg.t_c = Number(msg.t_c ?? 0); msg.h_pct = Number(msg.h_pct ?? 0); msg.soil_pct = Number(msg.soil_pct ?? 0);
    msg.t_c = Math.max(-10, Math.min(60, msg.t_c));
    msg.h_pct = Math.max(0, Math.min(100, msg.h_pct));
    msg.soil_pct = Math.max(0, Math.min(100, msg.soil_pct));

    try {
      await handleSensorMessage({ msg, mqttClient: client, topics, geminiKey: GEMINI_API_KEY });
    } catch (e) {
      console.error("[pipeline] error", e.message);
    }
  });
})();