import mqtt from "mqtt";

export function connectMqtt({ url, username, password, willTopic }) {
  const client = mqtt.connect(url, {
    username, password, reconnectPeriod: 2000,
    will: willTopic ? { topic: willTopic, payload: "backend_offline", qos: 1, retain: true } : undefined
  });
  client.on("connect", () => console.log("[mqtt] connected"));
  client.on("reconnect", () => console.log("[mqtt] reconnecting..."));
  client.on("error", (e) => console.error("[mqtt] error", e.message));
  return client;
}