// src/gemini.js
import { z } from "zod";

const OutputZ = z.object({
  quote: z.string().max(100),
  emails: z.array(z.object({
    from: z.string(),
    subject: z.string(),
    summary: z.string()
  })).max(1).optional().default([]),
  priority: z.enum(["low","normal","high"]).default("normal"),
  advice: z.object({
    water_now: z.boolean(),
    reason: z.string()
  })
});

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

/**
 * input = {
 *   plantName: string,
 *   readings: [{ ts, t_c, h_pct, soil_pct }],
 *   latestTs: string
 * }
 */
export async function buildDisplayWithGemini(apiKey, input) {
  const plantName = input?.plantName || "unknown";
  const readings = Array.isArray(input?.readings) ? input.readings : [];
  const ts = input?.latestTs || new Date().toISOString();

  // Fallback if no API key
  if (!apiKey) {
    const avg = (arr, k) => arr.length ? (arr.reduce((s, r) => s + Number(r[k] || 0), 0) / arr.length) : 0;
    const tavg = Math.round(avg(readings, "t_c") * 10) / 10;
    const havg = Math.round(avg(readings, "h_pct"));
    const savg = Math.round(avg(readings, "soil_pct"));
    return {
      ts,
      quote: "Gentle air, steady roots.",
      emails: [{
        from: "AuraLinkPlant",
        subject: `${plantName} status (fallback)`,
        summary: `Avg T=${tavg}°C, H=${havg}%, Soil=${savg}%. Check watering and light.`
      }],
      priority: savg < 25 ? "high" : "normal",
      advice: { water_now: savg < 35, reason: "No Gemini API key; using window average." }
    };
  }

  const readingsJson = JSON.stringify(readings);

  const prompt = `
You are AuraLinkPlant helping a home grower via a tiny desk display.

Plant: ${plantName}

You receive a 5-minute window of sensor readings as a JSON array:
Each item: {"ts": ISO8601, "t_c": number, "h_pct": number, "soil_pct": number}
readings = ${readingsJson}

Your job:
1) Infer ideal ranges for THIS plant (temperature, humidity, soil moisture) from your horticulture knowledge.
2) Compare window **averages and trends** to those ranges (first vs last + average).
3) Output EXACTLY ONE JSON OBJECT (not an array, not wrapped, no markdown) with this schema:
{
  "quote": string,                                  // <= 60 chars
  "emails": [                                       // EXACTLY 1 item
    {"from": "AuraLinkPlant", "subject": string, "summary": string} // <=140 chars
  ],
  "priority": "low"|"normal"|"high",
  "advice": {"water_now": boolean, "reason": string} // <= 90 chars
}

Guidance:
- "high" if soil below ideal & trending down, or temps above ideal, or humidity far outside ideal.
- Within ideal and stable → "normal" + water_now=false.
- If near lower soil bound → suggest a small amount (e.g., "add 50–100 ml").
- Keep reason compact; e.g., "warm, comfy, optimal — no water needed".
- Subject <= 60 chars; no external people or extra fields.

Output: ONLY that single JSON object. Do NOT return an array.
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  console.log("[gemini] model:", MODEL);

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }]}],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 512,
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
    // Some model responses come back as [ { … } ] — normalize to object
    let raw = JSON.parse(text);
    if (Array.isArray(raw)) raw = raw[0] || {};
    const parsed = OutputZ.parse(raw);
    return {
      ts,
      quote: parsed.quote,
      emails: parsed.emails,
      priority: parsed.priority,
      advice: parsed.advice
    };
  } catch (e) {
    console.error("[gemini] fallback", e.message, "\nraw:", text);
    const avg = (arr, k) => arr.length ? (arr.reduce((s, r) => s + Number(r[k] || 0), 0) / arr.length) : 0;
    const tavg = Math.round(avg(readings, "t_c") * 10) / 10;
    const havg = Math.round(avg(readings, "h_pct"));
    const savg = Math.round(avg(readings, "soil_pct"));
    return {
      ts,
      quote: "Gentle air, steady roots.",
      emails: [{
        from: "AuraLinkPlant",
        subject: `${plantName} status (fallback)`,
        summary: `Avg T=${isNaN(tavg)? "—" : tavg}°C, H=${isNaN(havg)? "—" : havg}%, Soil=${isNaN(savg)? "—" : savg}%`
      }],
      priority: savg < 25 ? "high" : "normal",
      advice: { water_now: savg < 35, reason: "Fallback JSON from 5-minute window." }
    };
  }
}
