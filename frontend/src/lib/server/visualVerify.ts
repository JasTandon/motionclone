/**
 * Visual closed loop: renders a generated clone in headless Chrome on a virtual clock, captures
 * it at the exact timestamps of the source keyframes, and scores each pair.
 *
 * Scoring is restricted to the content region (see COMPARE_FN) so flat backgrounds cannot
 * inflate it, and each pair reports measurable diagnostics for the refinement prompt.
 */
import fs from "fs";
import type { Browser } from "puppeteer-core";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((p): p is string => !!p);

export function findChrome(): string | null {
  return CHROME_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.connected) return b;
  }
  const executablePath = findChrome();
  if (!executablePath) throw new Error("No Chrome/Chromium found (set CHROME_PATH)");
  const puppeteer = (await import("puppeteer-core")).default;
  browserPromise = puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--mute-audio"],
  });
  return browserPromise;
}

/**
 * Replaces the page clock before any page script runs: performance.now, Date.now,
 * requestAnimationFrame and timers all advance only when __mcAdvance(t) is called.
 */
const VIRTUAL_CLOCK = `(() => {
  let now = 0, rafId = 0, timerId = 0;
  const raf = new Map(), timers = [];
  const epoch = Date.now();
  performance.now = () => now;
  Date.now = () => epoch + now;
  window.requestAnimationFrame = (cb) => { raf.set(++rafId, cb); return rafId; };
  window.cancelAnimationFrame = (id) => raf.delete(id);
  const addTimer = (cb, ms, repeat, args) => { const id = ++timerId; timers.push({ id, due: now + Math.max(0, +ms || 0), cb, ms: Math.max(1, +ms || 0), repeat, args }); return id; };
  window.setTimeout = (cb, ms, ...args) => typeof cb === "function" ? addTimer(cb, ms, false, args) : 0;
  window.setInterval = (cb, ms, ...args) => typeof cb === "function" ? addTimer(cb, ms, true, args) : 0;
  window.clearTimeout = window.clearInterval = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const step = () => {
    for (let guard = 0; guard < 50; guard++) {
      timers.sort((a, b) => a.due - b.due);
      const t = timers[0];
      if (!t || t.due > now) break;
      if (t.repeat) t.due += t.ms; else timers.shift();
      try { t.cb(...t.args); } catch (e) {}
    }
    const cbs = [...raf.values()]; raf.clear();
    for (const cb of cbs) { try { cb(now); } catch (e) {} }
  };
  window.__mcAdvance = (target) => {
    // Always paint at least one frame (t = 0 must show the first rendered state, not the raw DOM).
    if (now >= target) step();
    while (now < target) {
      now = Math.min(target, now + 1000 / 60);
      step();
    }
    step();
    try { document.getAnimations().forEach((a) => { a.pause(); a.currentTime = target; }); } catch (e) {}
  };
})();`;

export interface FrameDiagnostics {
  /** Bounding box of everything that differs from the background, 640x400 stage px. */
  contentSrc: number[] | null;
  contentClone: number[] | null;
  /** Bounding box of inner detail (pixels unlike both the background and the main fill colour). */
  detailSrc: number[] | null;
  detailClone: number[] | null;
  bgSrc: string;
  bgClone: string;
}

export interface VisualFrameScore {
  tMs: number;
  score: number;
  ssim: number;
  match: number;
  diag: FrameDiagnostics;
}

export interface VisualReport {
  score: number;
  frames: VisualFrameScore[];
  /** Source | clone composites for the worst frames, worst first (JPEG data URLs). */
  worstPairs: { tMs: number; score: number; image: string; diag: FrameDiagnostics }[];
}

/**
 * Runs in the comparison page. Only the content region counts, so a matching background
 * cannot carry the score:
 *   ssim  = SSIM (luma, 8×8 blocks) over blocks that touch the content region
 *   match = fraction of content pixels whose colour matches within 10%
 *   score = 0.4·ssim + 0.6·match
 */
