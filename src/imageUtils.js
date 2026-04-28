// ─── Downscale image before sending to API
export async function downscaleForAPI(base64, maxDim = 1280) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = (h / w) * maxDim; w = maxDim; }
        else { w = (w / h) * maxDim; h = maxDim; }
      }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => resolve(base64);
    img.src = base64;
  });
}

// ─── Photo quality check
export async function checkPhotoQuality(base64) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const w = Math.min(img.width, 400);
      const h = (img.height / img.width) * w;
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;

      let sumLum = 0, n = w * h, overexposed = 0, underexposed = 0;
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
        sumLum += lum;
        if (lum > 245) overexposed++;
        if (lum < 10) underexposed++;
      }
      const meanLum = sumLum / n;

      let edgeSum = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = (y * w + x) * 4;
          const lum = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
          const top = (((y-1)*w+x)*4); const tl = 0.299*data[top]+0.587*data[top+1]+0.114*data[top+2];
          const bot = (((y+1)*w+x)*4); const bl = 0.299*data[bot]+0.587*data[bot+1]+0.114*data[bot+2];
          const lft = ((y*w+x-1)*4); const ll = 0.299*data[lft]+0.587*data[lft+1]+0.114*data[lft+2];
          const rgt = ((y*w+x+1)*4); const rl = 0.299*data[rgt]+0.587*data[rgt+1]+0.114*data[rgt+2];
          edgeSum += Math.abs(4*lum - tl - bl - ll - rl);
        }
      }
      const sharpness = edgeSum / n;
      const overexposedPct = (overexposed / n) * 100;
      const underexposedPct = (underexposed / n) * 100;

      const issues = [];
      if (sharpness < 4) issues.push({ severity: "high", msg: "Photo looks blurry — try a sharper shot" });
      else if (sharpness < 7) issues.push({ severity: "low", msg: "A sharper photo would help accuracy" });
      if (overexposedPct > 8) issues.push({ severity: "med", msg: "Strong glare detected — reduce direct light" });
      if (underexposedPct > 30) issues.push({ severity: "med", msg: "Photo is too dark — add more light" });
      if (img.width < 600) issues.push({ severity: "low", msg: "Low resolution — use a higher-quality image if possible" });

      resolve({
        sharpness: sharpness.toFixed(1),
        brightness: Math.round(meanLum),
        resolution: `${img.width}×${img.height}`,
        issues,
        passed: issues.filter((i) => i.severity === "high").length === 0,
      });
    };
    img.onerror = () => resolve({ issues: [], passed: true });
    img.src = base64;
  });
}

