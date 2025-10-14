// src/gemini.js
import { z } from "zod";

const OutputZ = z.object({
  quote: z.string().max(100),
  emails: z.array(z.object({
    from: z.string(),
    subject: z.string(),
    summary: z.string()
  })).max(1).optional().default([]), // <-- ONLY ONE email now
  priority: z.enum(["low","normal","high"]).default("normal"),
  advice: z.object({
    water_now: z.boolean(),
    reason: z.string()
  })
});

// Model configurable via .env; defaults to flash for speed
const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

// Optional: add/extend per-plant target bands here
const PLANT_BANDS = {
  "snake plant":   { t:[18,30], h:[30,50], soil:[25,40] },
  "peace lily":    { t:[18,27], h:[50,80], soil:[40,55] },
  "pothos":        { t:[18,29], h:[40,60], soil:[35,50] },
  "succulent":     { t:[18,32], h:[20,40], soil:[10,25] },
};

export async function buildDisplayWithGemini(apiKey, sensor/*, emailsNotUsed*/) {
  const { plantName = "" } = sensor;

  // Early fallback if no API key
  if (!apiKey) {
    return {
      ts: sensor.ts,
      quote: "Gentle air, steady roots.",
      emails: [{
        from: "AuraLinkPlant",
        subject: "Plant status update",
        summary: "Fallback mode: basic advice included."
      }],
      priority: sensor.soil_pct < 25 ? "high" : "normal",
      advice: { water_now: sensor.soil_pct < 35, reason: "No Gemini API key; using fallback." }
    };
  }

  const bands = PLANT_BANDS[plantName?.toLowerCase?.() || ""] || null;
  const bandsText = bands ? `
If "${plantName}" is recognized, prefer these ranges:
- Temperature: ${bands.t[0]}–${bands.t[1]} °C
- Humidity: ${bands.h[0]}–${bands.h[1]} %
- Soil: ${bands.soil[0]}–${bands.soil[1]} %
` : "";

  const prompt = `
You are AuraLinkPlant for a tiny desk display.

Plant: ${plantName || "unknown"}.

Return ONLY one JSON object exactly matching:
{
  "quote": string,                                  // <= 60 chars
  "emails": [                                       // EXACTLY 1 item
    {"from": string, "subject": string, "summary": string}  // summary <= 140 chars
  ],
  "priority": "low"|"normal"|"high",
  "advice": {"water_now": boolean, "reason": string}        // <= 90 chars
}

Email requirements:
- Generate EXACTLY ONE email "from": "AuraLinkPlant".
- The email is for the plant owner (single recipient), summarizing current status and an action if needed.
- Do not invent other people ("Alice", "Bob"). No external senders.
- Subject should be concise (<= 60 chars). Summary <= 140 chars.

Sensor values:
- T = ${sensor.t_c} °C, H = ${sensor.h_pct} %, Soil = ${sensor.soil_pct} %.

Fallback interpretation bands (use if plant is unknown):
- Temperature: cool < 20, mild 20–28, warm > 28.
- Humidity: dry < 40, comfy 40–65, humid > 65.
- Soil: dry < 35, optimal 35–45, wet > 45.

Advice rules:
- If Soil < 35: advice.water_now = true; reason includes "dry soil" + a simple action (e.g., "add 50–100 ml").
- If Soil < 25 OR (T > 30 AND Soil < 35): priority = "high".
- If all bands are within mild/comfy/optimal → priority = "normal" and water_now = false.
- If H > 70: suggest "increase airflow"; if T > 32: suggest "move to shade"; if Soil > 60: suggest "pause watering".
- Keep reason compact; include statuses like: "warm, comfy, optimal — no water needed".

Quote style:
- Reflect the environment & plant; under 60 chars; no emojis.

Context:
- Timestamp: ${sensor.ts}

Output: ONLY JSON, no markdown.
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  console.log("[gemini] model:", MODEL);

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }]}],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 256,
      responseMimeType: "application/json"
    }
  };

  let text = "";
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const errTxt = await res.text();
      throw new Error(`gemini status ${res.status} - ${errTxt}`);
    }
    const data = await res.json();
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = OutputZ.parse(JSON.parse(text));
    // Safety override: very dry soil => high priority
    if (sensor.soil_pct < 25) parsed.priority = "high";
    return {
      ts: sensor.ts,
      quote: parsed.quote,
      emails: parsed.emails,     // <= exactly 1 item from prompt
      priority: parsed.priority,
      advice: parsed.advice
    };
  } catch (e) {
    console.error("[gemini] fallback", e.message, "\nraw:", text);
    return {
      ts: sensor.ts,
      quote: "Gentle air, steady roots.",
      emails: [{
        from: "AuraLinkPlant",
        subject: "Plant status (fallback)",
        summary: "Using fallback logic. Check soil and adjust watering."
      }],
      priority: sensor.soil_pct < 25 ? "high" : "normal",
      advice: { water_now: sensor.soil_pct < 35, reason: "Fallback JSON." }
    };
  }
}