import { useState, useRef, useEffect } from "react";
import {
  Upload, Camera, Sparkles, AlertTriangle, Loader2, Award, RotateCcw,
  Clipboard, History, X, ChevronDown, Trash2, Plus, Info, TrendingUp,
  ZoomIn, ExternalLink, ShieldAlert, Bookmark, BookmarkCheck,
  Package, Check, Layers, FileText, Settings, Key,
} from "lucide-react";
import { storage } from "./storage";
import { callGemini, pingGemini } from "./gemini";
import {
  downscaleForAPI, checkPhotoQuality, measureCentering, cropImage, fileToBase64,
} from "./imageUtils";
import {
  PSA_TIERS, gradeLabel, gradeColor, fmtUSD, fmtRange, fmtDate, ebaySoldUrl, buildPrompt,
} from "./utils";

const FONTS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Geist:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes scanline { 0% { transform: translateY(-100%); } 100% { transform: translateY(100%); } }
  @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
  .fade-in { animation: fadeIn 0.5s ease-out forwards; }
  .grain::before {
    content: ''; position: fixed; inset: 0; pointer-events: none; opacity: 0.05; z-index: 100;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .scan-overlay { position: absolute; inset: 0; overflow: hidden; border-radius: 0.5rem; pointer-events: none; }
  .scan-overlay::before {
    content: ''; position: absolute; left: 0; right: 0; height: 30%;
    background: linear-gradient(180deg, transparent, rgba(212, 175, 55, 0.25), transparent);
    animation: scanline 2s ease-in-out infinite;
  }
  .shimmer-text {
    background: linear-gradient(90deg, #888 0%, #d4af37 50%, #888 100%);
    background-size: 200% auto; -webkit-background-clip: text; background-clip: text; color: transparent;
    animation: shimmer 2.5s linear infinite;
  }
  input.bare {
    background: transparent; border: none; border-bottom: 1px solid #2a2a2a;
    color: #e8e2d5; font-family: 'JetBrains Mono', monospace;
    padding: 6px 2px; width: 100%; outline: none; transition: border-color 0.2s;
  }
  input.bare:focus { border-bottom-color: #d4af37; }
  select.bare {
    background: #0d0d0c; border: 1px solid #2a2a2a; color: #e8e2d5;
    font-family: 'JetBrains Mono', monospace; font-size: 11px;
    padding: 8px; border-radius: 4px; outline: none; width: 100%;
  }
`;

const baseStyle = {
  backgroundColor: "#0a0a0a", color: "#e8e2d5",
  fontFamily: "'Geist', -apple-system, sans-serif",
  backgroundImage: "radial-gradient(ellipse at top, #15140f 0%, #0a0a0a 60%)",
  minHeight: "100vh",
};

export default function App() {
  const [view, setView] = useState("main");
  const [mode, setMode] = useState("ebay");
  const [apiKey, setApiKey] = useState("");

  const [images, setImages] = useState({ front: null, back: null, raking: null, detail: null });
  const [photoQuality, setPhotoQuality] = useState({});
  const [centeringMeasurement, setCenteringMeasurement] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [cropMode, setCropMode] = useState(null);
  const [cropRegion, setCropRegion] = useState({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  const [cropDragging, setCropDragging] = useState(false);

  const [history, setHistory] = useState([]);
  const [historyExpanded, setHistoryExpanded] = useState(null);
  const [watchlist, setWatchlist] = useState([]);
  const [batchSelection, setBatchSelection] = useState(new Set());

  const [showCoachTips, setShowCoachTips] = useState(false);
  const [buyPrice, setBuyPrice] = useState("");
  const [psaTier, setPsaTier] = useState("regular");
  const [targetPrice, setTargetPrice] = useState("");

  const refs = {
    front: useRef(null), back: useRef(null), raking: useRef(null), detail: useRef(null),
  };
  const cropOverlayRef = useRef(null);

  // Load persisted data
  useEffect(() => {
    setApiKey(storage.get("gradecast:apiKey") || "");
    setHistory(storage.get("gradecast:history") || []);
    setWatchlist(storage.get("gradecast:watchlist") || []);
  }, []);

  // First-time visitors land on settings
  useEffect(() => {
    if (apiKey === "" && !storage.get("gradecast:seenSetup")) {
      storage.set("gradecast:seenSetup", true);
      setView("settings");
    }
  }, [apiKey]);

  const setSlot = async (slot, base64) => {
    setImages((prev) => ({ ...prev, [slot]: base64 }));
    setResult(null); setError(null);
    const quality = await checkPhotoQuality(base64);
    setPhotoQuality((prev) => ({ ...prev, [slot]: quality }));
    if (slot === "front") {
      const centering = await measureCentering(base64);
      setCenteringMeasurement(centering);
    }
  };

  const removeSlot = (slot) => {
    setImages((prev) => ({ ...prev, [slot]: null }));
    setPhotoQuality((prev) => { const n = {...prev}; delete n[slot]; return n; });
    if (slot === "front") setCenteringMeasurement(null);
    setResult(null);
  };

  const handleFile = async (e, slot) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSlot(slot, await fileToBase64(file));
    e.target.value = "";
  };

  const pasteFromClipboard = async (slot) => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          setSlot(slot, await fileToBase64(blob));
          return;
        }
      }
      setError("No image in clipboard.");
    } catch {
      setError("Couldn't access clipboard. Upload directly instead.");
    }
  };

  useEffect(() => {
    const onPaste = async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) continue;
          const base64 = await fileToBase64(file);
          const next = !images.front ? "front" : !images.back ? "back" : !images.raking ? "raking" : "detail";
          setSlot(next, base64);
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [images]);

  const startCrop = (slot) => {
    setCropMode(slot);
    setCropRegion({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 });
  };

  const applyCrop = async () => {
    if (!cropMode) return;
    const cropped = await cropImage(images[cropMode], cropRegion);
    setSlot("detail", cropped);
    setCropMode(null);
  };

  const handleCropDrag = (e) => {
    if (!cropDragging || !cropOverlayRef.current) return;
    const rect = cropOverlayRef.current.getBoundingClientRect();
    const touch = e.touches?.[0] || e;
    const x = (touch.clientX - rect.left) / rect.width;
    const y = (touch.clientY - rect.top) / rect.height;
    const cx = Math.max(cropRegion.w/2, Math.min(1 - cropRegion.w/2, x));
    const cy = Math.max(cropRegion.h/2, Math.min(1 - cropRegion.h/2, y));
    setCropRegion((r) => ({ ...r, x: cx - r.w/2, y: cy - r.h/2 }));
  };

  const analyze = async () => {
    if (!images.front) return;
    if (!apiKey) {
      setError("No API key. Tap Settings (gear icon) to add yours.");
      return;
    }

    setAnalyzing(true); setError(null); setResult(null);

    try {
      const compressedFront = await downscaleForAPI(images.front);
      const compressedBack = images.back ? await downscaleForAPI(images.back) : null;
      const compressedRaking = images.raking ? await downscaleForAPI(images.raking) : null;
      const compressedDetail = images.detail ? await downscaleForAPI(images.detail) : null;

      const imgs = [compressedFront, compressedBack, compressedRaking, compressedDetail].filter(Boolean);
      const prompt = buildPrompt(mode, centeringMeasurement);

      const parsed = await callGemini({ apiKey, prompt, images: imgs });

      if (centeringMeasurement) {
        parsed.measuredCentering = centeringMeasurement;
      }
      setResult(parsed);

      const entry = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        mode,
        cardId: parsed.cardId,
        overallGrade: parsed.overallGrade,
        gradeRange: parsed.gradeRange,
        subGrades: parsed.subGrades,
        estimatedValues: parsed.estimatedValues,
        gemRate: parsed.gemRate,
        authenticity: parsed.authenticity,
        psaWorthy: parsed.psaWorthy,
        verdict: parsed.verdict,
        confidence: parsed.confidence,
      };
      const newHistory = [entry, ...history].slice(0, 200);
      setHistory(newHistory);
      storage.set("gradecast:history", newHistory);
    } catch (err) {
      console.error(err);
      setError(err?.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = () => {
    setImages({ front: null, back: null, raking: null, detail: null });
    setPhotoQuality({}); setCenteringMeasurement(null);
    setResult(null); setError(null); setBuyPrice("");
  };

  const deleteHistoryItem = (id) => {
    const newH = history.filter((h) => h.id !== id);
    setHistory(newH);
    storage.set("gradecast:history", newH);
  };

  const clearHistory = () => {
    if (!confirm("Clear all history? This can't be undone.")) return;
    setHistory([]);
    storage.remove("gradecast:history");
  };

  const addToWatchlist = () => {
    if (!result?.cardId?.name) return;
    const target = parseFloat(targetPrice) || null;
    const item = {
      id: Date.now().toString(), addedAt: Date.now(),
      cardId: result.cardId,
      lastEstimatedGrade: result.overallGrade,
      lastValues: result.estimatedValues,
      targetBuyPrice: target,
    };
    const newW = [item, ...watchlist];
    setWatchlist(newW);
    storage.set("gradecast:watchlist", newW);
    setTargetPrice("");
  };

  const removeFromWatchlist = (id) => {
    const newW = watchlist.filter((w) => w.id !== id);
    setWatchlist(newW);
    storage.set("gradecast:watchlist", newW);
  };

  const toggleBatch = (id) => {
    const newSet = new Set(batchSelection);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setBatchSelection(newSet);
  };

  const tier = PSA_TIERS.find((t) => t.id === psaTier) || PSA_TIERS[2];
  const buyNum = parseFloat(buyPrice) || 0;
  const calcProfit = (low, high) => {
    if (low == null && high == null) return [null, null];
    const sLow = low ?? high; const sHigh = high ?? low;
    return [sLow - buyNum - tier.price, sHigh - buyNum - tier.price];
  };

  const slotConfig = mode === "ebay"
    ? [{ key: "front", label: "FRONT" }, { key: "back", label: "BACK" }]
    : [
        { key: "front", label: "FRONT" }, { key: "back", label: "BACK" },
        { key: "raking", label: "RAKING", hint: "angled light" },
        { key: "detail", label: "DETAIL", hint: "close-up" },
      ];

  // ─── SETTINGS VIEW
  if (view === "settings") {
    return <SettingsView onClose={() => setView("main")} apiKey={apiKey} setApiKey={setApiKey} />;
  }

  // ─── CROP MODAL
  if (cropMode && images[cropMode]) {
    return (
      <div style={{ ...baseStyle, padding: "20px" }} className="grain">
        <style>{FONTS}</style>
        <div className="max-w-2xl mx-auto pt-4 pb-24">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setCropMode(null)} className="text-sm opacity-70 flex items-center gap-2">
              <X size={16} strokeWidth={1.5} /> Cancel
            </button>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: "18px", fontStyle: "italic" }}>Crop to focus</div>
            <div className="w-16" />
          </div>
          <div
            ref={cropOverlayRef}
            className="relative rounded-lg overflow-hidden select-none"
            style={{ border: "1px solid #2a2a2a", backgroundColor: "#000" }}
            onMouseDown={(e) => { setCropDragging(true); handleCropDrag(e); }}
            onMouseMove={handleCropDrag}
            onMouseUp={() => setCropDragging(false)}
            onMouseLeave={() => setCropDragging(false)}
            onTouchStart={(e) => { setCropDragging(true); handleCropDrag(e); }}
            onTouchMove={handleCropDrag}
            onTouchEnd={() => setCropDragging(false)}
          >
            <img src={images[cropMode]} alt="" className="w-full block pointer-events-none" />
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: "rgba(10,10,10,0.7)" }} />
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${cropRegion.x * 100}%`, top: `${cropRegion.y * 100}%`,
                width: `${cropRegion.w * 100}%`, height: `${cropRegion.h * 100}%`,
                boxShadow: "0 0 0 9999px rgba(10,10,10,0.7)",
                border: "2px solid #d4af37", borderRadius: "4px",
              }}
            >
              {[
                { top: -4, left: -4 }, { top: -4, right: -4 },
                { bottom: -4, right: -4 }, { bottom: -4, left: -4 },
              ].map((p, i) => (
                <div key={i} className="absolute w-2 h-2" style={{ ...p, backgroundColor: "#d4af37" }} />
              ))}
            </div>
          </div>
          <div className="mt-4 px-2">
            <label style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.2em", opacity: 0.5 }}>ZOOM</label>
            <input
              type="range" min="0.15" max="0.85" step="0.05"
              value={cropRegion.w}
              onChange={(e) => {
                const w = parseFloat(e.target.value);
                setCropRegion((r) => {
                  const cx = r.x + r.w/2, cy = r.y + r.h/2;
                  return { x: Math.max(0, Math.min(1-w, cx - w/2)), y: Math.max(0, Math.min(1-w, cy - w/2)), w, h: w };
                });
              }}
              className="w-full mt-2"
              style={{ accentColor: "#d4af37" }}
            />
          </div>
          <div className="text-xs opacity-50 text-center mt-3">Drag to position · slide to zoom</div>
          <button
            onClick={applyCrop}
            className="w-full mt-4 py-3 rounded-md flex items-center justify-center gap-2"
            style={{ backgroundColor: "#d4af37", color: "#0a0a0a", fontFamily: "'Fraunces', serif", fontSize: "16px", fontWeight: 500 }}
          >
            <Check size={16} strokeWidth={2} /> Add as detail shot
          </button>
        </div>
      </div>
    );
  }

  // ─── HISTORY VIEW
  if (view === "history") {
    return (
      <div style={baseStyle} className="grain">
        <style>{FONTS}</style>
        <div className="max-w-2xl mx-auto px-5 pt-8 pb-32">
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => { setView("main"); setBatchSelection(new Set()); }} className="flex items-center gap-2 text-sm opacity-70">
              <X size={16} strokeWidth={1.5} /> Close
            </button>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: "24px", fontStyle: "italic" }}>History</h2>
            {history.length > 0 ? (
              <button onClick={clearHistory} className="text-xs opacity-50">Clear</button>
            ) : <div className="w-12" />}
          </div>

          {history.length === 0 ? (
            <div className="text-center py-20 opacity-40 text-sm">No graded cards yet</div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between text-xs opacity-60" style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.15em" }}>
                <div>{batchSelection.size > 0 ? `${batchSelection.size} SELECTED` : "TAP TO EXPAND · CHECK TO SELECT"}</div>
                {batchSelection.size > 0 && (
                  <button onClick={() => setBatchSelection(new Set())} className="opacity-70">CLEAR</button>
                )}
              </div>

              <div className="space-y-2">
                {history.map((h) => {
                  const selected = batchSelection.has(h.id);
                  return (
                    <div key={h.id} className="rounded-md overflow-hidden" style={{
                      backgroundColor: selected ? "#1a1610" : "#0f0f0e",
                      border: `1px solid ${selected ? "#d4af37" : "#1f1f1f"}`,
                    }}>
                      <div className="flex">
                        <button
                          onClick={() => toggleBatch(h.id)}
                          className="flex items-center justify-center"
                          style={{ width: "40px", borderRight: "1px solid #1a1a1a", backgroundColor: selected ? "#d4af37" : "transparent" }}
                        >
                          {selected ? <Check size={14} color="#0a0a0a" strokeWidth={2.5} /> : <div style={{ width: 14, height: 14, border: "1px solid #333", borderRadius: 3 }} />}
                        </button>
                        <button
                          onClick={() => setHistoryExpanded(historyExpanded === h.id ? null : h.id)}
                          className="flex-1 px-4 py-3 flex items-center gap-3 text-left"
                        >
                          <div style={{ fontFamily: "'Fraunces', serif", fontSize: "32px", color: gradeColor(h.overallGrade), lineHeight: 1, minWidth: "44px", textAlign: "center" }}>
                            {h.overallGrade}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div style={{ fontFamily: "'Fraunces', serif", fontSize: "15px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {h.cardId?.name || "Unknown"}
                              {h.authenticity?.verdict === "concerns" && <ShieldAlert size={11} color="#c97070" className="inline ml-2" strokeWidth={2} />}
                            </div>
                            <div className="flex gap-2 items-center mt-0.5">
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.15em", opacity: 0.5 }}>
                                {(h.cardId?.year || "—")} · {h.mode === "ebay" ? "EBAY" : "SCAN"}
                              </span>
                              <span className="text-xs opacity-40">·</span>
                              <span className="text-xs opacity-40">{fmtDate(h.timestamp)}</span>
                            </div>
                          </div>
                          <ChevronDown size={16} strokeWidth={1.5} style={{ opacity: 0.4, transform: historyExpanded === h.id ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                        </button>
                      </div>
                      {historyExpanded === h.id && (
                        <div className="px-4 pb-4 space-y-3 fade-in" style={{ borderTop: "1px solid #1a1a1a", paddingTop: "12px" }}>
                          <div style={{ fontStyle: "italic", fontFamily: "'Fraunces', serif", fontSize: "14px", opacity: 0.8 }}>"{h.verdict}"</div>
                          {h.estimatedValues && (
                            <div className="grid grid-cols-3 gap-2 text-center">
                              {["psa8", "psa9", "psa10"].map((k) => {
                                const v = h.estimatedValues[k];
                                const isRange = v && typeof v === "object";
                                return (
                                  <div key={k} style={{ backgroundColor: "#0a0a0a", padding: "8px", borderRadius: "4px" }}>
                                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", opacity: 0.5, letterSpacing: "0.1em" }}>
                                      {k.toUpperCase()}
                                    </div>
                                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: "13px", marginTop: "2px" }}>
                                      {isRange ? fmtRange(v.low, v.high) : fmtUSD(v)}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <div className="flex gap-2">
                            {ebaySoldUrl(h.cardId) && (
                              <a href={ebaySoldUrl(h.cardId)} target="_blank" rel="noopener noreferrer"
                                className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded"
                                style={{ border: "1px solid #2a2a2a", color: "#d4af37" }}>
                                <ExternalLink size={11} strokeWidth={1.5} /> eBay sold
                              </a>
                            )}
                            <button onClick={() => deleteHistoryItem(h.id)} className="text-xs opacity-50 flex items-center gap-1.5 px-3 py-1.5 rounded" style={{ border: "1px solid #2a2a2a" }}>
                              <Trash2 size={11} strokeWidth={1.5} /> Remove
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {batchSelection.size > 0 && (
            <div className="fixed bottom-4 left-4 right-4 max-w-2xl mx-auto fade-in" style={{ zIndex: 50 }}>
              <button onClick={() => setView("batch")}
                className="w-full py-4 rounded-lg flex items-center justify-center gap-2 shadow-2xl"
                style={{ backgroundColor: "#d4af37", color: "#0a0a0a" }}>
                <Package size={16} strokeWidth={2} />
                <span style={{ fontFamily: "'Fraunces', serif", fontSize: "16px", fontWeight: 500 }}>
                  Build PSA submission ({batchSelection.size})
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── BATCH VIEW
  if (view === "batch") {
    const batchItems = history.filter((h) => batchSelection.has(h.id));
    const totalGrading = batchItems.length * tier.price;
    const totalLow = batchItems.reduce((s, h) => {
      const k = `psa${Math.floor(h.overallGrade)}`;
      const v = h.estimatedValues?.[k];
      if (!v) return s;
      return s + (typeof v === "object" ? (v.low ?? v.high ?? 0) : v);
    }, 0);
    const totalHigh = batchItems.reduce((s, h) => {
      const k = `psa${Math.floor(h.overallGrade)}`;
      const v = h.estimatedValues?.[k];
      if (!v) return s;
      return s + (typeof v === "object" ? (v.high ?? v.low ?? 0) : v);
    }, 0);

    return (
      <div style={baseStyle} className="grain">
        <style>{FONTS}</style>
        <div className="max-w-2xl mx-auto px-5 pt-8 pb-24">
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => setView("history")} className="flex items-center gap-2 text-sm opacity-70">
              <X size={16} strokeWidth={1.5} /> Back
            </button>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: "22px", fontStyle: "italic" }}>Submission</h2>
            <div className="w-12" />
          </div>

          <div className="rounded-lg overflow-hidden mb-4" style={{ border: "1px solid #2a2a2a" }}>
            <div className="px-5 py-3" style={{ backgroundColor: "#d4af37", color: "#0a0a0a" }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.25em" }}>BATCH WORKSHEET</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: "16px", fontWeight: 500, marginTop: "1px" }}>
                {batchItems.length} cards · {tier.label}
              </div>
            </div>
            <div className="px-5 py-4" style={{ backgroundColor: "#0c0c0b", borderBottom: "1px solid #1a1a1a" }}>
              <label style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.15em", opacity: 0.5 }}>PSA SERVICE TIER</label>
              <select value={psaTier} onChange={(e) => setPsaTier(e.target.value)} className="bare mt-2">
                {PSA_TIERS.map((t) => <option key={t.id} value={t.id}>{t.label} · ${t.price}/card</option>)}
              </select>
            </div>
            <div style={{ backgroundColor: "#0c0c0b" }}>
              {batchItems.map((h, i) => {
                const k = `psa${Math.floor(h.overallGrade)}`;
                const v = h.estimatedValues?.[k];
                const value = v ? (typeof v === "object" ? fmtRange(v.low, v.high) : fmtUSD(v)) : "—";
                return (
                  <div key={h.id} className="px-5 py-3 flex items-center gap-3" style={{ borderTop: i > 0 ? "1px solid #1a1a1a" : "none" }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: "20px", color: gradeColor(h.overallGrade), width: "36px", textAlign: "center" }}>
                      {h.overallGrade}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div style={{ fontFamily: "'Fraunces', serif", fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {h.cardId?.name}
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", opacity: 0.5, letterSpacing: "0.1em", marginTop: "2px" }}>
                        {[h.cardId?.year, h.cardId?.set, h.cardId?.cardNumber && `#${h.cardId.cardNumber}`].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="text-right">
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", opacity: 0.5 }}>@ PSA {Math.floor(h.overallGrade)}</div>
                      <div style={{ fontFamily: "'Fraunces', serif", fontSize: "13px", color: "#d4af37" }}>{value}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-5 py-4 space-y-2" style={{ backgroundColor: "#0f0f0e", borderTop: "1px solid #1a1a1a" }}>
              <div className="flex justify-between text-sm">
                <span className="opacity-70">Grading cost</span>
                <span style={{ fontFamily: "'Fraunces', serif", color: "#c97070" }}>−{fmtUSD(totalGrading)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="opacity-70">Projected sale</span>
                <span style={{ fontFamily: "'Fraunces', serif", color: "#a8c690" }}>
                  {totalLow > 0 ? fmtRange(totalLow, totalHigh) : "—"}
                </span>
              </div>
              <div className="flex justify-between text-base pt-2" style={{ borderTop: "1px solid #1a1a1a" }}>
                <span>Net</span>
                <span style={{ fontFamily: "'Fraunces', serif", fontSize: "18px", fontWeight: 500, color: "#d4af37" }}>
                  {totalLow > 0 ? fmtRange(totalLow - totalGrading, totalHigh - totalGrading) : "—"}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              const text = batchItems.map((h, i) =>
                `${i+1}. ${h.cardId?.name || "Unknown"} | ${h.cardId?.year || ""} ${h.cardId?.set || ""} ${h.cardId?.cardNumber ? "#"+h.cardId.cardNumber : ""} | Pred. PSA ${h.overallGrade}`
              ).join("\n");
              navigator.clipboard.writeText(`PSA Submission — ${tier.label}\n\n${text}\n\nGrading: ${fmtUSD(totalGrading)}\nProjected: ${fmtRange(totalLow, totalHigh)}`);
              alert("Copied to clipboard");
            }}
            className="w-full py-3 rounded-md flex items-center justify-center gap-2"
            style={{ border: "1px solid #2a2a2a" }}
          >
            <FileText size={14} strokeWidth={1.5} />
            <span style={{ fontFamily: "'Fraunces', serif" }}>Copy as worksheet</span>
          </button>
        </div>
      </div>
    );
  }

  // ─── WATCHLIST VIEW
  if (view === "watchlist") {
    return (
      <div style={baseStyle} className="grain">
        <style>{FONTS}</style>
        <div className="max-w-2xl mx-auto px-5 pt-8 pb-24">
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => setView("main")} className="flex items-center gap-2 text-sm opacity-70">
              <X size={16} strokeWidth={1.5} /> Close
            </button>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: "24px", fontStyle: "italic" }}>Watchlist</h2>
            <div className="w-12" />
          </div>
          {watchlist.length === 0 ? (
            <div className="text-center py-20 opacity-40 text-sm" style={{ lineHeight: 1.6 }}>
              Save cards from results to track here.<br/>
              <span className="text-xs opacity-70 mt-2 block">After grading, tap "Add to watchlist"</span>
            </div>
          ) : (
            <div className="space-y-2">
              {watchlist.map((w) => {
                const psa10v = w.lastValues?.psa10;
                const psa10 = psa10v ? (typeof psa10v === "object" ? psa10v.low : psa10v) : null;
                return (
                  <div key={w.id} className="rounded-md p-4" style={{ backgroundColor: "#0f0f0e", border: "1px solid #1f1f1f" }}>
                    <div className="flex items-start gap-3">
                      <Bookmark size={16} color="#d4af37" strokeWidth={1.5} className="mt-1 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div style={{ fontFamily: "'Fraunces', serif", fontSize: "16px", fontWeight: 500 }}>{w.cardId.name}</div>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", opacity: 0.5, letterSpacing: "0.1em", marginTop: "2px" }}>
                          {[w.cardId.year, w.cardId.set, w.cardId.cardNumber && `#${w.cardId.cardNumber}`].filter(Boolean).join(" · ")}
                        </div>
                        <div className="flex gap-4 mt-3 text-xs">
                          {w.targetBuyPrice && (
                            <div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8px", opacity: 0.5, letterSpacing: "0.1em" }}>TARGET BUY</div>
                              <div style={{ fontFamily: "'Fraunces', serif", fontSize: "14px", color: "#a8c690" }}>{fmtUSD(w.targetBuyPrice)}</div>
                            </div>
                          )}
                          {psa10 != null && (
                            <div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8px", opacity: 0.5, letterSpacing: "0.1em" }}>PSA 10 EST</div>
                              <div style={{ fontFamily: "'Fraunces', serif", fontSize: "14px", color: "#d4af37" }}>{fmtUSD(psa10)}</div>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 mt-3">
                          {ebaySoldUrl(w.cardId) && (
                            <a href={ebaySoldUrl(w.cardId)} target="_blank" rel="noopener noreferrer"
                              className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded"
                              style={{ border: "1px solid #2a2a2a", color: "#d4af37" }}>
                              <ExternalLink size={11} strokeWidth={1.5} /> Check eBay
                            </a>
                          )}
                          <button onClick={() => removeFromWatchlist(w.id)} className="text-xs opacity-50 flex items-center gap-1.5 px-3 py-1.5 rounded" style={{ border: "1px solid #2a2a2a" }}>
                            <Trash2 size={11} strokeWidth={1.5} /> Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  const watchlistedAlready = result?.cardId?.name && watchlist.some((w) =>
    w.cardId?.name === result.cardId.name && w.cardId?.year === result.cardId.year);

  // ─── MAIN VIEW
  return (
    <div style={baseStyle} className="grain">
      <style>{FONTS}</style>
      <div className="max-w-2xl mx-auto px-5 pt-8 pb-24">

        <header className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", letterSpacing: "0.25em", color: "#d4af37" }}>
              ◆ PSA · PRE-GRADE
            </span>
            <div className="flex items-center gap-3">
              <button onClick={() => setView("settings")} className="opacity-60 hover:opacity-100">
                <Settings size={14} strokeWidth={1.5} />
              </button>
              <button onClick={() => setView("watchlist")} className="flex items-center gap-1 opacity-60 hover:opacity-100"
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.2em" }}>
                <Bookmark size={12} strokeWidth={1.5} />
                {watchlist.length > 0 && `${watchlist.length} `}WATCH
              </button>
              <button onClick={() => setView("history")} className="flex items-center gap-1 opacity-60 hover:opacity-100"
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.2em" }}>
                <History size={12} strokeWidth={1.5} />
                {history.length > 0 && `${history.length} `}HISTORY
              </button>
            </div>
          </div>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: "52px", lineHeight: 0.95, letterSpacing: "-0.03em" }}>
            Grade<span style={{ fontStyle: "italic", color: "#d4af37", fontWeight: 400 }}>cast</span>
          </h1>
          <p className="mt-3 text-sm opacity-55" style={{ maxWidth: "34ch", lineHeight: 1.5 }}>
            An estimate of the grade your card may receive — before you buy or send it in.
          </p>
        </header>

        {!apiKey && (
          <div className="mb-4 p-4 rounded-md flex items-start gap-3 fade-in" style={{ backgroundColor: "#1a1610", border: "1px solid #2a241a" }}>
            <Key size={16} color="#d4af37" strokeWidth={1.5} className="mt-0.5 shrink-0" />
            <div className="flex-1 text-sm" style={{ lineHeight: 1.5 }}>
              No API key set. <button onClick={() => setView("settings")} className="underline" style={{ color: "#d4af37" }}>Add your free Gemini key</button> to start grading.
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1 p-1 mb-6 rounded-md" style={{ backgroundColor: "#141412", border: "1px solid #222" }}>
          {[
            { id: "ebay", label: "eBay Inspect", sub: "before you buy" },
            { id: "scan", label: "In-Hand Scan", sub: "before you submit" },
          ].map((m) => (
            <button key={m.id} onClick={() => { setMode(m.id); setResult(null); setError(null); }}
              className="py-3 px-3 rounded transition-all"
              style={{ backgroundColor: mode === m.id ? "#d4af37" : "transparent", color: mode === m.id ? "#0a0a0a" : "#e8e2d5" }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: "16px", fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.15em", opacity: mode === m.id ? 0.65 : 0.5, marginTop: "2px" }}>
                {m.sub.toUpperCase()}
              </div>
            </button>
          ))}
        </div>

        {mode === "scan" && !images.front && (
          <div className="mb-4 fade-in">
            <button onClick={() => setShowCoachTips(!showCoachTips)}
              className="w-full px-4 py-3 rounded-md flex items-center justify-between text-left"
              style={{ backgroundColor: "#141210", border: "1px solid #2a241a" }}>
              <div className="flex items-center gap-2">
                <Info size={14} color="#d4af37" strokeWidth={1.5} />
                <span style={{ fontFamily: "'Fraunces', serif", fontSize: "14px", fontStyle: "italic" }}>How to shoot for best results</span>
              </div>
              <ChevronDown size={16} strokeWidth={1.5} style={{ transform: showCoachTips ? "rotate(180deg)" : "none", transition: "transform 0.2s", opacity: 0.6 }} />
            </button>
            {showCoachTips && (
              <div className="mt-2 p-4 rounded-md text-sm fade-in space-y-2.5" style={{ backgroundColor: "#0d0d0c", border: "1px solid #1f1f1f", lineHeight: 1.55 }}>
                {[
                  ["Surface", "Flat dark surface, matte not glossy"],
                  ["Light", "Bright, soft, even — no direct overhead glare"],
                  ["Angle", "Phone parallel, shoot straight down"],
                  ["Frame", "Fill 90%+ of frame with the card"],
                  ["Bonus", "Add a RAKING shot — light from one side at low angle reveals scratches"],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.15em", color: "#d4af37", minWidth: "48px", paddingTop: "3px" }}>{k.toUpperCase()}</span>
                    <span className="opacity-80">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!images.front && (
          <div className="fade-in">
            <button onClick={() => refs.front.current?.click()}
              className="w-full aspect-[3/4] rounded-lg flex flex-col items-center justify-center gap-4 relative overflow-hidden"
              style={{ border: "1px dashed #2a2a2a", backgroundColor: "#0d0d0c" }}>
              <div className="absolute inset-4 rounded-md pointer-events-none" style={{ border: "1px solid #1a1a1a" }} />
              {[
                { top: 12, left: 12 }, { top: 12, right: 12 },
                { bottom: 12, right: 12 }, { bottom: 12, left: 12 },
              ].map((p, i) => (
                <div key={i} className="absolute w-3 h-3" style={{ ...p, borderTop: "1px solid #d4af37", borderLeft: "1px solid #d4af37", transform: `rotate(${i*90}deg)` }} />
              ))}
              {mode === "scan" ? <Camera size={36} color="#d4af37" strokeWidth={1} /> : <Upload size={36} color="#d4af37" strokeWidth={1} />}
              <div className="text-center px-6">
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: "20px", marginBottom: "6px" }}>
                  {mode === "scan" ? "Capture card front" : "Upload listing photo"}
                </div>
                <div className="text-xs opacity-50">{mode === "scan" ? "Tap to open camera" : "Tap to choose a saved image"}</div>
              </div>
            </button>
            <input ref={refs.front} type="file" accept="image/*"
              {...(mode === "scan" ? { capture: "environment" } : {})}
              onChange={(e) => handleFile(e, "front")} className="hidden" />
            {mode === "ebay" && (
              <button onClick={() => pasteFromClipboard("front")}
                className="w-full mt-3 py-3 rounded-md flex items-center justify-center gap-2"
                style={{ border: "1px solid #2a2a2a", backgroundColor: "#0d0d0c", color: "#d4af37" }}>
                <Clipboard size={14} strokeWidth={1.5} />
                <span style={{ fontFamily: "'Fraunces', serif", fontSize: "14px" }}>Paste from clipboard</span>
              </button>
            )}
          </div>
        )}

        {images.front && (
          <div className="fade-in space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {slotConfig.map((slot) => {
                const quality = photoQuality[slot.key];
                return (
                  <div key={slot.key}>
                    {images[slot.key] ? (
                      <div className="relative">
                        <div className="aspect-[3/4] rounded-lg overflow-hidden relative" style={{ border: "1px solid #2a2a2a" }}>
                          <img src={images[slot.key]} alt={slot.label} className="w-full h-full object-cover" />
                          {analyzing && <div className="scan-overlay" />}
                        </div>
                        {!analyzing && (
                          <div className="absolute top-1.5 right-1.5 flex gap-1">
                            <button onClick={() => startCrop(slot.key)}
                              className="w-6 h-6 rounded-full flex items-center justify-center"
                              style={{ backgroundColor: "rgba(10,10,10,0.85)", border: "1px solid #2a2a2a" }}>
                              <ZoomIn size={11} color="#d4af37" strokeWidth={1.5} />
                            </button>
                            {slot.key !== "front" && (
                              <button onClick={() => removeSlot(slot.key)}
                                className="w-6 h-6 rounded-full flex items-center justify-center"
                                style={{ backgroundColor: "rgba(10,10,10,0.85)", border: "1px solid #2a2a2a" }}>
                                <X size={11} color="#fff" strokeWidth={2} />
                              </button>
                            )}
                          </div>
                        )}
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.2em", opacity: 0.5, marginTop: "6px", textAlign: "center" }}>
                          {slot.label}{slot.hint && <span style={{ opacity: 0.6 }}> · {slot.hint}</span>}
                        </div>
                        {quality?.issues?.length > 0 && (
                          <div className="mt-2 px-2 py-1.5 rounded text-xs" style={{
                            backgroundColor: quality.issues.some((i) => i.severity === "high") ? "#1a0e0e" : "#1a1610",
                            border: `1px solid ${quality.issues.some((i) => i.severity === "high") ? "#4a2222" : "#2a241a"}`,
                            color: quality.issues.some((i) => i.severity === "high") ? "#e8a8a8" : "#d4af37",
                          }}>
                            <div className="flex items-start gap-1.5">
                              <AlertTriangle size={10} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                              <div style={{ lineHeight: 1.4 }}>{quality.issues[0].msg}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <button onClick={() => refs[slot.key].current?.click()} disabled={analyzing}
                          className="w-full aspect-[3/4] rounded-lg flex flex-col items-center justify-center gap-2"
                          style={{ border: "1px dashed #2a2a2a", backgroundColor: "#0d0d0c", opacity: analyzing ? 0.4 : 1 }}>
                          <Plus size={20} color="#666" strokeWidth={1.5} />
                          <div className="text-xs opacity-50 text-center px-2" style={{ lineHeight: 1.4 }}>
                            Add {slot.label.toLowerCase()}
                            {slot.hint && <div className="opacity-70 mt-0.5">{slot.hint}</div>}
                          </div>
                        </button>
                        <input ref={refs[slot.key]} type="file" accept="image/*"
                          {...(mode === "scan" ? { capture: "environment" } : {})}
                          onChange={(e) => handleFile(e, slot.key)} className="hidden" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {centeringMeasurement && !result && !analyzing && (
              <div className="px-4 py-3 rounded-md text-xs flex items-center justify-between" style={{ backgroundColor: "#0d0d0c", border: "1px solid #1f1f1f" }}>
                <div className="flex items-center gap-2">
                  <Layers size={12} color="#d4af37" strokeWidth={1.5} />
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.2em", opacity: 0.6 }}>AUTO-MEASURED CENTERING</span>
                </div>
                <div className="flex items-center gap-3">
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", opacity: 0.7 }}>
                    L/R {centeringMeasurement.leftRight} · T/B {centeringMeasurement.topBottom}
                  </span>
                  <span style={{ fontFamily: "'Fraunces', serif", fontSize: "16px", color: gradeColor(centeringMeasurement.gradeEstimate) }}>
                    {centeringMeasurement.gradeEstimate}
                  </span>
                </div>
              </div>
            )}

            {!result && !analyzing && (
              <div className="flex gap-2 pt-2">
                <button onClick={reset} className="px-4 py-3 rounded-md text-sm flex items-center gap-2" style={{ border: "1px solid #2a2a2a", color: "#888" }}>
                  <RotateCcw size={14} strokeWidth={1.5} /> Reset
                </button>
                <button onClick={analyze}
                  className="flex-1 py-3 rounded-md flex items-center justify-center gap-2 hover:opacity-90"
                  style={{ backgroundColor: "#d4af37", color: "#0a0a0a" }}>
                  <Sparkles size={16} strokeWidth={2} />
                  <span style={{ fontFamily: "'Fraunces', serif", fontSize: "16px", fontWeight: 500 }}>Estimate Grade</span>
                </button>
              </div>
            )}
          </div>
        )}

        {analyzing && (
          <div className="fade-in mt-6 py-8 flex flex-col items-center gap-4">
            <Loader2 size={24} color="#d4af37" className="animate-spin" strokeWidth={1.5} />
            <div className="shimmer-text" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", letterSpacing: "0.25em" }}>
              IDENTIFY · GRADE · AUTHENTICATE · VALUE
            </div>
          </div>
        )}

        {error && (
          <div className="fade-in mt-6 p-4 rounded-md" style={{ backgroundColor: "#1a0e0e", border: "1px solid #4a2222", color: "#e8a8a8" }}>
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} strokeWidth={1.5} className="shrink-0 mt-0.5" />
              <div className="text-sm" style={{ wordBreak: "break-word", lineHeight: 1.5 }}>{error}</div>
            </div>
          </div>
        )}

        {result && !analyzing && (
          <ResultCard
            result={result}
            mode={mode}
            buyPrice={buyPrice} setBuyPrice={setBuyPrice}
            psaTier={psaTier} setPsaTier={setPsaTier}
            calcProfit={calcProfit}
            watchlistedAlready={watchlistedAlready}
            targetPrice={targetPrice} setTargetPrice={setTargetPrice}
            addToWatchlist={addToWatchlist}
            onView={setView}
            onReset={reset}
          />
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════
// SETTINGS VIEW
// ════════════════════════════════════════════════════
function SettingsView({ onClose, apiKey, setApiKey }) {
  const [draft, setDraft] = useState(apiKey);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const save = () => {
    storage.set("gradecast:apiKey", draft.trim());
    setApiKey(draft.trim());
    setTestResult({ ok: true, msg: "Saved" });
  };

  const testKey = async () => {
    setTesting(true); setTestResult(null);
    try {
      await pingGemini(draft.trim());
      setTestResult({ ok: true, msg: "Key works ✓" });
    } catch (e) {
      setTestResult({ ok: false, msg: e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={baseStyle} className="grain">
      <style>{FONTS}</style>
      <div className="max-w-2xl mx-auto px-5 pt-8 pb-24">
        <div className="flex items-center justify-between mb-6">
          <button onClick={onClose} className="flex items-center gap-2 text-sm opacity-70">
            <X size={16} strokeWidth={1.5} /> Close
          </button>
          <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: "24px", fontStyle: "italic" }}>Settings</h2>
          <div className="w-12" />
        </div>

        <div className="rounded-lg p-5 space-y-4" style={{ backgroundColor: "#0f0f0e", border: "1px solid #1f1f1f" }}>
          <div className="flex items-center gap-2">
            <Key size={14} color="#d4af37" strokeWidth={1.5} />
            <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: "16px" }}>Gemini API Key</h3>
          </div>

          <p className="text-sm opacity-70" style={{ lineHeight: 1.5 }}>
            Gradecast uses Google's Gemini AI. The free tier covers ~1,500 grade requests per day at no cost. Your key is stored only on this device.
          </p>

          <input
            type="password" placeholder="Paste your Gemini API key here"
            value={draft} onChange={(e) => setDraft(e.target.value)}
            className="bare"
          />

          <div className="flex gap-2">
            <button onClick={testKey} disabled={!draft.trim() || testing}
              className="px-4 py-2 rounded-md text-sm flex items-center gap-2"
              style={{ border: "1px solid #2a2a2a", opacity: !draft.trim() ? 0.5 : 1 }}>
              {testing ? <Loader2 size={14} className="animate-spin" strokeWidth={1.5} /> : null}
              Test
            </button>
            <button onClick={save} disabled={!draft.trim() || draft === apiKey}
              className="flex-1 px-4 py-2 rounded-md text-sm flex items-center justify-center gap-2"
              style={{ backgroundColor: "#d4af37", color: "#0a0a0a", opacity: !draft.trim() || draft === apiKey ? 0.5 : 1 }}>
              <Check size={14} strokeWidth={2} /> Save
            </button>
          </div>

          {testResult && (
            <div className="text-sm p-3 rounded-md fade-in" style={{
              backgroundColor: testResult.ok ? "#0e1a0e" : "#1a0e0e",
              color: testResult.ok ? "#a8c690" : "#e8a8a8",
              border: `1px solid ${testResult.ok ? "#224a22" : "#4a2222"}`,
            }}>
              {testResult.msg}
            </div>
          )}
        </div>

        <div className="mt-6 rounded-lg p-5" style={{ backgroundColor: "#0d0d0c", border: "1px solid #1f1f1f" }}>
          <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: "15px", fontStyle: "italic", marginBottom: "12px" }}>
            How to get a free key
          </h3>
          <ol className="text-sm space-y-2 opacity-80" style={{ lineHeight: 1.6 }}>
            <li>1. Go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style={{ color: "#d4af37" }} className="underline">aistudio.google.com/apikey</a></li>
            <li>2. Sign in with your Google account</li>
            <li>3. Click "Create API key"</li>
            <li>4. Copy the key and paste it above</li>
            <li>5. Tap Test, then Save</li>
          </ol>
          <p className="text-xs opacity-50 mt-4" style={{ lineHeight: 1.5 }}>
            Your key never leaves your device except to call Google's API directly. No account required for Gradecast itself.
          </p>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════
// RESULT CARD
// ════════════════════════════════════════════════════
function ResultCard({ result, mode, buyPrice, setBuyPrice, psaTier, setPsaTier, calcProfit, watchlistedAlready, targetPrice, setTargetPrice, addToWatchlist, onView, onReset }) {
  return (
    <div className="fade-in mt-6 space-y-4">
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #222" }}>

        <div className="px-5 py-3 flex items-center justify-between" style={{ backgroundColor: "#d4af37", color: "#0a0a0a" }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.25em" }}>GRADE FORECAST</div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: "14px", fontWeight: 500, marginTop: "1px" }}>{result.gradeRange}</div>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.2em" }}>
            CONF · {result.confidence?.toUpperCase()}
          </div>
        </div>

        {result.authenticity?.verdict === "concerns" && (
          <div className="px-5 py-4 flex items-start gap-3" style={{ backgroundColor: "#1a0e0e", borderBottom: "1px solid #4a2222" }}>
            <ShieldAlert size={18} color="#e8a8a8" strokeWidth={1.5} className="mt-0.5 shrink-0" />
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.25em", color: "#e8a8a8", marginBottom: "4px" }}>⚠ AUTHENTICITY CONCERNS</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: "13px", fontStyle: "italic", color: "#e8c8c8", lineHeight: 1.5 }}>{result.authenticity.notes}</div>
            </div>
          </div>
        )}
        {result.authenticity?.verdict === "likely_fake" && (
          <div className="px-5 py-4 flex items-start gap-3" style={{ backgroundColor: "#2a0e0e", borderBottom: "1px solid #6a2222" }}>
            <ShieldAlert size={18} color="#ff8888" strokeWidth={2} className="mt-0.5 shrink-0" />
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.25em", color: "#ff8888", marginBottom: "4px" }}>⛔ LIKELY FAKE OR REPRINT</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: "13px", fontStyle: "italic", color: "#ffb8b8", lineHeight: 1.5 }}>{result.authenticity.notes}</div>
            </div>
          </div>
        )}

        {result.cardId?.name && result.cardId.name !== "Unknown" && (
          <div className="px-5 py-4" style={{ backgroundColor: "#0c0c0b", borderBottom: "1px solid #1a1a1a" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.25em", opacity: 0.5, marginBottom: "6px" }}>IDENTIFIED</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: "20px", fontWeight: 500, lineHeight: 1.2 }}>{result.cardId.name}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", letterSpacing: "0.1em", opacity: 0.6, marginTop: "4px" }}>
                  {[result.cardId.year, result.cardId.set, result.cardId.cardNumber && `#${result.cardId.cardNumber}`, result.cardId.variation].filter(Boolean).join(" · ")}
                </div>
              </div>
              {ebaySoldUrl(result.cardId) && (
                <a href={ebaySoldUrl(result.cardId)} target="_blank" rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1.5 px-3 py-2 rounded shrink-0"
                  style={{ border: "1px solid #2a2a2a", color: "#d4af37" }}>
                  <ExternalLink size={11} strokeWidth={1.5} /> eBay sold
                </a>
              )}
            </div>
          </div>
        )}

        <div className="px-5 py-10 text-center" style={{ backgroundColor: "#0f0f0e" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", letterSpacing: "0.3em", opacity: 0.5, marginBottom: "8px" }}>ESTIMATED PSA</div>
          <div style={{
            fontFamily: "'Fraunces', serif", fontSize: "128px", lineHeight: 1, fontWeight: 300,
            color: gradeColor(result.overallGrade), letterSpacing: "-0.05em",
          }}>
            {result.overallGrade}
          </div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: "16px", fontStyle: "italic", opacity: 0.75, marginTop: "6px" }}>
            {gradeLabel(result.overallGrade)}
          </div>
        </div>

        <div className="px-5 py-5" style={{ backgroundColor: "#0f0f0e", borderTop: "1px solid #1a1a1a" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.25em", opacity: 0.5, marginBottom: "14px" }}>SUB-GRADES</div>
          <div className="space-y-3">
            {Object.entries(result.subGrades).map(([key, value]) => (
              <div key={key} className="flex items-center gap-3">
                <div className="w-20" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", letterSpacing: "0.1em", opacity: 0.7, textTransform: "uppercase" }}>
                  {key}
                  {key === "centering" && result.measuredCentering && (
                    <div style={{ fontSize: "8px", opacity: 0.5, marginTop: "2px" }}>{result.measuredCentering.leftRight}</div>
                  )}
                </div>
                <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "#1a1a1a" }}>
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${value * 10}%`, backgroundColor: gradeColor(value) }} />
                </div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: "18px", color: gradeColor(value), width: "32px", textAlign: "right" }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {result.gemRate?.estimate != null && (
          <div className="px-5 py-5" style={{ backgroundColor: "#0c0c0b", borderTop: "1px solid #1a1a1a" }}>
            <div className="flex items-center justify-between mb-3">
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.25em", opacity: 0.5 }}>GEM RATE · PSA 10</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", opacity: 0.5, letterSpacing: "0.1em" }}>EST.</div>
            </div>
            <div className="flex items-baseline gap-3 mb-3">
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: "44px", fontWeight: 300, color: "#d4af37", lineHeight: 1 }}>
                {result.gemRate.estimate}<span style={{ fontSize: "20px", opacity: 0.7 }}>%</span>
              </div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: "13px", fontStyle: "italic", opacity: 0.7 }}>{result.gemRate.context}</div>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: "#1a1a1a" }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(result.gemRate.estimate, 100)}%`, backgroundColor: "#d4af37" }} />
            </div>
          </div>
        )}

        {result.estimatedValues && Object.values(result.estimatedValues).some((v) => v && (v.low != null || v.high != null)) && (
          <div className="px-5 py-5" style={{ backgroundColor: "#0f0f0e", borderTop: "1px solid #1a1a1a" }}>
            <div className="flex items-center justify-between mb-3">
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.25em", opacity: 0.5 }}>MARKET VALUE · EST.</div>
              {ebaySoldUrl(result.cardId) && (
                <a href={ebaySoldUrl(result.cardId)} target="_blank" rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 opacity-60 hover:opacity-100" style={{ color: "#d4af37" }}>
                  <ExternalLink size={10} strokeWidth={1.5} /> sold comps
                </a>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { k: "raw", label: "RAW" }, { k: "psa8", label: "PSA 8" },
                { k: "psa9", label: "PSA 9" }, { k: "psa10", label: "PSA 10" },
              ].map(({ k, label }) => {
                const v = result.estimatedValues[k];
                const isRange = v && typeof v === "object";
                return (
                  <div key={k} className="text-center py-2" style={{ backgroundColor: "#0a0a0a", borderRadius: "4px" }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8px", letterSpacing: "0.15em", opacity: 0.5 }}>{label}</div>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: "13px", marginTop: "3px", color: k === "psa10" ? "#d4af37" : "#e8e2d5", lineHeight: 1.2 }}>
                      {isRange ? fmtRange(v.low, v.high) : fmtUSD(v)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {result.estimatedValues && (result.estimatedValues.psa9 || result.estimatedValues.psa10) && (
          <div className="px-5 py-5" style={{ backgroundColor: "#0c0c0b", borderTop: "1px solid #1a1a1a" }}>
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={12} color="#d4af37" strokeWidth={1.5} />
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.25em", opacity: 0.7 }}>ROI CALCULATOR</div>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.15em", opacity: 0.5 }}>
                  {mode === "ebay" ? "BUY PRICE ($)" : "COST ($)"}
                </label>
                <input type="number" inputMode="decimal" placeholder="0" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} className="bare mt-1" />
              </div>
              <div>
                <label style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.15em", opacity: 0.5 }}>PSA TIER</label>
                <select value={psaTier} onChange={(e) => setPsaTier(e.target.value)} className="bare mt-1">
                  {PSA_TIERS.map((t) => <option key={t.id} value={t.id}>{t.label} · ${t.price}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              {[{ k: "psa8", label: "If PSA 8" }, { k: "psa9", label: "If PSA 9" }, { k: "psa10", label: "If PSA 10" }].map(({ k, label }) => {
                const v = result.estimatedValues[k];
                const isRange = v && typeof v === "object";
                const [pLow, pHigh] = isRange ? calcProfit(v.low, v.high) : calcProfit(v, v);
                return (
                  <div key={k} className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid #161616" }}>
                    <div className="text-sm opacity-70">{label}</div>
                    <div style={{
                      fontFamily: "'Fraunces', serif", fontSize: "15px", fontWeight: 500,
                      color: pLow == null ? "#666" : (pLow + pHigh)/2 >= 0 ? "#a8c690" : "#c97070",
                      textAlign: "right",
                    }}>
                      {pLow == null ? "—" : (
                        isRange && Math.round(pLow) !== Math.round(pHigh)
                          ? `${pLow >= 0 ? "+" : ""}${fmtUSD(pLow)} → ${pHigh >= 0 ? "+" : ""}${fmtUSD(pHigh)}`
                          : `${pLow >= 0 ? "+" : ""}${fmtUSD(pLow)}`
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-xs opacity-40 mt-3" style={{ lineHeight: 1.5 }}>
              Profit = sale − cost − grading. Excludes shipping, eBay fees, taxes.
            </div>
          </div>
        )}

        <div className="px-5 py-5" style={{ backgroundColor: "#0c0c0b", borderTop: "1px solid #1a1a1a" }}>
          <div className="flex items-start gap-3">
            {result.psaWorthy ? (
              <Award size={18} color="#d4af37" strokeWidth={1.5} className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={18} color="#c97070" strokeWidth={1.5} className="mt-0.5 shrink-0" />
            )}
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: "16px", fontStyle: "italic", lineHeight: 1.45 }}>"{result.verdict}"</div>
          </div>
        </div>

        {(result.defects?.length > 0 || result.strengths?.length > 0) && (
          <div className="px-5 py-5 space-y-5" style={{ backgroundColor: "#0c0c0b", borderTop: "1px solid #1a1a1a" }}>
            {result.strengths?.length > 0 && (
              <div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.25em", color: "#a8c690", marginBottom: "10px" }}>✓ STRENGTHS</div>
                <ul className="space-y-2">
                  {result.strengths.map((s, i) => (
                    <li key={i} className="text-sm flex gap-2.5 opacity-90" style={{ lineHeight: 1.5 }}>
                      <span className="opacity-40">—</span><span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.defects?.length > 0 && (
              <div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.25em", color: "#c97070", marginBottom: "10px" }}>⚠ FLAGGED</div>
                <ul className="space-y-2">
                  {result.defects.map((d, i) => (
                    <li key={i} className="text-sm flex gap-2.5 opacity-90" style={{ lineHeight: 1.5 }}>
                      <span className="opacity-40">—</span><span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {!watchlistedAlready && result.cardId?.name !== "Unknown" && (
        <div className="rounded-md p-4" style={{ backgroundColor: "#0f0f0e", border: "1px solid #1f1f1f" }}>
          <div className="flex items-center gap-2 mb-3">
            <Bookmark size={12} color="#d4af37" strokeWidth={1.5} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.25em", opacity: 0.7 }}>ADD TO WATCHLIST</div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: "0.15em", opacity: 0.5 }}>TARGET BUY ($) · OPTIONAL</label>
              <input type="number" inputMode="decimal" placeholder="0" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} className="bare mt-1" />
            </div>
            <button onClick={addToWatchlist} className="px-4 self-end pb-1 py-2 rounded-md flex items-center gap-1.5"
              style={{ backgroundColor: "#d4af37", color: "#0a0a0a", fontFamily: "'Fraunces', serif", fontSize: "14px" }}>
              <Bookmark size={12} strokeWidth={2} /> Watch
            </button>
          </div>
        </div>
      )}
      {watchlistedAlready && (
        <div className="rounded-md px-4 py-3 flex items-center gap-2" style={{ backgroundColor: "#141210", border: "1px solid #2a241a" }}>
          <BookmarkCheck size={14} color="#d4af37" strokeWidth={1.5} />
          <span className="text-sm opacity-80">In your watchlist</span>
          <button onClick={() => onView("watchlist")} className="ml-auto text-xs opacity-60" style={{ color: "#d4af37" }}>View →</button>
        </div>
      )}

      <button onClick={onReset} className="w-full py-3 rounded-md text-sm flex items-center justify-center gap-2" style={{ border: "1px solid #2a2a2a" }}>
        <RotateCcw size={14} strokeWidth={1.5} /> Check another card
      </button>

      <div className="text-xs opacity-40" style={{ lineHeight: 1.6 }}>
        AI estimate. Light scratches, indentations, and print issues may not show in photos. Always verify with eBay sold comps and PSA pop reports.
      </div>
    </div>
  );
}
