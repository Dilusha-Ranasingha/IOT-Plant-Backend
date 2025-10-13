import { Reading, Display } from "./models.js";
import { getRecentEmails } from "./email.js";
import { buildDisplayWithGemini } from "./gemini.js";

let lastGeminiAt = 0;

export async function handleSensorMessage({ msg, mqttClient, topics, geminiKey }) {
  // 1) Persist reading
  await Reading.create({
    ts: new Date(msg.ts), deviceId: msg.deviceId,
    t_c: msg.t_c, h_pct: msg.h_pct, soil_pct: msg.soil_pct
  });

  // 2) Throttle LLM (every ~10s)
  const now = Date.now();
  if (now - lastGeminiAt < 10_000) return; // 10s during testing
  lastGeminiAt = now;

  // 3) Build display payload via Gemini (+ emails)
  const emails = getRecentEmails(2);
  const displayPayload = await buildDisplayWithGemini(geminiKey, msg, emails);

  // 4) Publish back to device
  mqttClient.publish(topics.out, JSON.stringify(displayPayload), { qos: 1, retain: true });

  // 5) Cache what we sent (optional)
  await Display.create({ ts: new Date(displayPayload.ts), deviceId: msg.deviceId, payload: displayPayload });
}