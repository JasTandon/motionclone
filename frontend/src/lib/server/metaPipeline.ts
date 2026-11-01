/**
 * MotionClone closed-loop pipeline (server only):
 *
 *   1. Muse Spark 1.3  — multi-frame reasoning: archetype, 5 phases, layers + per-keyframe boxes
 *   2. SAM 3.1         — re-segments every layer on sampled keyframes; replaces Muse's boxes
 *                        with SAM's, and reports cross-model IoU agreement
 *   3. LM spring fit   — ω₀, ζ, onset per layer from the fused tracks (real R², RMSE)
 *   4. Muse Spark 1.3  — code synthesis grounded in the measured tracks and fitted constants
 *   5. Self-heal       — static lint + JS parse of the generated document; one Muse repair pass
 */
import fs from "fs";
import { AnalysisPayload, BoxRect, PipelineEvent, TrackSample, TrackedLayer } from "@/types/motion";
import { buildMeasuredLayer, GlobalMotionFit, iou, sanitizeBox, STAGE_H, STAGE_W } from "@/lib/trackFusion";
import {
  buildDeterministicPreviewHtml,
  extractHtmlDocument,
  extractReactCode,
  lintGeneratedHtml,
  sanitizeGeneratedHtml,
} from "@/lib/generatedHtml";
import { buildCssCode, buildReactFallbackCode, buildSwiftUICode } from "@/lib/codegen";
import { findChrome, renderAndScore, VisualReport, warmBrowser } from "./visualVerify";

export const META_BASE_URL = (process.env.META_BASE_URL || "https://api.meta.ai/v1").replace(/\/$/, "");
export const MUSE_MODEL_ID = process.env.MUSE_MODEL_ID || "muse-spark-1.3";
export const SAM_MODEL_ID = process.env.SAM_MODEL_ID || "sam-3.1";
const SAM_FRAMES_PER_LAYER = Number(process.env.SAM_FRAMES_PER_LAYER || 5);
const SAM_CONCURRENCY = Number(process.env.SAM_CONCURRENCY || 5);
const PALETTE = ["#06b6d4", "#a855f7", "#10b981", "#f59e0b"];
const VISUAL_TARGET = Number(process.env.VISUAL_TARGET || 0.9);
const VISUAL_MAX_ROUNDS = Number(process.env.VISUAL_MAX_ROUNDS || 2);
/** Variants requested in parallel per refine round (conservative, exploratory). */
const REFINE_TEMPERATURES = [0.1, 0.5];

export interface PipelineInput {
  apiKey: string;
  fileName: string;
  durationMs: number;
  keyframes: string[];
  keyframeTimesMs: number[];
  motionTrack: TrackSample[];
  globalFit: GlobalMotionFit | null;
  customPrompts: string;
  /** "Refine again": skip perception/synthesis and run visual refinement on this previous result. */
  continueFrom?: AnalysisPayload | null;
}

export type { PipelineEvent, StageId } from "@/types/motion";

