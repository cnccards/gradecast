// Gemini API client — vision-capable, uses your own key stored locally
// Tries the primary model first, automatically falls back to backup if rate-limited or errored.
const PRIMARY_MODEL = "gemini-2.5-pro";
const FALLBACK_MODEL = "gemini-2.5-flash";

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
    let isRateLimit = response.status === 429;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error?.message || text;
      if (parsed.error?.status === "RESOURCE_EXHAUSTED") isRateLimit = true;
    } catch {}
    const err = new Error(`Gemini ${response.status}: ${detail.slice(0, 200)}`);
    err.isRateLimit = isRateLimit;
    err.status = response.status;
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
      throw new Error("Couldn't parse Gemini's response: " + content.slice(0, 200));
    }
    return JSON.parse(content.slice(first, last + 1));
  }
}

export async function callGemini({ apiKey, prompt, images }) {
  if (!apiKey) throw new Error("No API key set. Tap Settings to add yours.");

  // Try primary model first
  try {
    const result = await callOnce({ apiKey, model: PRIMARY_MODEL, prompt, images });
    result._modelUsed = PRIMARY_MODEL;
    return result;
  } catch (primaryErr) {
    // If rate-limited or quota exhausted, fall back to Flash automatically
    if (primaryErr.isRateLimit || primaryErr.status === 429 || primaryErr.status === 503) {
      console.warn("Primary model rate-limited, falling back to", FALLBACK_MODEL);
      try {
        const result = await callOnce({ apiKey, model: FALLBACK_MODEL, prompt, images });
        result._modelUsed = FALLBACK_MODEL;
        result._fellBack = true;
        result._fallbackReason = "Daily limit reached on Gemini 2.5 Pro — used Flash instead";
        return result;
      } catch (fallbackErr) {
        throw new Error(`Both models failed. Pro: ${primaryErr.message}. Flash: ${fallbackErr.message}`);
      }
    }
    // Otherwise re-throw original error
    throw primaryErr;
  }
}

// Tiny ping to verify a key works (uses Flash for quickness)
export async function pingGemini(apiKey) {
  if (!apiKey) throw new Error("No key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${FALLBACK_MODEL}:generateContent?key=${apiKey}`;
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