const COMPARE_FN = `async (srcUrl, cloneUrl, label) => {
  const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
  const [a, b] = await Promise.all([load(srcUrl), load(cloneUrl)]);
  const W = 160, H = 100, S = 4;
  const px = (img) => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"); x.drawImage(img, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
  const A = px(a), B = px(b);
  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const dist = (d, i, c) => (Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2])) / 765;
  const bg = (d) => { const r = [], g = [], bl = []; const push = (x, y) => { const i = (y * W + x) * 4; r.push(d[i]); g.push(d[i + 1]); bl.push(d[i + 2]); }; for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); } for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); } const m = (v) => v.sort((p, q) => p - q)[v.length >> 1]; return [m(r), m(g), m(bl)]; };
  const ba = bg(A), bb = bg(B);
  const isFg = (d, i, c) => dist(d, i, c) > 0.09;
  // Dominant foreground colour (quantized mode) → inner-detail pixels differ from bg and from it.
  const mainFill = (d, c) => { const h = new Map(); for (let i = 0; i < d.length; i += 4) if (isFg(d, i, c)) { const k = (d[i] >> 5) + "," + (d[i + 1] >> 5) + "," + (d[i + 2] >> 5); h.set(k, (h.get(k) || 0) + 1); } let best = null, n = 0; for (const [k, v] of h) if (v > n) { n = v; best = k; } return best ? best.split(",").map((v) => (+v << 5) + 16) : null; };
  const fa = mainFill(A, ba), fb = mainFill(B, bb);
  const box = (d, pred) => { let x0 = W, y0 = H, x1 = -1, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (pred(d, (y * W + x) * 4)) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } } return x1 < 0 ? null : [x0 * S, y0 * S, (x1 - x0 + 1) * S, (y1 - y0 + 1) * S]; };
  const contentA = box(A, (d, i) => isFg(d, i, ba)), contentB = box(B, (d, i) => isFg(d, i, bb));
  // Search the interior only (content box inset 12%), so anti-aliased edges and shadows don't count.
  const inside = (r, i) => { if (!r) return false; const x = ((i / 4) % W) * S, y = Math.floor(i / 4 / W) * S; const mx = r[2] * 0.12, my = r[3] * 0.12; return x >= r[0] + mx && x < r[0] + r[2] - mx && y >= r[1] + my && y < r[1] + r[3] - my; };
  const detailA = fa ? box(A, (d, i) => inside(contentA, i) && isFg(d, i, ba) && dist(d, i, fa) > 0.15) : null;
  const detailB = fb ? box(B, (d, i) => inside(contentB, i) && isFg(d, i, bb) && dist(d, i, fb) > 0.15) : null;
  // Content region = union of both content boxes (+1 block margin), in grid units.
  const U = [contentA, contentB].filter(Boolean);
  const ux0 = U.length ? Math.max(0, Math.min(...U.map((r) => r[0] / S)) - 4) : 0;
  const uy0 = U.length ? Math.max(0, Math.min(...U.map((r) => r[1] / S)) - 4) : 0;
  const ux1 = U.length ? Math.min(W, Math.max(...U.map((r) => (r[0] + r[2]) / S)) + 4) : W;
  const uy1 = U.length ? Math.min(H, Math.max(...U.map((r) => (r[1] + r[3]) / S)) + 4) : H;
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let ssimSum = 0, blocks = 0;
  for (let by = 0; by + 8 <= H; by += 4) for (let bx = 0; bx + 8 <= W; bx += 4) {
    if (bx + 8 <= ux0 || bx >= ux1 || by + 8 <= uy0 || by >= uy1) continue;
    let ma = 0, mb = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = ((by + y) * W + bx + x) * 4; ma += lum(A, i); mb += lum(B, i); }
    ma /= 64; mb /= 64;
    let va = 0, vb = 0, cov = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = ((by + y) * W + bx + x) * 4; const da = lum(A, i) - ma, db = lum(B, i) - mb; va += da * da; vb += db * db; cov += da * db; }
    va /= 63; vb /= 63; cov /= 63;
    ssimSum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    blocks++;
  }
  const ssim = blocks ? Math.max(0, ssimSum / blocks) : 1;
  let fg = 0, ok = 0;
  for (let i = 0; i < A.length; i += 4) {
    if (isFg(A, i, ba) || isFg(B, i, bb)) { fg++; if (dist(A, i, [B[i], B[i + 1], B[i + 2]]) < 0.1) ok++; }
  }
  const bgMatch = 1 - dist([...ba, 0], 0, bb);
  const match = fg ? ok / fg : bgMatch;
  const hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  // Composite cropped to the shared content region (+24px) and scaled up so fine detail is visible.
  const pad = 24;
  let cx0 = U.length ? Math.max(0, ux0 * S + 16 - pad) : 0, cy0 = U.length ? Math.max(0, uy0 * S + 16 - pad) : 0;
  let cx1 = U.length ? Math.min(640, ux1 * S - 16 + pad) : 640, cy1 = U.length ? Math.min(400, uy1 * S - 16 + pad) : 400;
  if (cx1 - cx0 < 64) { cx0 = 0; cx1 = 640; } if (cy1 - cy0 < 40) { cy0 = 0; cy1 = 400; }
  const cw = cx1 - cx0, ch = cy1 - cy0, k = Math.min(620 / cw, 400 / ch, 4);
  const dw = cw * k, dh = ch * k;
  const c = document.createElement("canvas"); c.width = 1280; c.height = 430;
  const x = c.getContext("2d"); x.fillStyle = "#111"; x.fillRect(0, 0, 1280, 430);
  const sx = (img) => img.naturalWidth / 640, sy = (img) => img.naturalHeight / 400;
  x.drawImage(a, cx0 * sx(a), cy0 * sy(a), cw * sx(a), ch * sy(a), (640 - dw) / 2, 30 + (400 - dh) / 2, dw, dh);
  x.drawImage(b, cx0 * sx(b), cy0 * sy(b), cw * sx(b), ch * sy(b), 640 + (640 - dw) / 2, 30 + (400 - dh) / 2, dw, dh);
  x.strokeStyle = "#444"; x.beginPath(); x.moveTo(640, 30); x.lineTo(640, 430); x.stroke();
  x.fillStyle = "#fff"; x.font = "bold 16px sans-serif";
  const zoom = k > 1.05 ? "  (zoom " + k.toFixed(1) + "x on [" + [cx0, cy0, cw, ch].map(Math.round).join(",") + "])" : "";
  x.fillText("SOURCE VIDEO  " + label + zoom, 10, 21); x.fillText("YOUR CLONE  " + label, 650, 21);
  return {
    ssim, match,
    diag: { contentSrc: contentA, contentClone: contentB, detailSrc: detailA, detailClone: detailB, bgSrc: hex(ba), bgClone: hex(bb) },
    composite: c.toDataURL("image/jpeg", 0.8),
  };
}`;

