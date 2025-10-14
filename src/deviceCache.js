// src/deviceCache.js
import { Device } from "./models.js";

const cache = new Map(); // deviceId -> plantName

export async function warmDeviceCache(deviceId) {
  if (!deviceId) return;
  const doc = await Device.findOne({ deviceId });
  if (doc?.plantName) cache.set(deviceId, doc.plantName);
}

export function setPlantName(deviceId, plantName) {
  if (!deviceId) return;
  if (plantName && plantName.trim()) cache.set(deviceId, plantName.trim());
}

export function getPlantName(deviceId) {
  return cache.get(deviceId) || "";
}
