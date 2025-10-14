// src/pipeline.js
import { Reading, Display } from "./models.js";
// import { getRecentEmails } from "./email.js";  // <-- not needed anymore
import { buildDisplayWithGemini } from "./gemini.js";
import { getPlantName, getNotifyEmail } from "./deviceCache.js"; // <-- add getNotifyEmail
import { sendGeneratedEmail } from "./mailer.js";

const INTERVAL = Number(process.env.LLM_INTERVAL_MS || 60000);
let lastGeminiAt = 0;

export async function handleSensorMessage({ msg, mqttClient, topics, geminiKey }) {
  // 1) Persist reading
  await Reading.create({
    ts: new Date(msg.ts), deviceId: msg.deviceId,
    t_c: msg.t_c, h_pct: msg.h_pct, soil_pct: msg.soil_pct
  });

  const now = Date.now();
  if (now - lastGeminiAt < INTERVAL) return;
  lastGeminiAt = now;

  const plantName = getPlantName(msg.deviceId) || "";
  // no emails passed in; Gemini will generate one
  const displayPayload = await buildDisplayWithGemini(geminiKey, { ...msg, plantName }, []);

  // publish to device
  mqttClient.publish(topics.out, JSON.stringify(displayPayload), { qos: 1, retain: true });

  // persist display
  await Display.create({ ts: new Date(displayPayload.ts), deviceId: msg.deviceId, payload: displayPayload });

  // send email (if model provided it)
  const first = displayPayload.emails?.[0];
  if (first?.subject && (first.summary || first.body)) {
    const toOverride = getNotifyEmail(msg.deviceId) || undefined; // <-- use per-device email if set
    const body = first.summary || first.body;
    try {
      await sendGeneratedEmail({ subject: first.subject, body, to: toOverride });
    } catch (e) {
      console.error("[mail] send failed:", e.message);
    }
  }
}