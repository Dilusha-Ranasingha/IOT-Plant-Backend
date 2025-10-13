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
Return ONLY valid JSON with the schema:
{
 "quote": string, "emails":[{"from":string,"subject":string,"summary":string}],
 "priority":"low"|"normal"|"high",
 "advice":{"water_now":boolean,"reason":string}
}
Use sensor values: T=${sensor.t_c}°C, H=${sensor.h_pct}%, Soil=${sensor.soil_pct}%.
If Soil < 35 set advice.water_now=true and mention "dry soil".
Keep quote <= 60 chars, short and poetic.
Context ts=${sensor.ts}
Recent emails (up to 2):
${emailContext}
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