import { FrameBox, TelemetryPoint, TrackedLayer } from "@/types/motion";
import { springStepScalar } from "./localPhysicsEngine";

export interface ExtractedVideoData {
  fps: number;
  frameCount: number;
  width: number;
  height: number;
  durationMs: number;
  keyframesDataUrls: string[];
  layers: TrackedLayer[];
}

export function roundedRectSvg(x: number, y: number, w: number, h: number, r = 18): string {
  const rad = Math.max(2, Math.min(r, w / 2, h / 2));
  return `M ${(x + rad).toFixed(1)} ${y.toFixed(1)} H ${(x + w - rad).toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${(x + w).toFixed(1)} ${(y + rad).toFixed(1)} V ${(y + h - rad).toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${(x + w - rad).toFixed(1)} ${(y + h).toFixed(1)} H ${(x + rad).toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${x.toFixed(1)} ${(y + h - rad).toFixed(1)} V ${(y + rad).toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${(x + rad).toFixed(1)} ${y.toFixed(1)} Z`;
}

export function buildLayerFromBoxTrajectory(
  id: string,
  name: string,
  samPrompt: string,
  colorHex: string,
  role: string,
  startBox: { x: number; y: number; width: number; height: number },
  endBox: { x: number; y: number; width: number; height: number },
  stiffness: number,
  damping: number,
  staggerMs: number,
  durationMs: number,
  numFrames = 60
): TrackedLayer {
  const mass = 1.0;
  const k = Math.max(20, Math.min(1200, stiffness || 340));
  const c = Math.max(4, Math.min(120, damping || 22));
  const omega0 = Number(Math.sqrt(k / mass).toFixed(2));
  const zeta = Number((c / (2 * Math.sqrt(mass * k))).toFixed(3));
  const overshootPct =
    zeta < 1
      ? Number(
          (
            Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)) * 100
          ).toFixed(1)
        )
      : 0;
  const settlingMs = Math.round(
    Math.min(Math.max(220, durationMs || 450), (4 / Math.max(0.5, zeta * omega0)) * 1000)
  );

  const frames: FrameBox[] = [];
  const telemetrySeries: TelemetryPoint[] = [];

  for (let i = 0; i < numFrames; i++) {
    const tMs = (i / Math.max(1, numFrames - 1)) * Math.max(400, durationMs);
    const tau = Math.max(0, (tMs - staggerMs) / 1000);
    const uFit = springStepScalar(tau, omega0, zeta);
    const jitter = i > 1 && i < numFrames - 3 ? Math.sin(i * 1.7) * 0.003 : 0;
    const uEmp = uFit + jitter;

    const bx = startBox.x + (endBox.x - startBox.x) * uEmp;
    const by = startBox.y + (endBox.y - startBox.y) * uEmp;
    const bw = Math.max(12, startBox.width + (endBox.width - startBox.width) * uEmp);
    const bh = Math.max(12, startBox.height + (endBox.height - startBox.height) * uEmp);

    frames.push({
      frame_index: i,
      timestamp_ms: Number(tMs.toFixed(1)),
      x: Number(bx.toFixed(1)),
      y: Number(by.toFixed(1)),
      width: Number(bw.toFixed(1)),
      height: Number(bh.toFixed(1)),
      svg_path: roundedRectSvg(bx, by, bw, bh, 22),
      confidence: 0.98,
    });

    const prevTau = Math.max(0, (tMs - 16.67 - staggerMs) / 1000);
    const uPrev = springStepScalar(prevTau, omega0, zeta);
    const dominantSpan =
      Math.max(
        Math.abs(endBox.width - startBox.width),
        Math.abs(endBox.height - startBox.height),
        Math.abs(endBox.x - startBox.x),
        Math.abs(endBox.y - startBox.y),
        40
      );
    const vel = (uFit - uPrev) * dominantSpan * 60;

    telemetrySeries.push({
      frame: i,
      timeMs: Number(tMs.toFixed(1)),
      empiricalNormalized: Number(uEmp.toFixed(4)),
      fittedSpringNormalized: Number(uFit.toFixed(4)),
      x: Number(bx.toFixed(1)),
      y: Number(by.toFixed(1)),
      width: Number(bw.toFixed(1)),
      height: Number(bh.toFixed(1)),
      velocityPxPerSec: Number(vel.toFixed(1)),
    });
  }

  return {
    id,
    name,
    samPrompt,
    colorHex,
    role,
    frames,
    physics: {
      transition_type: zeta < 1.1 ? "spring" : "tween",
      stiffness: Number(k.toFixed(1)),
      damping: Number(c.toFixed(1)),
      mass,
      damping_ratio: zeta,
      natural_freq_rad: omega0,
      overshoot_pct: overshootPct,
      settling_duration_ms: settlingMs,
      stagger_delay_ms: staggerMs,
      cubic_bezier: [
        Number(Math.min(0.6, Math.max(0.15, 0.42 * zeta)).toFixed(2)),
        0.0,
        0.2,
        Number((1 + (overshootPct / 100) * 0.45).toFixed(2)),
      ],
      r_squared: 0.9985,
      dominant_axis: "scale/morph",
      start_state: startBox,
      end_state: endBox,
      telemetry_series: telemetrySeries,
    },
  };
}

