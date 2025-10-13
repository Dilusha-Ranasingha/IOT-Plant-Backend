import { z } from "zod";

const OutputZ = z.object({
  quote: z.string().max(100),
  emails: z.array(z.object({
    from: z.string(),
    subject: z.string(),
    summary: z.string()
  })).max(2).optional().default([]),
  priority: z.enum(["low","normal","high"]).default("normal"),
  advice: z.object({
    water_now: z.boolean(),
    reason: z.string()
  })
});

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash"; 
// alternatives if needed: "gemini-2.0-flash" or "gemini-2.0-flash-latest"

export async function buildDisplayWithGemini(apiKey, sensor, emails) {
  const emailContext = emails.map(
    e => `From: ${e.from} — Subject: ${e.subject} — Snippet: ${e.snippet}`
  ).join("\n");

  const prompt = `
You are AuraLinkPlant for a tiny desk display.

Return ONLY one JSON object exactly matching:
{
  "quote": string,                        // <= 60 chars, poetic but simple
  "emails": [                             // up to 2 items
    {"from": string, "subject": string, "summary": string} // summary <= 12 words
  ],
  "priority": "low"|"normal"|"high",
  "advice": {"water_now": boolean, "reason": string}       // reason <= 90 chars
}

Hard rules:
- Output MUST be pure JSON (no code fences, no markdown, no extra text).
- Keys lowercase as shown. Maximum 2 emails.
- If an email field is missing, omit that email item completely.

Sensor values:
- T = ${sensor.t_c} °C, H = ${sensor.h_pct} %, Soil = ${sensor.soil_pct} % (0–100).

Interpretation bands (use these words in the reason):
- Temperature: cool < 20, mild 20–28, warm > 28 (use one: "cool"/"mild"/"warm").
- Humidity: dry < 40, comfy 40–65, humid > 65 (use one: "dry"/"comfy"/"humid").
- Soil: dry < 35, optimal 35–45, wet > 45 (use one: "dry"/"optimal"/"wet").

Advice rules:
- If Soil < 35: advice.water_now = true and reason must include "dry soil" and a simple action (e.g., "add 50–100 ml").
- If Soil < 25 OR (T > 30 AND Soil < 35): priority = "high".
- If all bands are within mild/comfy/optimal → priority = "normal" and water_now = false.
- If H > 70: suggest "increase airflow"; if T > 32: suggest "move to shade"; if Soil > 60: suggest "pause watering".
- Keep reason compact and actionable; include the three statuses like: "warm, comfy, optimal — no water needed".

Quote style:
- Make the quote reflect the environment (warm/mild/cool; humid/dry; soil state) without repeating the numeric values.
- Stay under 60 chars; no emojis.

Context:
- Timestamp: ${sensor.ts}
- Recent emails (max 2), each line is "From — Subject — Snippet":
${emailContext}

Produce ONLY the JSON now.
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
      emails: parsed.emails,
      priority: parsed.priority,
      advice: parsed.advice
    };
  } catch (e) {
    console.error("[gemini] fallback", e.message, "\nraw:", text);
    return {
      ts: sensor.ts,
      quote: "Gentle air, steady roots.",
      emails: [],
      priority: sensor.soil_pct < 25 ? "high" : "normal",
      advice: { water_now: sensor.soil_pct < 35, reason: "Fallback JSON." }
    };
  }
}