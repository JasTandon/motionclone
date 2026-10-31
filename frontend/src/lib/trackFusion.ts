/**
 * Turns measured per-keyframe boxes (SAM 3.1 / Muse Spark 1.3 / pixel-diff) into a
 * TrackedLayer whose spring constants are fitted to the measurements, not assumed.
 */
import { BoxRect, FrameBox, TelemetryPoint, TrackSample, TrackedLayer } from "@/types/motion";
import { fitSpring, normalizeTransition, overshootPct, settlingMs, springModel, SpringFit } from "./springFit";

export const STAGE_W = 640;
export const STAGE_H = 400;

export function roundedRectPath(x: number, y: number, w: number, h: number, r = 18): string {
  const rad = Math.max(1, Math.min(r, w / 2, h / 2));
  const f = (v: number) => v.toFixed(1);
  return `M ${f(x + rad)} ${f(y)} H ${f(x + w - rad)} A ${f(rad)} ${f(rad)} 0 0 1 ${f(x + w)} ${f(y + rad)} V ${f(y + h - rad)} A ${f(rad)} ${f(rad)} 0 0 1 ${f(x + w - rad)} ${f(y + h)} H ${f(x + rad)} A ${f(rad)} ${f(rad)} 0 0 1 ${f(x)} ${f(y + h - rad)} V ${f(y + rad)} A ${f(rad)} ${f(rad)} 0 0 1 ${f(x + rad)} ${f(y)} Z`;
}

/** Coerces untrusted model output into a finite, on-stage box (or null). */
export function sanitizeBox(raw: unknown): BoxRect | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN);
  let x = n(r.x);
  let y = n(r.y);
  let w = n(r.width ?? r.w);
  let h = n(r.height ?? r.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  x = Math.max(-STAGE_W * 0.25, Math.min(STAGE_W, x));
  y = Math.max(-STAGE_H * 0.25, Math.min(STAGE_H, y));
  w = Math.max(0, Math.min(STAGE_W * 1.5, w));
  h = Math.max(0, Math.min(STAGE_H * 1.5, h));
  if (w < 2 || h < 2) return null;
  return { x, y, width: w, height: h };
}

export function iou(a: BoxRect, b: BoxRect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

const vec = (b: BoxRect) => [b.x + b.width / 2, b.y + b.height / 2, b.width, b.height];

/**
 * Projects each box onto the dominant start→extreme displacement in (cx, cy, w, h) space,
 * giving a scalar trajectory whose overshoot past the rest state is preserved.
 */
export function trackToProgress(track: TrackSample[]): { samples: { tMs: number; u: number }[]; spanPx: number } {
  const visible = track.filter((s): s is TrackSample & { box: BoxRect } => !!s.box);
  if (visible.length < 3) return { samples: [], spanPx: 0 };
  const v0 = vec(visible[0].box);
  let far = v0;
  let farD = 0;
  for (const s of visible) {
    const v = vec(s.box);
    const d = Math.hypot(...v.map((c, i) => c - v0[i]));
    if (d > farD) {
      farD = d;
      far = v;
    }
  }
  if (farD < 4) return { samples: [], spanPx: farD };
  const dir = far.map((c, i) => c - v0[i]);
  const raw = visible.map((s) => {
    const v = vec(s.box);
    const dot = v.reduce((a, c, i) => a + (c - v0[i]) * dir[i], 0);
    return { tMs: s.tMs, u: Math.max(-0.5, dot / (farD * farD)) };
  });
  return { samples: normalizeTransition(raw), spanPx: farD };
}

function lerpBox(a: BoxRect, b: BoxRect, u: number): BoxRect {
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    width: a.width + (b.width - a.width) * u,
    height: a.height + (b.height - a.height) * u,
  };
}

/** Box at time t, interpolated between the measured keyframes that bracket it. */
export function boxAt(track: TrackSample[], tMs: number): BoxRect | null {
  if (!track.length) return null;
  if (tMs <= track[0].tMs) return track[0].box;
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (tMs >= a.tMs && tMs <= b.tMs) {
      if (!a.box || !b.box) return (tMs - a.tMs < b.tMs - tMs ? a.box : b.box) ?? null;
      const u = (tMs - a.tMs) / Math.max(1, b.tMs - a.tMs);
      return lerpBox(a.box, b.box, u);
    }
  }
  return track[track.length - 1].box;
}

export interface MeasuredLayerSpec {
  id: string;
  name: string;
  samPrompt: string;
  colorHex: string;
  role: string;
  cornerRadius?: number;
  track: TrackSample[];
}

/** Clip-wide timing measured without any model: pixel-energy progress samples and their fit. */
export interface GlobalMotionFit {
  fit: SpringFit;
  samples: { tMs: number; u: number }[];
}

