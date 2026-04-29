// Gemini API client — vision-capable, uses your own key stored locally
const MODEL = "gemini-2.5-flash";

export async function callGemini({ apiKey, prompt, images }) {
  if (!apiKey) throw new Error("No API key set. Tap Settings to add yours.");

  const parts = [];
  for (const img of images) {
    if (!img) continue;
    const [meta, data] = img.split(",");
    const mimeType = meta.split(";")[0].split(":")[1];
    parts.push({
      inline_data: { mime_type: mimeType, data },
    });
  }
  parts.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2000,
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
    throw new Error(`Gemini ${response.status}: ${detail.slice(0, 200)}`);
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

  // responseMimeType: "application/json" guarantees JSON, but parse defensively
  try {
    return JSON.parse(content);
  } catch (e) {
    // Fallback: extract first { to last }
    const first = content.indexOf("{");
    const last = content.lastIndexOf("}");
    if (first === -1 || last === -1) {
      throw new Error("Couldn't parse Gemini's response: " + content.slice(0, 200));
    }
    return JSON.parse(content.slice(first, last + 1));
  }
}

// Tiny ping to verify a key works
export async function pingGemini(apiKey) {
  if (!apiKey) throw new Error("No key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
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
