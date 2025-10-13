import "dotenv/config";
import { connectMongo } from "./models.js";
import { connectMqtt } from "./mqtt.js";
import { startEmailFetcher } from "./email.js";
import { handleSensorMessage } from "./pipeline.js";

const {
  MQTT_URL, MQTT_USER, MQTT_PASS, DEVICE_ID,
  MONGODB_URI, GEMINI_API_KEY,
  IMAP_HOST, IMAP_PORT, IMAP_SECURE, IMAP_USER, IMAP_PASS
} = process.env;

console.log("[env] GEMINI_API_KEY set:", GEMINI_API_KEY ? (GEMINI_API_KEY.slice(0,6)+"***") : "NO");


const topics = {
  in:  `plant/sensors/${DEVICE_ID}`,
  out: `plant/device/${DEVICE_ID}/display`,
  will:`plant/alerts/${DEVICE_ID}`
};

(async () => {
  await connectMongo(MONGODB_URI);
  await startEmailFetcher({
    host: IMAP_HOST, port: IMAP_PORT, secure: IMAP_SECURE,
    user: IMAP_USER, pass: IMAP_PASS
  });

  const client = connectMqtt({ url: MQTT_URL, username: MQTT_USER, password: MQTT_PASS, willTopic: topics.will });
  client.on("connect", () => client.subscribe(topics.in, { qos: 1 }, () =>
    console.log("[mqtt] subscribed:", topics.in)));

  client.on("message", async (topic, buf) => {
    if (topic !== topics.in) return;
    let msg;
    try { msg = JSON.parse(buf.toString()); }
    catch { return console.warn("[mqtt] bad JSON"); }
    // basic validation & clamping
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