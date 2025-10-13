import "dotenv/config.js";
import mqtt from "mqtt";

const { MQTT_URL, MQTT_USER, MQTT_PASS, DEVICE_ID } = process.env;
const TOPIC = `plant/sensors/${DEVICE_ID}`;

const client = mqtt.connect(MQTT_URL, { username: MQTT_USER, password: MQTT_PASS });
client.on("connect", () => {
  console.log("[mock] connected, publishing every 10s →", TOPIC);
  setInterval(() => {
    const now = new Date().toISOString();
    // simple random walk around your example: T=30.8, H=62, Soil=48
    const t = 30.8 + (Math.random()*2-1);
    const h = 62 + (Math.random()*4-2);
    const s = 48 + (Math.random()*8-4);
    const msg = { deviceId: DEVICE_ID, ts: now, t_c: +t.toFixed(1), h_pct: Math.round(h), soil_pct: Math.round(s), fw: "mock-1.0" };
    client.publish(TOPIC, JSON.stringify(msg), { qos: 1 });
    console.log("[mock] →", msg);
  }, 10_000);
});