export class MetaApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function metaPost(path: string, body: unknown, apiKey: string, timeoutMs: number, attempt = 0): Promise<any> {
  let resp: Response;
  try {
    resp = await fetch(`${META_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = (err as Error).name;
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause ? ` (${cause.code || cause.message})` : "";
    // Up to two retries for transient network failures (not timeouts — those already spent the budget).
    if (name !== "TimeoutError" && attempt < 2) {
      console.warn(`[motionclone] ${path} network error${detail}; retry ${attempt + 1}/2`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return metaPost(path, body, apiKey, timeoutMs, attempt + 1);
    }
    throw new MetaApiError(
      name === "TimeoutError" ? 504 : 502,
      name === "TimeoutError" ? `Meta API ${path} timed out after ${Math.round(timeoutMs / 1000)}s` : `Could not reach Meta API: ${String(err)}${detail}`
    );
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new MetaApiError(resp.status, `Meta API ${path} returned HTTP ${resp.status}: ${text.slice(0, 240)}`);
  }
  return resp.json();
}

export async function museChat(
  apiKey: string,
  prompt: string,
  images: string[],
  timeoutMs: number,
  temperature = 0.1
): Promise<string> {
  const data = await metaPost(
    "/chat/completions",
    {
      model: MUSE_MODEL_ID,
      temperature,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))],
        },
      ],
    },
    apiKey,
    timeoutMs
  );
  return String(data?.choices?.[0]?.message?.content ?? "");
}

/** First balanced top-level JSON object in a model reply (tolerates fences and prose). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// SAM 3.1 response parsing. The detector output schema is treated as untrusted: we walk the
// JSON for box-like records (xywh / xyxy / normalized), scores and mask outlines, and use the
// Muse box for the same frame to disambiguate array conventions.
// ---------------------------------------------------------------------------------------------
interface SamCandidate {
  boxes: BoxRect[];
  score: number;
  maskPath?: string;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

function toStage(vals: number[], normalized: boolean) {
  return normalized ? [vals[0] * STAGE_W, vals[1] * STAGE_H, vals[2] * STAGE_W, vals[3] * STAGE_H] : vals;
}

function boxesFromArray(a: number[], hint: string): BoxRect[] {
  const normalized = a.every((v) => Math.abs(v) <= 1.5);
  const [p, q, r, s] = toStage(a, normalized);
  const xywh = sanitizeBox({ x: p, y: q, width: r, height: s });
  const xyxy = r > p && s > q ? sanitizeBox({ x: p, y: q, width: r - p, height: s - q }) : null;
  if (/xyxy|x1y1/i.test(hint)) return xyxy ? [xyxy] : [];
  if (/xywh/i.test(hint)) return xywh ? [xywh] : [];
  return [xywh, xyxy].filter((b): b is BoxRect => !!b);
}

function polygonToPath(points: unknown): string | undefined {
  if (!Array.isArray(points) || points.length < 3) return undefined;
  const flat: number[][] = Array.isArray(points[0])
    ? (points as unknown[][]).map((p) => [num(p[0]), num(p[1])])
    : (points as Record<string, unknown>[]).map((p) => [num(p?.x), num(p?.y)]);
  if (!flat.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return undefined;
  const norm = flat.every((p) => Math.abs(p[0]) <= 1.5 && Math.abs(p[1]) <= 1.5);
  const pts = flat.map(([x, y]) => (norm ? [x * STAGE_W, y * STAGE_H] : [x, y]));
  return `M ${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L ")} Z`;
}

/**
 * SAM 3.1 on /v1/responses returns detections as tokens inside output_text, one per instance:
 *   <|box;x1=130;y1=94;x2=510;y2=271;w=640;h=400|><|mask;x=0;y=0;data=…|>
 * Coordinates are in the w×h of the input image; empty text means no instance matched.
 */
export function parseSamBoxTokens(text: string): SamCandidate[] {
  const out: SamCandidate[] = [];
  const re = /<\|box;([^|]*)\|>/g;
  let m: RegExpExecArray | null;
  let rank = 0;
  while ((m = re.exec(text))) {
    const kv = Object.fromEntries(
      m[1].split(";").map((pair) => {
        const [k, v] = pair.split("=");
        return [k.trim(), Number(v)];
      })
    ) as Record<string, number>;
    const w = kv.w > 0 ? kv.w : STAGE_W;
    const h = kv.h > 0 ? kv.h : STAGE_H;
    const box = sanitizeBox({
      x: (kv.x1 * STAGE_W) / w,
      y: (kv.y1 * STAGE_H) / h,
      width: ((kv.x2 - kv.x1) * STAGE_W) / w,
      height: ((kv.y2 - kv.y1) * STAGE_H) / h,
    });
    // Instances arrive in confidence order; no explicit score is returned.
    if (box) out.push({ boxes: [box], score: Math.max(0.3, 0.9 - rank++ * 0.1) });
  }
  return out;
}

export function extractSamCandidates(payload: unknown): SamCandidate[] {
  const out: SamCandidate[] = [];
  const visit = (node: unknown, depth: number, keyHint: string) => {
    if (depth > 9 || node == null) return;
    if (typeof node === "string") {
      if (node.includes("<|box;")) {
        out.push(...parseSamBoxTokens(node));
        return;
      }
      if (node.length > 2 && node.length < 200000 && /^\s*[[{]/.test(node)) {
        try {
          visit(JSON.parse(node), depth + 1, keyHint);
        } catch {
          // not JSON
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      if (node.length === 4 && node.every((v) => Number.isFinite(num(v))) && /box|bbox|bound|rect/i.test(keyHint)) {
        out.push({ boxes: boxesFromArray(node as number[], keyHint), score: 0.5 });
        return;
      }
      node.forEach((child) => visit(child, depth + 1, keyHint));
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const score = num(o.score ?? o.confidence ?? o.probability ?? o.iou_score);
    const maskPath =
      (typeof o.svg_path === "string" && o.svg_path.trim().startsWith("M") ? o.svg_path : undefined) ||
      (typeof o.path === "string" && o.path.trim().startsWith("M") ? o.path : undefined) ||
      polygonToPath(o.polygon ?? o.points ?? o.contour);
    const format = String(o.format ?? o.box_format ?? "");
    let boxes: BoxRect[] = [];
    const xywhVals = [o.x, o.y, o.width ?? o.w, o.height ?? o.h].map(num);
    if (xywhVals.every(Number.isFinite)) {
      boxes = boxesFromArray(xywhVals, "xywh");
    } else if ([o.x1, o.y1, o.x2, o.y2].every((v) => Number.isFinite(num(v)))) {
      boxes = boxesFromArray([num(o.x1), num(o.y1), num(o.x2), num(o.y2)], "xyxy");
    } else if ([o.xmin, o.ymin, o.xmax, o.ymax].every((v) => Number.isFinite(num(v)))) {
      boxes = boxesFromArray([num(o.xmin), num(o.ymin), num(o.xmax), num(o.ymax)], "xyxy");
    }
    for (const key of ["bbox", "box", "bounding_box", "boundingBox", "box_xyxy", "box_xywh", "xyxy", "xywh"]) {
      const v = o[key];
      if (Array.isArray(v) && v.length === 4 && v.every((x) => Number.isFinite(num(x)))) {
        boxes = boxes.concat(boxesFromArray(v as number[], `${key} ${format}`));
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        const b = sanitizeBox(v);
        if (b) boxes.push(b);
      }
    }
    if (boxes.length) {
      out.push({ boxes, score: Number.isFinite(score) ? score : 0.5, maskPath });
    }
    for (const [k, v] of Object.entries(o)) {
      if (["bbox", "box", "bounding_box", "boundingBox", "polygon", "points", "contour"].includes(k)) continue;
      visit(v, depth + 1, k);
    }
  };
  visit(payload, 0, "");
  return out;
}

/** Best SAM box for one frame: highest score, disambiguated by IoU with Muse's box when present. */
export function pickSamBox(cands: SamCandidate[], museBox: BoxRect | null): { box: BoxRect; iouWithMuse: number | null; maskPath?: string } | null {
  let best: { box: BoxRect; rank: number; iouWithMuse: number | null; maskPath?: string } | null = null;
  for (const c of cands) {
    for (const b of c.boxes) {
      const agreement = museBox ? iou(b, museBox) : null;
      const rank = c.score + (agreement ?? 0) * 1.5;
      if (!best || rank > best.rank) best = { box: b, rank, iouWithMuse: agreement, maskPath: c.maskPath };
    }
  }
  if (!best) return null;
  // SAM found a different instance than Muse described — keep Muse for this frame.
  if (museBox && best.iouWithMuse !== null && best.iouWithMuse < 0.05) return null;
  return best;
}

async function samSegment(apiKey: string, concept: string, image: string, timeoutMs: number) {
  return metaPost(
    "/responses",
    {
      model: SAM_MODEL_ID,
      stream: false,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: concept },
            { type: "input_image", image_url: image },
          ],
        },
      ],
    },
    apiKey,
    timeoutMs
  );
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    })
  );
  return results;
}

// ---------------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------------
function detectionPrompt(n: number, fileName: string, timesMs: number[]) {
  return `You are Meta Muse Spark 1.3 inside MotionClone, a video-to-spring-physics UI compiler.
You are given ${n} chronological frames of "${fileName}", each resized to a 640x400 canvas.
Frame timestamps (ms): ${timesMs.map((t, i) => `F${i + 1}=${t}`).join(", ")}.

Rules:
- Describe ONLY what is visible. If this is a camera recording of a screen, ignore the bezel, glare and room.
- Pick 1 to 4 layers that MOVE or MORPH (position, size, shape, opacity). Skip static backgrounds.
- For every layer give "track": an array of exactly ${n} entries, one per frame, each [x, y, width, height]
  in 640x400 canvas pixels, or null when the layer is not visible in that frame. Measure each frame — do not interpolate.
- "samPrompt" is what the SAM 3.1 segmenter will search for. It only understands plain visual nouns:
  1–3 words of color + generic shape/object ("black rounded rectangle", "green circle", "blue button", "white text").
  Never use UI jargon (no "pill container", "dynamic island", "equalizer"). "samFallbackPrompt" is the bare shape ("rounded rectangle", "circle").
- Classify "animationArchetype": "gooey_metaball_blobs" (blobs merging through liquid bridges),
  "face_id_3d_morph" (icon/brackets morphing into 3D rotating rings + checkmark), or "general_ui_choreography".

Return ONLY JSON:
{
  "animationArchetype": "general_ui_choreography",
  "interactionTitle": "short polished title",
  "interactionSummary": "1–2 sentences on what moves and how it feels",
  "sceneBackgroundHex": "#0b1011",
  "primaryAccentHex": "#7ef7c8",
  "secondaryAccentHex": "#45e3a8",
  "phases": ["Frames 1-2: ...", "Frame 3: ...", "Frames 4-5: ...", "Frames 6-8: ...", "Frames 9-10: ..."],
  "layers": [
    { "name": "Pill container", "samPrompt": "black rounded rectangle", "samFallbackPrompt": "rounded rectangle", "colorHex": "#0c0d12", "role": "container",
      "shape": "pill | circle | rect | icon | text | path", "cornerRadius": 24,
      "track": [[232, 70, 176, 48], null, ...] }
  ]
}`;
}

const ARCHETYPE_TECHNIQUE: Record<string, string> = {
  gooey_metaball_blobs: `TECHNIQUE (gooey metaballs): render blobs as SVG circles inside <g filter="url(#goo)"> where
#goo = feGaussianBlur(stdDeviation≈10) → feColorMatrix alpha row "0 0 0 22 -9" (threshold), optionally a second
offset, lower-opacity rim layer for crescent highlights and a soft bloom (feGaussianBlur + feMerge). Drive each circle's
cx/cy/r from the measured keyframe table below so merges and teardrop necks happen at the observed times.`,
  face_id_3d_morph: `TECHNIQUE (icon → 3D ring morph): morph container geometry (size + border-radius) with springs, draw
icon strokes as SVG paths whose geometry is a function of a morph parameter (corners → rounded oval), project 3D rings
with a perspective divide (x' = x·f/(f+z)) while rotating about Y, then draw the checkmark via stroke-dashoffset with a
spring pop. Every timing comes from the measured keyframe table below.`,
  general_ui_choreography: `TECHNIQUE: one requestAnimationFrame loop computing every element from t; recreate inner
details (icons, text bars, gradients, shadows, radii) seen in the frames at their measured positions.`,
};

function synthesisPrompt(
  ctx: { fileName: string; title: string; summary: string; archetype: string; bg: string; accent1: string; accent2: string; phases: string[]; durationMs: number },
  layers: TrackedLayer[]
) {
  const table = layers
    .map((l, i) => {
      const rows = (l.track ?? [])
        .map((s) => `      t=${Math.round(s.tMs)}ms ${s.box ? `[${[s.box.x, s.box.y, s.box.width, s.box.height].map((v) => Math.round(v)).join(", ")}]` : "hidden"} (${s.source})`)
        .join("\n");
      return `  Layer ${i + 1} "${l.name}" id=${l.id} color ${l.colorHex} — spring { stiffness: ${l.physics.stiffness}, damping: ${l.physics.damping}, mass: 1 } (ζ=${l.physics.damping_ratio}, ω₀=${l.physics.natural_freq_rad} rad/s, onset ${Math.round(l.physics.stagger_delay_ms)}ms, R²=${l.physics.r_squared})
    Keyframes [x, y, w, h] on the 640x400 canvas (sam = SAM 3.1 segmentation, muse = your estimate):
${rows}`;
    })
    .join("\n");
  return `You are Meta Muse Spark 1.3 inside MotionClone. Rebuild the animation in "${ctx.fileName}" as working code.
Title: ${ctx.title}
Summary: ${ctx.summary}
Archetype: ${ctx.archetype}. Background ${ctx.bg}; accents ${ctx.accent1}, ${ctx.accent2}. Clip length ${ctx.durationMs}ms.
Phases:
${ctx.phases.map((p) => `- ${p}`).join("\n")}

MEASURED TRACKS + FITTED SPRINGS (ground truth — follow these positions and times):
${table}

${ARCHETYPE_TECHNIQUE[ctx.archetype] ?? ARCHETYPE_TECHNIQUE.general_ui_choreography}

HARD REQUIREMENTS for the HTML document:
1. Self-contained HTML5 (inline CSS/JS; Tailwind CDN allowed). Body background ${ctx.bg}, overflow hidden, no header text.
   Put the animation in ONE element with id="mc-stage": a 640x400 coordinate space identical to the table above (same
   positions, same background ${ctx.bg}), centered and scaled with a CSS transform to fit the viewport (shown in a ~520x325 iframe).
   The clone is rendered headlessly and compared frame-by-frame with the video, so #mc-stage must look exactly like the video frame.
2. Live physics contract: read springs from window.MC_SPRING, which the host injects and updates:
     const MC = window.MC_SPRING || { stiffness: ${layers[0]?.physics.stiffness ?? 300}, damping: ${layers[0]?.physics.damping ?? 20}, mass: 1, layers: {} };
     const springOf = (id, fallback) => (MC.layers && MC.layers[id]) || fallback;
   and evaluate motion with the analytic damped harmonic oscillator step response
     ω₀ = √(k/m), ζ = c/(2√(km)), u(t) = 1 − e^(−ζω₀t)(cos ω_d t + ζ/√(1−ζ²) sin ω_d t), ω_d = ω₀√(1−ζ²)  (critically damped when ζ ≥ 1).
   Use each layer's id from the table with springOf(...).
3. One requestAnimationFrame loop with renderAt(t), t = performance.now() − start, start captured at page load, so
   renderAt(t) at t ms matches the video at t ms (same timeline as the table). Run 0..${ctx.durationMs}ms, then loop after a short pause.
   Clicking the stage restarts it. Put a compact control bar with id="mc-controls" OUTSIDE #mc-stage, below it, with
   Phase 1–5 buttons and "Loop All".
4. Every <svg> and open stroke <path> has fill="none" unless intentionally filled. Never emit NaN in path data.

Reply with exactly two fenced blocks:
\`\`\`html
(complete document)
\`\`\`
\`\`\`tsx
(React + Framer Motion component; use transition={{ type: "spring", stiffness, damping, mass }} with the exact fitted numbers above)
\`\`\``;
}

function repairPrompt(issues: string[], html: string) {
  return `You are Meta Muse Spark 1.3 inside MotionClone. The HTML document below failed automated verification:
${issues.map((i) => `- ${i}`).join("\n")}

Fix every issue while keeping the animation, layout and the window.MC_SPRING contract unchanged.
Reply with exactly one \`\`\`html fenced block containing the complete corrected document.

\`\`\`html
${html}
\`\`\``;
}

function visualRefinePrompt(report: VisualReport, html: string, ctx: { title: string; summary: string; layers: TrackedLayer[] }) {
  const frames = report.frames.map((f) => `t=${Math.round(f.tMs)}ms ${(f.score * 100).toFixed(0)}%`).join(", ");
  const b = (r: number[] | null) => (r ? `[${r.join(", ")}]` : "none");
  const size = (src: number[] | null, cl: number[] | null) =>
    src && cl ? ` (clone is ${Math.round((cl[2] / src[2]) * 100)}% wide, ${Math.round((cl[3] / src[3]) * 100)}% tall of the video)` : "";
  const diagnostics = report.worstPairs
    .map(
      (p, i) => `Image ${i + 1} — t=${Math.round(p.tMs)}ms, match ${(p.score * 100).toFixed(0)}%:
  background: video ${p.diag.bgSrc} vs clone ${p.diag.bgClone}
  content box [x,y,w,h]: video ${b(p.diag.contentSrc)} vs clone ${b(p.diag.contentClone)}${size(p.diag.contentSrc, p.diag.contentClone)}
  inner detail box: video ${b(p.diag.detailSrc)} vs clone ${b(p.diag.detailClone)}${size(p.diag.detailSrc, p.diag.detailClone)}`
    )
    .join("\n");
  const table = ctx.layers
    .map(
      (l) =>
        `- ${l.name} (id ${l.id}, ${l.colorHex}): ${(l.track ?? [])
          .filter((s) => s.box)
          .map((s) => `t=${Math.round(s.tMs)} [${[s.box!.x, s.box!.y, s.box!.width, s.box!.height].map(Math.round).join(",")}]`)
          .join(" ")}`
    )
    .join("\n");
  return `You are Meta Muse Spark 1.3 inside MotionClone. Your clone of "${ctx.title}" was rendered at the source video's
timestamps and compared frame by frame inside the content region (score = 0.4·SSIM + 0.6·fraction of content pixels whose colour matches).
Overall visual match: ${(report.score * 100).toFixed(1)}% — target ${(VISUAL_TARGET * 100).toFixed(0)}%.
Per frame: ${frames}
Each attached image is one of the ${report.worstPairs.length} worst frames: LEFT = source video, RIGHT = your clone at the same time,
both cropped to the same region and zoomed (the zoom and crop box are printed in the header) so fine detail is visible.
Measured differences (640x400 stage px — make the clone's numbers equal the video's):
${diagnostics}

Summary: ${ctx.summary}
Measured layer boxes [x,y,w,h] on the 640x400 stage:
${table}

Frames already at or above target — DO NOT change anything that affects them: ${
    report.frames.filter((f) => f.score >= VISUAL_TARGET).map((f) => `t=${Math.round(f.tMs)}ms`).join(", ") || "none yet"
  }.
Make the SMALLEST targeted edits that fix the differences in the pairs (element positions and sizes, shapes and corner
radii, colours, gradients, glows/shadows, inner details such as icons and strokes, missing or extra elements, and timing:
if the clone is ahead of or behind the video at a timestamp, retime that phase only). Do not restructure or rewrite code
that already matches — previous full rewrites scored lower. The stage background must match the video exactly.
Keep: the 640x400 #mc-stage, the #mc-controls bar outside it, the window.MC_SPRING contract, and renderAt(t) driven by
performance.now() from page load.
Reply with exactly one \`\`\`html fenced block containing the complete corrected document.

\`\`\`html
${html}
\`\`\``;
}

function springsFor(layers: TrackedLayer[]) {
  const map = Object.fromEntries(
    layers.map((l) => [l.id, { stiffness: l.physics.stiffness, damping: l.physics.damping, mass: l.physics.mass }])
  );
  const first = layers[0]?.physics;
  return { stiffness: first?.stiffness ?? 300, damping: first?.damping ?? 20, mass: 1, layers: map };
}

/**
 * ⑥ Visual verify + ⑦ refine: score the clone against the source frames in headless Chrome, then
 * show Muse Spark the worst source/clone pairs and keep whichever version scores best.
 */
async function visualLoop(
  input: PipelineInput,
  emit: (e: PipelineEvent) => void,
  startHtml: string,
  layers: TrackedLayer[],
  times: number[],
  ctx: { title: string; summary: string },
  remaining: () => number,
  priorHistory: number[] = [],
  maxRounds = VISUAL_MAX_ROUNDS,
  prevRounds = 0
): Promise<{ html: string; visualMatch: AnalysisPayload["visualMatch"] }> {
  if (!findChrome()) {
    emit({ type: "stage", stage: "visual-verify", status: "warn", message: "No local Chrome found (set CHROME_PATH) — visual verification skipped" });
    return { html: startHtml, visualMatch: null };
  }
  const springs = springsFor(layers);
  emit({ type: "stage", stage: "visual-verify", status: "start", message: "Rendering the clone at the video's timestamps in headless Chrome…" });
  let report: VisualReport;
  try {
    report = await renderAndScore(startHtml, input.keyframes, times, springs);
  } catch (err) {
    emit({ type: "stage", stage: "visual-verify", status: "warn", message: `Visual verification failed: ${(err as Error).message}` });
    return { html: startHtml, visualMatch: null };
  }
  const dumpPairs = (r: VisualReport, tag: string) => {
    if (process.env.MOTIONCLONE_DEBUG !== "1") return;
    try {
      fs.mkdirSync("/tmp/motionclone_pairs", { recursive: true });
      r.worstPairs.forEach((p, i) =>
        fs.writeFileSync(`/tmp/motionclone_pairs/${tag}_${i}_t${Math.round(p.tMs)}.jpg`, Buffer.from(p.image.split(",")[1], "base64"))
      );
    } catch {
      // debug only
    }
  };
  dumpPairs(report, "r0");
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const worst = report.frames.reduce((a, f) => (f.score < a.score ? f : a), report.frames[0]);
  emit({
    type: "stage",
    stage: "visual-verify",
    status: report.score >= VISUAL_TARGET ? "done" : "warn",
    message: `Visual match ${pct(report.score)} over ${report.frames.length} frames (target ${pct(VISUAL_TARGET)}) · worst t=${Math.round(worst.tMs)}ms ${pct(worst.score)}`,
  });

  let best = { html: startHtml, report };
  // Best-so-far trail: a continuation starts from the previous trail (its re-measure is not a new step).
  const history = priorHistory.length ? [...priorHistory] : [report.score];
  let roundsRun = 0;
  let rounds = 0;
  while (best.report.score < VISUAL_TARGET && rounds < maxRounds && remaining() > 100_000) {
    rounds++;
    roundsRun++;
    emit({
      type: "stage",
      stage: "visual-refine",
      status: "start",
      message: `Round ${rounds}: Muse Spark drafting ${REFINE_TEMPERATURES.length} fixes from the ${best.report.worstPairs.length} worst source/clone frame pairs…`,
    });
    try {
      // Best-of-N: a conservative and an exploratory variant in parallel; keep the higher score.
      const prompt = visualRefinePrompt(best.report, best.html, { ...ctx, layers });
      const images = best.report.worstPairs.map((p) => p.image);
      const timeout = Math.min(150_000, remaining() - 30_000);
      const variants = await Promise.all(
        REFINE_TEMPERATURES.map(async (temp) => {
          try {
            const candidate = extractHtmlDocument(await museChat(input.apiKey, prompt, images, timeout, temp));
            const fatal = candidate ? lintGeneratedHtml(candidate).filter((i) => /syntax error|truncated/.test(i)) : ["no HTML in reply"];
            if (!candidate || fatal.length) return { rejected: fatal[0] };
            const cleaned = sanitizeGeneratedHtml(candidate);
            return { cleaned, report: await renderAndScore(cleaned, input.keyframes, times, springs) };
          } catch (err) {
            return { rejected: (err as Error).message };
          }
        })
      );
      const scored = variants.filter((v): v is { cleaned: string; report: VisualReport } => "report" in v && !!v.report);
      if (!scored.length) {
        const why = variants.map((v) => ("rejected" in v ? v.rejected : "")).filter(Boolean)[0];
        emit({ type: "stage", stage: "visual-refine", status: "warn", message: `Round ${rounds}: no usable variant (${why}) — kept ${pct(best.report.score)}` });
        continue;
      }
      const top = scored.reduce((a, v) => (v.report.score > a.report.score ? v : a));
      const cleaned = top.cleaned;
      const candReport = top.report;
      dumpPairs(candReport, `r${rounds}`);
      const tried = scored.map((v) => pct(v.report.score)).join(" / ");
      const improved = candReport.score > best.report.score;
      emit({
        type: "stage",
        stage: "visual-refine",
        status: improved ? "done" : "warn",
        message: improved
          ? `Round ${rounds}: ${pct(best.report.score)} → ${pct(candReport.score)} (variants ${tried})`
          : `Round ${rounds}: variants ${tried} did not beat ${pct(best.report.score)} — kept the better clone`,
      });
      if (improved) {
        best = { html: cleaned, report: candReport };
        history.push(candReport.score);
      }
    } catch (err) {
      emit({ type: "stage", stage: "visual-refine", status: "warn", message: `Round ${rounds}: ${(err as Error).message}` });
      break;
    }
  }
  if (!rounds && best.report.score >= VISUAL_TARGET) {
    emit({ type: "stage", stage: "visual-refine", status: "done", message: `Already at ${pct(best.report.score)} — no refinement needed` });
  }
  return {
    html: best.html,
    visualMatch: {
      score: best.report.score,
      target: VISUAL_TARGET,
      rounds: (prevRounds ?? 0) + roundsRun,
      history,
      frames: best.report.frames.map((f) => ({ tMs: f.tMs, score: f.score })),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------------------------
export async function runMotionClonePipeline(
  input: PipelineInput,
  emit: (e: PipelineEvent) => void
): Promise<AnalysisPayload> {
  const startedAt = Date.now();
  const budgetMs = 280_000;
  const remaining = () => budgetMs - (Date.now() - startedAt);
  warmBrowser();
  const n = input.keyframes.length;
  const times = input.keyframeTimesMs.length === n ? input.keyframeTimesMs : input.keyframes.map((_, i) => (i / Math.max(1, n - 1)) * input.durationMs);

  // "Refine again": continue from the previous best clone instead of starting over.
  const prev = input.continueFrom;
  if (prev?.livePreviewHtml && prev.layers?.length) {
    const { html, visualMatch } = await visualLoop(
      input,
      emit,
      prev.livePreviewHtml,
      prev.layers,
      times,
      { title: prev.interactionTitle, summary: prev.interactionSummary },
      remaining,
      prev.visualMatch?.history ?? [],
      VISUAL_MAX_ROUNDS + 1,
      prev.visualMatch?.rounds ?? 0
    );
    return { ...prev, livePreviewHtml: html, visualMatch };
  }

  // ---- 1. Muse Spark 1.3: multi-frame perception -------------------------------------------
  emit({ type: "stage", stage: "muse-detect", status: "start", message: `Muse Spark 1.3 reasoning over ${n} keyframes…` });
  const detectText = await museChat(input.apiKey, detectionPrompt(n, input.fileName, times), input.keyframes, 75_000);
  const det = extractJsonObject(detectText) ?? {};
  const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
  const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : d);
  const archetypeRaw = str(det.animationArchetype, "general_ui_choreography");
  const archetype = ARCHETYPE_TECHNIQUE[archetypeRaw] ? archetypeRaw : "general_ui_choreography";
  const title = str(det.interactionTitle, `Cloned UI (${input.fileName})`);
  const summary = str(det.interactionSummary, "UI motion reconstructed from sampled keyframes.");
  const bg = hex(det.sceneBackgroundHex, "#0b1011");
  const accent1 = hex(det.primaryAccentHex, "#7ef7c8");
  const accent2 = hex(det.secondaryAccentHex, "#45e3a8");
  const phases = Array.isArray(det.phases) ? det.phases.map(String).slice(0, 6) : [];
  const userConcepts = input.customPrompts.split(",").map((s) => s.trim()).filter(Boolean);

  const rawLayers = (Array.isArray(det.layers) ? det.layers : []) as Record<string, unknown>[];
  const layerSpecs = rawLayers
    .filter((l) => !/^absent/i.test(String(l?.name ?? "")))
    .slice(0, 4)
    .map((l, i) => {
      const trackRaw = Array.isArray(l.track) ? l.track : [];
      const track: TrackSample[] = times.map((tMs, f) => {
        const e = trackRaw[f];
        const box = Array.isArray(e) ? sanitizeBox({ x: e[0], y: e[1], width: e[2], height: e[3] }) : sanitizeBox(e);
        return { tMs, box, source: "muse" as const };
      });
      return {
        id: `layer-${i + 1}`,
        name: str(l.name, `Layer ${i + 1}`),
        samPrompt: userConcepts[i] || str(l.samPrompt, str(l.name, "UI element")),
        samFallbackPrompt: str(l.samFallbackPrompt, ""),
        colorHex: hex(l.colorHex, PALETTE[i % PALETTE.length]),
        role: str(l.role, "container"),
        cornerRadius: Number.isFinite(Number(l.cornerRadius)) ? Number(l.cornerRadius) : 18,
        track,
      };
    })
    .filter((s) => s.track.filter((t) => t.box).length >= 2);
  emit({
    type: "stage",
    stage: "muse-detect",
    status: layerSpecs.length ? "done" : "warn",
    message: layerSpecs.length
      ? `Muse Spark 1.3: "${title}" (${archetype}) — ${layerSpecs.length} moving layers, ${layerSpecs.reduce((a, s) => a + s.track.filter((t) => t.box).length, 0)} boxes`
      : "Muse Spark 1.3 returned no trackable layers — falling back to the pixel-diff motion envelope",
  });

  // ---- 2. SAM 3.1: per-keyframe segmentation of each Muse-proposed concept --------------------
  let agreeSum = 0;
  let agreePairs = 0;
  let samHits = 0;
  let samCalls = 0;
  let samErrors = 0;
  let samUnparsed = 0;
  const samRawSamples: unknown[] = [];
  if (layerSpecs.length) {
    emit({ type: "stage", stage: "sam-track", status: "start", message: `SAM 3.1 segmenting ${layerSpecs.length} concepts across keyframes…` });
    const jobs: { li: number; f: number }[] = [];
    for (let li = 0; li < layerSpecs.length; li++) {
      const visible = layerSpecs[li].track.map((t, f) => (t.box ? f : -1)).filter((f) => f >= 0);
      const k = Math.min(SAM_FRAMES_PER_LAYER, visible.length);
      const picks = new Set(Array.from({ length: k }, (_, j) => visible[Math.round((j * (visible.length - 1)) / Math.max(1, k - 1))]));
      picks.forEach((f) => jobs.push({ li, f }));
    }
    await mapLimit(jobs, SAM_CONCURRENCY, async ({ li, f }) => {
      samCalls++;
      const spec = layerSpecs[li];
      try {
        const resp = await samSegment(input.apiKey, spec.samPrompt, input.keyframes[f], 25_000);
        if (samRawSamples.length < 2) samRawSamples.push(resp);
        let cands = extractSamCandidates(resp);
        if (!cands.length && spec.samFallbackPrompt && spec.samFallbackPrompt !== spec.samPrompt) {
          samCalls++;
          cands = extractSamCandidates(await samSegment(input.apiKey, spec.samFallbackPrompt, input.keyframes[f], 25_000));
        }
        if (!cands.length) {
          samUnparsed++;
          return;
        }
        const museBox = spec.track[f].box;
        const pick = pickSamBox(cands, museBox);
        if (!pick) return;
        samHits++;
        if (pick.iouWithMuse !== null) {
          agreeSum += pick.iouWithMuse;
          agreePairs++;
        }
        spec.track[f] = { tMs: spec.track[f].tMs, box: pick.box, source: "sam", maskPath: pick.maskPath };
      } catch (err) {
        samErrors++;
        if (samRawSamples.length < 2) samRawSamples.push({ error: (err as Error).message });
      }
    });
    const meanIoU = agreePairs ? agreeSum / agreePairs : 0;
    emit({
      type: "stage",
      stage: "sam-track",
      status: samHits ? "done" : "warn",
      message: samHits
        ? `SAM 3.1 replaced ${samHits}/${samCalls} keyframe boxes · cross-model IoU vs Muse = ${meanIoU.toFixed(2)}`
        : `SAM 3.1: 0/${samCalls} usable boxes (${samErrors} errors, ${samUnparsed} with no matching instance) — using Muse Spark tracks`,
    });
  }

  // ---- 3. Inverse spring identification -------------------------------------------------------
  emit({ type: "stage", stage: "spring-fit", status: "start", message: "Fitting damped-oscillator springs (Levenberg–Marquardt)…" });
  let layers: TrackedLayer[] = layerSpecs.map((s) => buildMeasuredLayer(s, input.durationMs, input.globalFit));
  if (!layers.length && input.motionTrack.some((s) => s.box)) {
    const firstMoving = input.motionTrack.findIndex((s) => s.box);
    const track = firstMoving > 0 ? [{ ...input.motionTrack[firstMoving], tMs: 0 }, ...input.motionTrack.slice(1)] : input.motionTrack;
    layers = [
      buildMeasuredLayer(
        { id: "layer-1", name: "Motion Envelope (pixel diff)", samPrompt: "moving UI region", colorHex: PALETTE[0], role: "container", cornerRadius: 10, track },
        input.durationMs,
        input.globalFit
      ),
    ];
  }
  emit({
    type: "stage",
    stage: "spring-fit",
    status: layers.length ? "done" : "warn",
    message: layers.length
      ? layers.map((l) => `${l.name.slice(0, 28)}: k=${l.physics.stiffness}, c=${l.physics.damping}, ζ=${l.physics.damping_ratio}, R²=${l.physics.r_squared}`).join(" · ")
      : "No measurable motion found in this clip",
  });

  // ---- 4. Grounded synthesis ------------------------------------------------------------------
  emit({ type: "stage", stage: "muse-synth", status: "start", message: "Muse Spark 1.3 compiling a 60fps clone from the measured tracks…" });
  let html: string | null = null;
  let reactCode: string | null = null;
  try {
    const synthText = await museChat(
      input.apiKey,
      synthesisPrompt({ fileName: input.fileName, title, summary, archetype, bg, accent1, accent2, phases, durationMs: input.durationMs }, layers),
      input.keyframes,
      Math.min(150_000, Math.max(30_000, remaining() - 40_000))
    );
    html = extractHtmlDocument(synthText);
    reactCode = extractReactCode(synthText);
    emit({
      type: "stage",
      stage: "muse-synth",
      status: html ? "done" : "warn",
      message: html ? `Muse Spark 1.3 synthesized ${Math.round(html.length / 1024)}KB HTML${reactCode ? " + React component" : ""}` : "Synthesis reply had no HTML document — using the deterministic track renderer",
    });
  } catch (err) {
    emit({ type: "stage", stage: "muse-synth", status: "warn", message: `${(err as Error).message} — using the deterministic track renderer` });
  }

  // ---- 5. Self-heal ---------------------------------------------------------------------------
  let selfHeal: AnalysisPayload["selfHeal"] = null;
  if (html) {
    emit({ type: "stage", stage: "self-heal", status: "start", message: "Verifying generated code (lint + JS parse)…" });
    const issues = lintGeneratedHtml(html);
    if (issues.length && remaining() > 60_000) {
      try {
        const fixedText = await museChat(input.apiKey, repairPrompt(issues, html), [], Math.min(110_000, remaining() - 15_000));
        const fixed = extractHtmlDocument(fixedText);
        const after = fixed ? lintGeneratedHtml(fixed) : issues;
        const repaired = !!fixed && after.length < issues.length;
        if (repaired && fixed) html = fixed;
        selfHeal = { issuesFound: issues, repaired };
        emit({
          type: "stage",
          stage: "self-heal",
          status: repaired ? "done" : "warn",
          message: repaired ? `Self-heal: Muse Spark fixed ${issues.length - after.length}/${issues.length} issues` : `Self-heal could not fix: ${issues[0]}`,
        });
      } catch (err) {
        selfHeal = { issuesFound: issues, repaired: false };
        emit({ type: "stage", stage: "self-heal", status: "warn", message: `Self-heal skipped: ${(err as Error).message}` });
      }
    } else {
      selfHeal = { issuesFound: issues, repaired: false };
      emit({
        type: "stage",
        stage: "self-heal",
        status: issues.length ? "warn" : "done",
        message: issues.length ? `${issues.length} issue(s) found, no time budget left to repair` : "Generated code passed all checks",
      });
    }
  }

  let finalHtml = html ? sanitizeGeneratedHtml(html) : layers.length ? buildDeterministicPreviewHtml(layers, bg, input.durationMs) : undefined;

  // ---- 6–7. Visual verify + refine -------------------------------------------------------------
  let visualMatch: AnalysisPayload["visualMatch"] = null;
  if (finalHtml) {
    const out = await visualLoop(input, emit, finalHtml, layers, times, { title, summary }, remaining);
    finalHtml = out.html;
    visualMatch = out.visualMatch;
  }

  const result: AnalysisPayload = {
    presetId: "custom-upload",
    interactionTitle: title,
    interactionSummary: summary,
    sceneBackgroundHex: bg,
    videoMeta: { fps: Number((n / Math.max(0.1, input.durationMs / 1000)).toFixed(1)), frameCount: n, width: STAGE_W, height: STAGE_H, durationMs: input.durationMs },
    usedLiveMetaApi: true,
    crossModelAgreement: agreePairs ? { meanIoU: Number((agreeSum / agreePairs).toFixed(3)), pairs: agreePairs } : null,
    selfHeal,
    visualMatch,
    pipelineMetadata: {
      perceptionModel: samHits ? `${SAM_MODEL_ID} (${samHits} keyframe masks) + ${MUSE_MODEL_ID}` : `${MUSE_MODEL_ID} (SAM 3.1 unavailable)`,
      reasoningModel: MUSE_MODEL_ID,
      physicsSolver: "Damped harmonic oscillator · Levenberg–Marquardt",
      framesAnalyzed: n,
    },
    layers,
    livePreviewHtml: finalHtml,
    codeExports: {
      reactCode: reactCode || buildReactFallbackCode(title, layers, {}),
      swiftuiCode: buildSwiftUICode(title, layers, {}, bg),
      cssCode: buildCssCode(title, layers, {}),
    },
  };

  if (process.env.MOTIONCLONE_DEBUG === "1") {
    try {
      fs.writeFileSync("/tmp/motionclone_debug.json", JSON.stringify({ det, samRawSamples, detectText, result }, null, 2));
    } catch {
      // debug only
    }
  }
  return result;
}