// ─── Centering measurement (conservative — suppresses unreliable readings)
export async function measureCentering(base64) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const w = Math.min(img.width, 800);
      const h = (img.height / img.width) * w;
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;

      const lumAt = (x, y) => {
        const i = (y * w + x) * 4;
        return 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
      };

      const findCardEdges = (axis) => {
        const lengthAlong = axis === "h" ? w : h;
        const lengthAcross = axis === "h" ? h : w;
        const samplePositions = [0.3, 0.4, 0.5, 0.6, 0.7].map((f) => Math.floor(lengthAcross * f));
        const allLefts = [], allRights = [];
        for (const pos of samplePositions) {
          const samples = [];
          for (let i = 0; i < lengthAlong; i++) {
            samples.push(axis === "h" ? lumAt(i, pos) : lumAt(pos, i));
          }
          const half = Math.floor(samples.length / 2);
          let maxL = 0, lI = -1;
          for (let i = 1; i < half; i++) {
            const d = Math.abs(samples[i] - samples[i-1]);
            if (d > maxL) { maxL = d; lI = i; }
          }
          let maxR = 0, rI = -1;
          for (let i = half; i < samples.length; i++) {
            const d = Math.abs(samples[i] - samples[i-1]);
            if (d > maxR) { maxR = d; rI = i; }
          }
          if (lI > 0 && rI > 0 && maxL > 20 && maxR > 20) {
            allLefts.push(lI); allRights.push(rI);
          }
        }
        if (allLefts.length < 3) return null;
        allLefts.sort((a,b)=>a-b); allRights.sort((a,b)=>a-b);
        const med = (a) => a[Math.floor(a.length/2)];
        return [med(allLefts), med(allRights)];
      };

      const lr = findCardEdges("h"); const tb = findCardEdges("v");
      if (!lr || !tb) { resolve(null); return; }
      const [leftCard, rightCard] = lr; const [topCard, bottomCard] = tb;
      const cardW = rightCard - leftCard, cardH = bottomCard - topCard;
      if (cardW / w < 0.4 || cardH / h < 0.4) { resolve(null); return; }

      const findInner = (axis, start, end, cross, dir) => {
        const samples = [];
        for (let i = start; i <= end; i++) {
          samples.push(axis === "h" ? lumAt(i, cross) : lumAt(cross, i));
        }
        const win = Math.floor(samples.length * 0.20);
        let maxD = 0, eI = -1;
        const range = dir === "fwd" ? { s: 2, e: win } : { s: samples.length - win, e: samples.length - 2 };
        for (let i = range.s; i < range.e; i++) {
          const d = Math.abs(samples[i] - samples[i-1]);
          if (d > maxD) { maxD = d; eI = i; }
        }
        if (maxD < 15) return null;
        return eI;
      };

      const midY = Math.floor((topCard + bottomCard) / 2);
      const midX = Math.floor((leftCard + rightCard) / 2);
      const lI = findInner("h", leftCard, rightCard, midY, "fwd");
      const rIend = findInner("h", leftCard, rightCard, midY, "back");
      const tI = findInner("v", topCard, bottomCard, midX, "fwd");
      const bIend = findInner("v", topCard, bottomCard, midX, "back");
      if (lI == null || rIend == null || tI == null || bIend == null) { resolve(null); return; }

      const leftBorder = lI;
      const rightBorder = (rightCard - leftCard) - rIend;
      const topBorder = tI;
      const bottomBorder = (bottomCard - topCard) - bIend;
      const lrTotal = leftBorder + rightBorder, tbTotal = topBorder + bottomBorder;
      if (lrTotal < 6 || tbTotal < 6) { resolve(null); return; }

      const lrLeftPct = (leftBorder / lrTotal) * 100;
      const lrRightPct = 100 - lrLeftPct;
      const tbTopPct = (topBorder / tbTotal) * 100;
      const tbBottomPct = 100 - tbTopPct;
      const lrW = Math.max(lrLeftPct, lrRightPct);
      const tbW = Math.max(tbTopPct, tbBottomPct);
      if (lrW > 85 || tbW > 85) { resolve(null); return; }

      const worse = Math.max(lrW, tbW);
      let g = 5;
      if (worse <= 55) g = 10;
      else if (worse <= 60) g = 9;
      else if (worse <= 65) g = 8;
      else if (worse <= 70) g = 7;
      else if (worse <= 75) g = 6;

      resolve({
        leftRight: `${Math.round(lrLeftPct)}/${Math.round(lrRightPct)}`,
        topBottom: `${Math.round(tbTopPct)}/${Math.round(tbBottomPct)}`,
        worseSide: Math.round(worse),
        gradeEstimate: g,
      });
    };
    img.onerror = () => resolve(null);
    img.src = base64;
  });
}

// ─── Crop helper
export async function cropImage(base64, region) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sw = img.width * region.w;
      const sh = img.height * region.h;
      const c = document.createElement("canvas");
      c.width = sw; c.height = sh;
      c.getContext("2d").drawImage(img, img.width * region.x, img.height * region.y, sw, sh, 0, 0, sw, sh);
      resolve(c.toDataURL("image/jpeg", 0.92));
    };
    img.src = base64;
  });
}

// ─── File to base64
export const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