export function buildMeasuredLayer(
  spec: MeasuredLayerSpec,
  durationMs: number,
  global: GlobalMotionFit | null,
  numFrames = 60
): TrackedLayer {
  const own = trackToProgress(spec.track);
  const measuredFit = own.samples.length >= 3 ? fitSpring(own.samples) : null;
  const fallback = global?.fit ?? null;
  // Layers without their own measurable transition are verified against the global samples.
  const samples = measuredFit ? own.samples : global?.samples ?? [];
  const spanPx = own.spanPx;
  const fit: SpringFit =
    measuredFit ??
    fallback ?? {
      omega0: 18,
      zeta: 0.62,
      onsetMs: 0,
      stiffness: 324,
      damping: 22.32,
      rSquared: 0,
      rmse: 0,
      iterations: 0,
      samples: 0,
    };

  const radius = spec.cornerRadius ?? 18;
  const firstBox = spec.track.find((s) => s.box)?.box ?? { x: 270, y: 150, width: 100, height: 100 };
  const lastBox = [...spec.track].reverse().find((s) => s.box)?.box ?? firstBox;
  // Rest state of the first transition: the measured sample whose progress is closest to u = 1.
  const restSample = samples.reduce<{ tMs: number; u: number } | null>(
    (best, s) => (!best || Math.abs(s.u - 1) < Math.abs(best.u - 1) ? s : best),
    null
  );
  const extreme = (restSample && boxAt(spec.track, restSample.tMs)) || lastBox;

  const frames: FrameBox[] = [];
  const firstT = spec.track.find((s) => s.box)?.tMs ?? 0;
  const lastT = [...spec.track].reverse().find((s) => s.box)?.tMs ?? durationMs;
  const stepMs = durationMs / Math.max(1, spec.track.length - 1);
  for (let i = 0; i < numFrames; i++) {
    const tMs = (i / Math.max(1, numFrames - 1)) * durationMs;
    const b = boxAt(spec.track, tMs) ?? firstBox;
    const visible = tMs >= firstT - stepMs * 0.5 && tMs <= lastT + stepMs * 0.5;
    const nearest = spec.track.reduce((a, s) => (Math.abs(s.tMs - tMs) < Math.abs(a.tMs - tMs) ? s : a), spec.track[0]);
    frames.push({
      frame_index: i,
      timestamp_ms: Number(tMs.toFixed(1)),
      x: Number(b.x.toFixed(1)),
      y: Number(b.y.toFixed(1)),
      width: Number(b.width.toFixed(1)),
      height: Number(b.height.toFixed(1)),
      svg_path:
        nearest?.maskPath && Math.abs(nearest.tMs - tMs) < stepMs * 0.3
          ? nearest.maskPath
          : roundedRectPath(b.x, b.y, b.width, b.height, radius),
      confidence: visible ? (nearest?.source === "sam" ? 0.97 : 0.8) : 0,
    });
  }

  const span = Math.max(spanPx, 40);
  const series: TelemetryPoint[] = samples
    .filter((s) => Number.isFinite(s.u))
    .map((s, i) => {
      const fitted = springModel(s.tMs, fit.omega0, fit.zeta, fit.onsetMs);
      const prev = springModel(s.tMs - 8, fit.omega0, fit.zeta, fit.onsetMs);
      const b = boxAt(spec.track, s.tMs) ?? firstBox;
      return {
        frame: i,
        timeMs: Number(s.tMs.toFixed(1)),
        empiricalNormalized: Number(s.u.toFixed(4)),
        fittedSpringNormalized: Number(fitted.toFixed(4)),
        x: Number(b.x.toFixed(1)),
        y: Number(b.y.toFixed(1)),
        width: Number(b.width.toFixed(1)),
        height: Number(b.height.toFixed(1)),
        velocityPxPerSec: Number((((fitted - prev) / 0.008) * span).toFixed(1)),
      };
    });

  const counts = spec.track.reduce<Record<string, number>>((a, s) => {
    if (s.box) a[s.source] = (a[s.source] || 0) + 1;
    return a;
  }, {});
  const label: Record<string, string> = { sam: "SAM 3.1", muse: "Muse Spark 1.3", pixel: "pixel-diff" };
  const fitSource = measuredFit
    ? `${Object.entries(counts)
        .map(([k, v]) => `${label[k]} ×${v}`)
        .join(" + ")} → LM fit on ${measuredFit.samples} samples${
        measuredFit.zeta <= 0.09 || measuredFit.omega0 <= 2.1 || measuredFit.omega0 >= 59
          ? " (hit solver bound — motion is not a single spring, e.g. looping/oscillating content)"
          : ""
      }`
    : fallback
    ? `No own transition — inherits clip-wide pixel-motion fit (${global?.samples.length ?? 0} samples)`
    : "Static layer — default spring";

  const os = overshootPct(fit.zeta);
  return {
    id: spec.id,
    name: spec.name,
    samPrompt: spec.samPrompt,
    colorHex: spec.colorHex,
    role: spec.role,
    frames,
    track: spec.track,
    fitSource,
    physics: {
      transition_type: fit.zeta < 1 ? "spring" : "spring-overdamped",
      stiffness: fit.stiffness,
      damping: fit.damping,
      mass: 1,
      damping_ratio: fit.zeta,
      natural_freq_rad: fit.omega0,
      overshoot_pct: Number(os.toFixed(1)),
      settling_duration_ms: settlingMs(fit.omega0, fit.zeta),
      stagger_delay_ms: fit.onsetMs,
      cubic_bezier: [0.25, 0, 0.2, Number((1 + os / 200).toFixed(2))],
      r_squared: measuredFit ? measuredFit.rSquared : fallback?.rSquared ?? 0,
      dominant_axis: dominantAxis(firstBox, extreme),
      start_state: firstBox,
      end_state: measuredFit ? extreme : lastBox,
      telemetry_series: series,
    },
  };
}

function dominantAxis(a: BoxRect, b: BoxRect) {
  const d = {
    x: Math.abs(b.x + b.width / 2 - (a.x + a.width / 2)),
    y: Math.abs(b.y + b.height / 2 - (a.y + a.height / 2)),
    width: Math.abs(b.width - a.width),
    height: Math.abs(b.height - a.height),
  };
  return Object.entries(d).sort((p, q) => q[1] - p[1])[0][0];
}
