// src/pipeline.js
import { Reading, Display } from "./models.js";
import { buildDisplayWithGemini } from "./gemini.js";
import { getPlantName, getNotifyEmail } from "./deviceCache.js";
import { sendGeneratedEmail } from "./mailer.js";

const INTERVAL = Number(process.env.LLM_INTERVAL_MS || 300000); // 5 min default
const WINDOW_MS = Number(process.env.WINDOW_MS || 300000);      // 5 min window
let lastGeminiAt = 0;

// helper: fetch window
async function getWindowReadings(deviceId) {
  const since = new Date(Date.now() - WINDOW_MS);
  const items = await Reading.find({ deviceId, ts: { $gte: since } })
    .sort({ ts: 1 }) // oldest → newest
    .select({ ts: 1, t_c: 1, h_pct: 1, soil_pct: 1, _id: 0 })
    .lean();
  // if nothing in the time window (e.g., just started), fall back to last 30 samples
  if (items.length === 0) {
    return await Reading.find({ deviceId })
      .sort({ ts: -1 })
      .limit(30)
      .select({ ts: 1, t_c: 1, h_pct: 1, soil_pct: 1, _id: 0 })
      .lean()
      .then(arr => arr.reverse());
  }
  return items;
}

export async function handleSensorMessage({ msg, mqttClient, topics, geminiKey }) {
  // 1) Persist reading
  await Reading.create({
    ts: new Date(msg.ts), deviceId: msg.deviceId,
    t_c: msg.t_c, h_pct: msg.h_pct, soil_pct: msg.soil_pct
  });

  // 2) throttle to every INTERVAL
  const now = Date.now();
  if (now - lastGeminiAt < INTERVAL) return;
  lastGeminiAt = now;

  // 3) gather window + context
  const plantName = getPlantName(msg.deviceId) || "";
  const readings = await getWindowReadings(msg.deviceId);
  const latestTs = readings.length ? readings[readings.length - 1].ts : msg.ts;

  // 4) call Gemini with the *window* (not single reading)
  const displayPayload = await buildDisplayWithGemini(geminiKey, {
    plantName,
    readings,
    latestTs
  });

  // 5) publish to device
  mqttClient.publish(topics.out, JSON.stringify(displayPayload), { qos: 1, retain: true });

  // 6) persist sent display
  await Display.create({ ts: new Date(displayPayload.ts), deviceId: msg.deviceId, payload: displayPayload });

  // 7) email — build a helpful body from Gemini + window stats
  const firstEmail = displayPayload.emails?.[0];
  if (firstEmail?.subject) {
    const avg = (arr, k) => arr.length ? arr.reduce((s, r) => s + Number(r[k] || 0), 0) / arr.length : 0;
    const tavg = Math.round(avg(readings, "t_c") * 10) / 10;
    const havg = Math.round(avg(readings, "h_pct"));
    const savg = Math.round(avg(readings, "soil_pct"));
    const first = readings[0] || {};
    const last = readings[readings.length - 1] || {};

    const lines = [
      firstEmail.summary || "",                                   // Gemini’s short summary
      `Advice: ${displayPayload.advice?.reason || "—"}`,
      `Action: ${displayPayload.advice?.water_now ? "WATER now" : "No watering needed"}`,
      `Priority: ${displayPayload.priority || "normal"}`,
      "",
      `Window: ${first.ts || "—"} → ${last.ts || "—"}`,
      `Average: T=${isNaN(tavg)? "—" : tavg}°C, H=${isNaN(havg)? "—" : havg}%, Soil=${isNaN(savg)? "—" : savg}%`,
      `Latest:  T=${last.t_c ?? "—"}°C, H=${last.h_pct ?? "—"}%, Soil=${last.soil_pct ?? "—"}%`,
      "",
      `Quote: ${displayPayload.quote || ""}`
    ];
    const body = lines.filter(Boolean).join("\n");

    try {
      const toOverride = getNotifyEmail(msg.deviceId) || undefined;
      await sendGeneratedEmail({ subject: firstEmail.subject, body, to: toOverride });
    } catch (e) {
      console.error("[mail] send failed:", e.message);
    }
  }
}
