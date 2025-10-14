// src/deviceCache.js
import { Device } from "./models.js";

const cache = new Map(); // deviceId -> { plantName, notifyEmail }

export async function warmDeviceCache(deviceId) {
  if (!deviceId) return;
  const doc = await Device.findOne({ deviceId });
  if (!doc) return;
  cache.set(deviceId, {
    plantName: doc.plantName || "",
    notifyEmail: doc.notifyEmail || ""
  });
}

export function setPlantName(deviceId, plantName) {
  if (!deviceId) return;
  const cur = cache.get(deviceId) || {};
  cache.set(deviceId, { ...cur, plantName: (plantName || "").trim() });
}

export function setNotifyEmail(deviceId, notifyEmail) {
  if (!deviceId) return;
  const cur = cache.get(deviceId) || {};
  cache.set(deviceId, { ...cur, notifyEmail: (notifyEmail || "").trim() });
}

export function getPlantName(deviceId) {
  return (cache.get(deviceId) || {}).plantName || "";
}

export function getNotifyEmail(deviceId) {
  return (cache.get(deviceId) || {}).notifyEmail || "";
}