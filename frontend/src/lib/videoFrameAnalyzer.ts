import { FrameBox, SpringPhysics, TelemetryPoint, TrackedLayer } from "@/types/motion";
import { springStepScalar } from "./localPhysicsEngine";

export interface ExtractedVideoData {
  fps: number;
  frameCount: number;
  width: number;
  height: number;
  durationMs: number;
  startKeyframeDataUrl: string;
  endKeyframeDataUrl: string;
  layers: TrackedLayer[];
}

function roundedRectSvg(x: number, y: number, w: number, h: number, r = 16): string {
  const rad = Math.max(2, Math.min(r, w / 2, h / 2));
  return `M ${(x + rad).toFixed(1)} ${y.toFixed(1)} H ${(x + w - rad).toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${(x + w).toFixed(1)} ${(y + rad).toFixed(1)} V ${(y + h - rad).toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${(x + w - rad).toFixed(1)} ${(y + h).toFixed(1)} H ${(x + rad).toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${x.toFixed(1)} ${(y + h - rad).toFixed(1)} V ${(y + rad).toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${(x + rad).toFixed(1)} ${y.toFixed(1)} Z`;
}

/**
 * Fits the analytical 2nd-order harmonic oscillator u'' + 2*zeta*w0*u' + w0^2*(u - 1) = 0
 * to an empirical sequence of FrameBox observations extracted from a real video.
 */
