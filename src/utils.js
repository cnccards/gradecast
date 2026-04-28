export const GRADE_LABELS = {
  10: "Gem Mint", 9: "Mint", 8: "NM-MT", 7: "Near Mint",
  6: "EX-MT", 5: "Excellent", 4: "VG-EX", 3: "Very Good", 2: "Good", 1: "Poor",
};

export const PSA_TIERS = [
  { id: "value-bulk", label: "Value Bulk", price: 19 },
  { id: "value", label: "Value", price: 25 },
  { id: "regular", label: "Regular", price: 40 },
  { id: "express", label: "Express", price: 100 },
  { id: "super", label: "Super Express", price: 200 },
  { id: "walk", label: "Walk-Through", price: 300 },
];

export const gradeLabel = (g) => GRADE_LABELS[Math.floor(g)] || "—";

export const gradeColor = (g) => {
  if (g >= 9.5) return "#d4af37";
  if (g >= 8.5) return "#a8c690";
  if (g >= 7) return "#e8c87a";
  if (g >= 5) return "#d49860";
  return "#c97070";
};

export const fmtUSD = (n) => (n == null || isNaN(n) ? "—" : "$" + Math.round(n).toLocaleString());

export const fmtRange = (lo, hi) => {
  if (lo == null && hi == null) return "—";
  if (lo != null && hi != null && Math.round(lo) !== Math.round(hi)) {
    return `${fmtUSD(lo)}–${fmtUSD(hi)}`;
  }
  return fmtUSD(lo ?? hi);
};

export const fmtDate = (ts) => {
  const d = new Date(ts), now = new Date();
  const diff = (now - d) / 86400000;
  if (diff < 1) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diff < 7) return `${Math.floor(diff)}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};

export const ebaySoldUrl = (cardId) => {
  if (!cardId?.name) return null;
  const parts = [
    cardId.year, cardId.set, cardId.name,
    cardId.cardNumber && `#${cardId.cardNumber}`,
    cardId.variation, "PSA",
  ].filter(Boolean).join(" ");
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(parts)}&_sacat=0&LH_Sold=1&LH_Complete=1`;
};

export const buildPrompt = (mode, centeringMeasurement) => {
  const ctx = mode === "ebay"
    ? "This image is from an eBay listing. Photos may be low-res, glared, or flattering. Apply skepticism, lean conservative."
    : "This image is in-hand from the owner. You can be more confident. Use raking-light shots to assess scratches/indentations.";
  const cm = centeringMeasurement
    ? `\n\nA pixel-based centering measurement was made: L/R ${centeringMeasurement.leftRight}, T/B ${centeringMeasurement.topBottom}, suggesting centering grade ~${centeringMeasurement.gradeEstimate}. Use this as strong input but verify visually.`
    : "";

  return `You are an expert PSA card pre-grader. ${ctx}${cm}

Identify the card. Estimate PSA sub-grades (1-10, 0.5 increments): centering (55/45+ for 10), corners, edges, surface. Determine overall PSA grade (lowest sub-grade typically caps it). Estimate raw/PSA8/PSA9/PSA10 market values as low-high USD ranges (use null when truly unsure). Estimate PSA 10 gem rate % based on era and known set difficulty. Check for counterfeit/reprint indicators (off colors, wrong fonts, paper-stock issues). Set confidence based on photo quality and your knowledge of the card.

Reference: 10=Gem Mint, 9=Mint, 8=NM-MT, 7=NM, 6=EX-MT.

Respond with JSON exactly matching this schema:
{
  "cardId": { "name": "string", "year": "string|null", "set": "string|null", "cardNumber": "string|null", "variation": "string|null" },
  "overallGrade": number,
  "gradeRange": "string",
  "confidence": "low|medium|high",
  "subGrades": { "centering": number, "corners": number, "edges": number, "surface": number },
  "estimatedValues": {
    "raw": { "low": number|null, "high": number|null },
    "psa8": { "low": number|null, "high": number|null },
    "psa9": { "low": number|null, "high": number|null },
    "psa10": { "low": number|null, "high": number|null }
  },
  "gemRate": { "estimate": number|null, "context": "string" },
  "authenticity": { "verdict": "likely_authentic|concerns|likely_fake|cannot_assess", "notes": "string" },
  "defects": ["string"],
  "strengths": ["string"],
  "verdict": "string",
  "psaWorthy": boolean
}

Keep defects max 5, strengths max 3, brief phrases. Verdict = one direct sentence. Use null for unknown values.`;
};