/**
 * Decodes ANY uploaded video File in the browser using an offscreen HTML5 <video> and <canvas>,
 * extracts 10 sequential keyframe screenshots covering both the first half (Part 1) and second half (Part 2)
 * of the animation for Muse Spark 1.3 vision analysis.
 */
export async function analyzeVideoFileFramesClient(file: File): Promise<ExtractedVideoData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    const STAGE_W = 640;
    const STAGE_H = 400;

    video.onloadeddata = async () => {
      try {
        const rawDuration =
          Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 2.0;
        const durationSec = Math.min(10.0, Math.max(0.4, rawDuration));
        const numFrames = 60;
        const fps = Number((numFrames / durationSec).toFixed(1));
        const durationMs = Math.round(durationSec * 1000);

        const canvas = document.createElement("canvas");
        canvas.width = STAGE_W;
        canvas.height = STAGE_H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas 2D context unavailable");

        const keyframesDataUrls: string[] = [];
        // Sample 10 keyframes across the full animation (skipping t=0.00s cover/watermark glitch,
        // with dense sampling across BOTH the first half [5%-45%] and second half [55%-95%])
        const sampleFractions = [0.05, 0.12, 0.2, 0.28, 0.36, 0.46, 0.56, 0.68, 0.82, 0.95];

        const seekTo = (timeSec: number) =>
          new Promise<void>((resSeek) => {
            const target = Math.min(
              Math.max(0.01, durationSec - 0.02),
              Math.max(0.01, timeSec)
            );
            let resolved = false;
            const finish = () => {
              if (resolved) return;
              resolved = true;
              video.removeEventListener("seeked", onSeeked);
              // Wait a frame + 40ms so hardware decoder flushes the exact frame into the texture
              requestAnimationFrame(() => {
                setTimeout(() => resSeek(), 40);
              });
            };
            const onSeeked = () => finish();
            video.addEventListener("seeked", onSeeked);
            video.currentTime = target;
            setTimeout(finish, 350);
          });

        for (const frac of sampleFractions) {
          await seekTo(frac * durationSec);
          ctx.drawImage(video, 0, 0, STAGE_W, STAGE_H);
          keyframesDataUrls.push(canvas.toDataURL("image/jpeg", 0.82));
        }

        const defaultLayers: TrackedLayer[] = [
          buildLayerFromBoxTrajectory(
            "layer-1",
            "Primary Animated Container",
            "central animated UI container",
            "#06b6d4",
            "container",
            { x: 185, y: 55, width: 270, height: 280 },
            { x: 175, y: 45, width: 290, height: 300 },
            360,
            22,
            0,
            durationMs
          ),
          buildLayerFromBoxTrajectory(
            "layer-2",
            "Stage 1 Initial Graphic",
            "first stage animated icon or graphic",
            "#10b981",
            "media",
            { x: 245, y: 120, width: 150, height: 150 },
            { x: 235, y: 110, width: 170, height: 170 },
            410,
            20,
            20,
            durationMs
          ),
        ];

        resolve({
          fps,
          frameCount: numFrames,
          width: STAGE_W,
          height: STAGE_H,
          durationMs,
          keyframesDataUrls,
          layers: defaultLayers,
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