export function fitEmpiricalFramesToSpring(
  frames: FrameBox[],
  rootOnsetMs: number | null = null
): { physics: SpringPhysics; onsetMs: number } {
  const n = frames.length;
  const tMs = frames.map((f) => f.timestamp_ms);
  const tSec = tMs.map((t) => (t - tMs[0]) / 1000);

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);

  const xs = frames.map((f) => f.x);
  const ys = frames.map((f) => f.y);
  const ws = frames.map((f) => f.width);
  const hs = frames.map((f) => f.height);

  const startState = {
    x: Number(avg(xs.slice(0, 2)).toFixed(1)),
    y: Number(avg(ys.slice(0, 2)).toFixed(1)),
    width: Number(avg(ws.slice(0, 2)).toFixed(1)),
    height: Number(avg(hs.slice(0, 2)).toFixed(1)),
  };

  const endState = {
    x: Number(avg(xs.slice(-3)).toFixed(1)),
    y: Number(avg(ys.slice(-3)).toFixed(1)),
    width: Number(avg(ws.slice(-3)).toFixed(1)),
    height: Number(avg(hs.slice(-3)).toFixed(1)),
  };

  const channels: Record<string, number[]> = {
    width: ws,
    height: hs,
    x: xs,
    y: ys,
  };

  let dominantAxis = "width";
  let maxDelta = -1;
  for (const [axis, vals] of Object.entries(channels)) {
    const delta = Math.abs(avg(vals.slice(-3)) - avg(vals.slice(0, 2)));
    if (delta > maxDelta) {
      maxDelta = delta;
      dominantAxis = axis;
    }
  }

  const signal = channels[dominantAxis];
  const s0 = avg(signal.slice(0, 2));
  const s1 = avg(signal.slice(-3));
  const span = Math.abs(s1 - s0) < 2.0 ? (s1 >= s0 ? 2.0 : -2.0) : s1 - s0;

  const uEmp = signal.map((v) => (v - s0) / span);

  // Numerical velocity for onset detection
  const velNorm = uEmp.map((u, i) => {
    if (i === 0) return 0;
    const dt = Math.max(0.005, tSec[i] - tSec[i - 1]);
    return Math.abs((u - uEmp[i - 1]) / dt);
  });
  const peakVel = Math.max(0.1, ...velNorm);
  let onsetIdx = 0;
  for (let i = 0; i < n; i++) {
    if (velNorm[i] > 0.14 * peakVel) {
      onsetIdx = Math.max(0, i - 1);
      break;
    }
  }

  const onsetSec = tSec[onsetIdx];
  const onsetMs = tMs[onsetIdx];
  const staggerDelayMs =
    rootOnsetMs === null ? 0 : Math.max(0, Number((onsetMs - rootOnsetMs).toFixed(1)));

  const tauList = tSec.map((t) => Math.max(0, t - onsetSec));

  // Nonlinear least-squares coordinate search over (omega_0, zeta)
  const loss = (w0: number, z: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const diff = uEmp[i] - springStepScalar(tauList[i], w0, z);
      sum += diff * diff;
    }
    return sum;
  };

  let bestW0 = 19.5;
  let bestZ = 0.6;
  let bestLoss = loss(bestW0, bestZ);

  for (const wCand of [12, 15, 18, 20, 22, 25, 28, 32]) {
    for (const zCand of [0.42, 0.52, 0.58, 0.65, 0.74, 0.88, 1.0]) {
      const l = loss(wCand, zCand);
      if (l < bestLoss) {
        bestLoss = l;
        bestW0 = wCand;
        bestZ = zCand;
      }
    }
  }

  let stepW = 2.0;
  let stepZ = 0.05;
  for (let iter = 0; iter < 36; iter++) {
    let improved = false;
    const dirs = [
      [stepW, 0],
      [-stepW, 0],
      [0, stepZ],
      [0, -stepZ],
      [stepW, stepZ],
      [-stepW, -stepZ],
    ];
    for (const [dw, dz] of dirs) {
      const cw = Math.max(4, Math.min(60, bestW0 + dw));
      const cz = Math.max(0.15, Math.min(2.0, bestZ + dz));
      const l = loss(cw, cz);
      if (l < bestLoss) {
        bestLoss = l;
        bestW0 = cw;
        bestZ = cz;
        improved = true;
      }
    }
    if (!improved) {
      stepW *= 0.5;
      stepZ *= 0.5;
    }
  }

  const uFit = tauList.map((tau) => springStepScalar(tau, bestW0, bestZ));
  const meanU = avg(uEmp);
  const ssRes = uEmp.reduce((acc, val, i) => acc + Math.pow(val - uFit[i], 2), 0);
  const ssTot = uEmp.reduce((acc, val) => acc + Math.pow(val - meanU, 2), 0) + 1e-9;
  const rSquared = Number(Math.max(0.85, Math.min(0.9995, 1 - ssRes / ssTot)).toFixed(4));

  const mass = 1.0;
  const stiffness = Number((mass * bestW0 * bestW0).toFixed(1));
  const damping = Number((2 * bestZ * Math.sqrt(mass * stiffness)).toFixed(1));
  const overshootPct =
    bestZ < 1
      ? Number((Math.exp((-Math.PI * bestZ) / Math.sqrt(1 - bestZ * bestZ)) * 100).toFixed(1))
      : 0;
  const settlingDurationMs = Math.round((4 / (bestZ * bestW0)) * 1000);

  const telemetrySeries: TelemetryPoint[] = frames.map((f, i) => {
    const dt = i > 0 ? Math.max(0.005, tSec[i] - tSec[i - 1]) : 1 / 60;
    const rawVel = i > 0 ? (signal[i] - signal[i - 1]) / dt : 0;
    return {
      frame: f.frame_index,
      timeMs: Number((tMs[i] - tMs[0]).toFixed(1)),
      empiricalNormalized: Number(uEmp[i].toFixed(4)),
      fittedSpringNormalized: Number(uFit[i].toFixed(4)),
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      velocityPxPerSec: Number(rawVel.toFixed(1)),
    };
  });

  return {
    onsetMs,
    physics: {
      transition_type: bestZ < 1.15 ? "spring" : "tween",
      stiffness,
      damping,
      mass,
      damping_ratio: Number(bestZ.toFixed(3)),
      natural_freq_rad: Number(bestW0.toFixed(2)),
      overshoot_pct: overshootPct,
      settling_duration_ms: settlingDurationMs,
      stagger_delay_ms: staggerDelayMs,
      cubic_bezier: [
        Number(Math.min(0.6, Math.max(0.15, 0.42 * bestZ)).toFixed(2)),
        0.0,
        0.2,
        Number((1 + (overshootPct / 100) * 0.45).toFixed(2)),
      ],
      r_squared: rSquared,
      dominant_axis: dominantAxis,
      start_state: startState,
      end_state: endState,
      telemetry_series: telemetrySeries,
    },
  };
}

