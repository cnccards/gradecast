// Gemini API client — vision-capable, uses your own key stored locally
// Tries models in order: Pro → Flash → Flash-Lite. Retries on 503 (overloaded).
const MODELS = [
  { name: "gemini-2.5-pro", label: "Pro" },
  { name: "gemini-2.5-flash", label: "Flash" },
  { name: "gemini-2.5-flash-lite", label: "Flash-Lite" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callOnce({ apiKey, model, prompt, images }) {
  const parts = [];
  for (const img of images) {
    if (!img) continue;
    const [meta, data] = img.split(",");
    const mimeType = meta.split(";")[0].split(":")[1];
    parts.push({ inline_data: { mime_type: mimeType, data } });
  }
  parts.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4000,
      responseMimeType: "application/json",
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error?.message || text;
    } catch {}
    const err = new Error(`${response.status}: ${detail.slice(0, 150)}`);
    err.status = response.status;
    err.isRateLimit = response.status === 429;
    err.isOverloaded = response.status === 503;
    throw err;
  }

  const data = JSON.parse(text);
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error("No response from Gemini");
  const content = candidate.content?.parts?.map((p) => p.text).filter(Boolean).join("");
  if (!content) {
    if (candidate.finishReason === "SAFETY") {
      throw new Error("Gemini's safety filter blocked the response. Try a different image.");
    }
    throw new Error(`Empty response. Finish reason: ${candidate.finishReason || "unknown"}`);
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    const first = content.indexOf("{");
    const last = content.lastIndexOf("}");
    if (first === -1 || last === -1) {
      throw new Error("Couldn't parse Gemini's response: " + content.slice(0, 150));
    }
    return JSON.parse(content.slice(first, last + 1));
  }
}

// Try a single model with up to 2 retries on overload (503)
async function tryModelWithRetry({ apiKey, model, prompt, images }) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callOnce({ apiKey, model: model.name, prompt, images });
    } catch (err) {
      lastErr = err;
      // Only retry on 503 (overloaded). Don't retry on 429 (quota) or other errors.
      if (err.isOverloaded && attempt < 2) {
        await sleep(2000 * (attempt + 1)); // 2s, then 4s
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function callGemini({ apiKey, prompt, images }) {
  if (!apiKey) throw new Error("No API key set. Tap Settings to add yours.");

  const errors = [];
  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    try {
      const result = await tryModelWithRetry({ apiKey, model, prompt, images });
      result._modelUsed = model.name;
      result._modelLabel = model.label;
      if (i > 0) {
        result._fellBack = true;
        result._fallbackReason = `${MODELS[0].label} unavailable — used ${model.label} instead`;
      }
      return result;
    } catch (err) {
      errors.push(`${model.label}: ${err.message}`);
      // Continue to next model in the chain
    }
  }
  throw new Error(`All models failed. ${errors.join(" | ")}`);
}

// Tiny ping to verify a key works (uses Flash-Lite — most reliable, biggest quota)
export async function pingGemini(apiKey) {
  if (!apiKey) throw new Error("No key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Reply with just: ok" }] }],
      generationConfig: { maxOutputTokens: 10 },
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    let msg = t;
    try { msg = JSON.parse(t).error?.message || t; } catch {}
    throw new Error(`HTTP ${r.status}: ${msg.slice(0, 150)}`);
  }
  return true;
}