export async function renderAndScore(
  html: string,
  keyframes: string[],
  timesMs: number[],
  springs: Record<string, unknown>,
  worstCount = 4
): Promise<VisualReport> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const cmp = await browser.newPage();
  try {
    await page.setViewport({ width: 640, height: 400, deviceScaleFactor: 1 });
    // Inlined ahead of the page's scripts (evaluateOnNewDocument does not apply to setContent).
    const prelude = `<script>${VIRTUAL_CLOCK}</script><script>window.MC_SPRING=${JSON.stringify(springs)};</script><style>#mc-controls{display:none!important}</style>`;
    const doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + prelude) : prelude + html;
    await page.setContent(doc, { waitUntil: "load", timeout: 15000 }).catch(() => {});
    // Real time for external CSS (e.g. Tailwind CDN) to apply; the page clock stays frozen.
    await new Promise((r) => setTimeout(r, 400));

    const shots: string[] = [];
    for (const t of timesMs) {
      await page.evaluate((tt) => (window as unknown as { __mcAdvance: (n: number) => void }).__mcAdvance(tt), t);
      const rect = await page.evaluate(() => {
        const el = document.getElementById("mc-stage");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 40 && r.height > 25 ? { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(640, r.width), height: Math.min(400, r.height) } : null;
      });
      const shot = await page.screenshot({ type: "jpeg", quality: 82, encoding: "base64", ...(rect ? { clip: rect } : {}) });
      shots.push(`data:image/jpeg;base64,${shot}`);
    }

    await cmp.setContent("<html><body></body></html>");
    const frames: VisualFrameScore[] = [];
    const composites: string[] = [];
    for (let i = 0; i < shots.length; i++) {
      const res = (await cmp.evaluate(
        `(${COMPARE_FN})(${JSON.stringify(keyframes[i])}, ${JSON.stringify(shots[i])}, ${JSON.stringify(`t=${Math.round(timesMs[i])}ms`)})`
      )) as { ssim: number; match: number; diag: FrameDiagnostics; composite: string };
      frames.push({
        tMs: timesMs[i],
        ssim: Number(res.ssim.toFixed(4)),
        match: Number(res.match.toFixed(4)),
        score: Number((0.4 * res.ssim + 0.6 * res.match).toFixed(4)),
        diag: res.diag,
      });
      composites.push(res.composite);
    }
    const score = frames.reduce((a, f) => a + f.score, 0) / Math.max(1, frames.length);
    const worst = frames
      .map((f, i) => ({ i, f }))
      .sort((p, q) => p.f.score - q.f.score)
      .slice(0, worstCount)
      .map(({ i, f }) => ({ tMs: f.tMs, score: f.score, image: composites[i], diag: f.diag }));
    return { score: Number(score.toFixed(4)), frames, worstPairs: worst };
  } finally {
    await page.close().catch(() => {});
    await cmp.close().catch(() => {});
  }
}