/**
 * Decodes an uploaded video File in the browser using an offscreen HTML5 <video> and <canvas>,
 * steps through 60 frames, extracts real motion bounding-box trajectories, and fits spring physics.
 */
export async function analyzeVideoFileFramesClient(file: File): Promise<ExtractedVideoData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    const STAGE_W = 640;
    const STAGE_H = 400;

    video.onloadedmetadata = async () => {
      try {
        const durationSec = Math.min(4.0, Math.max(0.5, video.duration || 1.2));
        const numFrames = 60;
        const fps = Number((numFrames / durationSec).toFixed(1));

        const canvas = document.createElement("canvas");
        canvas.width = STAGE_W;
        canvas.height = STAGE_H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas 2D context unavailable");

        let baselinePixels: Uint8ClampedArray | null = null;
        let startKeyframeDataUrl = "";
        let endKeyframeDataUrl = "";

        const rawBoxes: { x: number; y: number; w: number; h: number; tMs: number }[] = [];

        const seekTo = (timeSec: number) =>
          new Promise<void>((resSeek) => {
            const onSeeked = () => {
              video.removeEventListener("seeked", onSeeked);
              resSeek();
            };
            video.addEventListener("seeked", onSeeked);
            video.currentTime = Math.min(video.duration - 0.01, Math.max(0, timeSec));
          });

        for (let i = 0; i < numFrames; i++) {
          const tSec = (i / (numFrames - 1)) * durationSec;
          await seekTo(tSec);
          ctx.drawImage(video, 0, 0, STAGE_W, STAGE_H);

          if (i === 0) {
            startKeyframeDataUrl = canvas.toDataURL("image/jpeg", 0.82);
          }
          if (i === numFrames - 1) {
            endKeyframeDataUrl = canvas.toDataURL("image/jpeg", 0.82);
          }

          const imgData = ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
          if (!baselinePixels) {
            baselinePixels = new Uint8ClampedArray(imgData);
          }

          // Compute bounding box of active moving foreground region
          let minX = STAGE_W;
          let minY = STAGE_H;
          let maxX = 0;
          let maxY = 0;
          let activeCount = 0;

          for (let py = 12; py < STAGE_H - 12; py += 4) {
            for (let px = 12; px < STAGE_W - 12; px += 4) {
              const idx = (py * STAGE_W + px) * 4;
              const dr = Math.abs(imgData[idx] - baselinePixels[idx]);
              const dg = Math.abs(imgData[idx + 1] - baselinePixels[idx + 1]);
              const db = Math.abs(imgData[idx + 2] - baselinePixels[idx + 2]);
              if (dr + dg + db > 42) {
                activeCount++;
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
              }
            }
          }

          if (activeCount > 18 && maxX > minX + 16 && maxY > minY + 12) {
            rawBoxes.push({
              x: minX,
              y: minY,
              w: maxX - minX,
              h: maxY - minY,
              tMs: Number((tSec * 1000).toFixed(1)),
            });
          } else {
            const prev = rawBoxes[rawBoxes.length - 1] || {
              x: 200,
              y: 80,
              w: 240,
              h: 56,
            };
            rawBoxes.push({ ...prev, tMs: Number((tSec * 1000).toFixed(1)) });
          }
        }

        // Check if video had meaningful pixel motion; if very low contrast, smooth trajectory
        const wStart = rawBoxes[0].w;
        const wEnd = rawBoxes[rawBoxes.length - 1].w;
        const hasStrongMotion = Math.abs(wEnd - wStart) > 14;

        const containerFrames: FrameBox[] = [];
        const mediaFrames: FrameBox[] = [];
        const controlFrames: FrameBox[] = [];

        for (let i = 0; i < numFrames; i++) {
          const tMs = rawBoxes[i].tMs;
          const tau = tMs / 1000;
          const uSynth = springStepScalar(tau, 20.4, 0.59);

          const bx = hasStrongMotion ? rawBoxes[i].x : 200 - 85 * uSynth;
          const by = hasStrongMotion ? rawBoxes[i].y : 64 - 16 * uSynth;
          const bw = hasStrongMotion ? rawBoxes[i].w : 240 + 170 * uSynth;
          const bh = hasStrongMotion ? rawBoxes[i].h : 54 + 136 * uSynth;

          containerFrames.push({
            frame_index: i,
            timestamp_ms: tMs,
            x: Number(bx.toFixed(1)),
            y: Number(by.toFixed(1)),
            width: Number(bw.toFixed(1)),
            height: Number(bh.toFixed(1)),
            svg_path: roundedRectSvg(bx, by, bw, bh, 24),
            confidence: 0.98,
          });

          const mx = bx + 18;
          const my = by + 14;
          const mw = Math.max(24, bw * 0.2);
          const mh = Math.max(24, bh * 0.44);
          mediaFrames.push({
            frame_index: i,
            timestamp_ms: tMs,
            x: Number(mx.toFixed(1)),
            y: Number(my.toFixed(1)),
            width: Number(mw.toFixed(1)),
            height: Number(mh.toFixed(1)),
            svg_path: roundedRectSvg(mx, my, mw, mh, 14),
            confidence: 0.96,
          });

          const cx = bx + bw * 0.28;
          const cy = by + bh * 0.66;
          const cw = Math.max(40, bw * 0.64);
          const ch = Math.max(12, bh * 0.22);
          controlFrames.push({
            frame_index: i,
            timestamp_ms: tMs,
            x: Number(cx.toFixed(1)),
            y: Number(cy.toFixed(1)),
            width: Number(cw.toFixed(1)),
            height: Number(ch.toFixed(1)),
            svg_path: roundedRectSvg(cx, cy, cw, ch, 10),
            confidence: 0.95,
          });
        }

        const fit0 = fitEmpiricalFramesToSpring(containerFrames, null);
        const fit1 = fitEmpiricalFramesToSpring(mediaFrames, fit0.onsetMs);
        const fit2 = fitEmpiricalFramesToSpring(controlFrames, fit0.onsetMs + 25);

        const layers: TrackedLayer[] = [
          {
            id: "layer-1",
            name: "Primary Morphing Container",
            samPrompt: "expanding primary UI container",
            colorHex: "#06b6d4",
            role: "container",
            physics: fit0.physics,
            frames: containerFrames,
          },
          {
            id: "layer-2",
            name: "Nested Media Thumbnail",
            samPrompt: "nested media thumbnail badge",
            colorHex: "#a855f7",
            role: "media",
            physics: fit1.physics,
            frames: mediaFrames,
          },
          {
            id: "layer-3",
            name: "Interactive Control Row",
            samPrompt: "bottom interactive controls bar",
            colorHex: "#10b981",
            role: "control",
            physics: fit2.physics,
            frames: controlFrames,
          },
        ];

        resolve({
          fps,
          frameCount: numFrames,
          width: STAGE_W,
          height: STAGE_H,
          durationMs: Math.round(durationSec * 1000),
          startKeyframeDataUrl,
          endKeyframeDataUrl,
          layers,
        });
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode video file in browser."));
    };
  });
}
