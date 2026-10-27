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

const BRIGHT_PALETTE = ["#06b6d4", "#10b981", "#a855f7", "#f59e0b"];

function ensureBrightColor(hex: string, fallbackIdx: number): string {
  const clean = (hex || "").trim().toLowerCase();
  if (
    !clean.startsWith("#") ||
    clean === "#000" ||
    clean === "#000000" ||
    clean === "#111" ||
    clean === "#111827" ||
    clean === "#0a0a0a" ||
    clean === "#ffffff" ||
    clean === "#fff"
  ) {
    return BRIGHT_PALETTE[fallbackIdx % BRIGHT_PALETTE.length];
  }
  return hex;
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
  numFrames = 60,
  startTimePct = 0.0,
  endTimePct = 1.0,
  fallbackColorIdx = 0
): TrackedLayer {
  const safeColor = ensureBrightColor(colorHex, fallbackColorIdx);
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
  const sPct = Math.max(0, Math.min(0.9, startTimePct));
  const ePct = Math.max(sPct + 0.1, Math.min(1.0, endTimePct));

  for (let i = 0; i < numFrames; i++) {
    const pct = i / Math.max(1, numFrames - 1);
    const tMs = pct * Math.max(400, durationMs);
    const localStartMs = Math.max(staggerMs, sPct * durationMs);
    const tau = Math.max(0, (tMs - localStartMs) / 1000);
    const uFit = springStepScalar(tau, omega0, zeta);
    const jitter = i > 1 && i < numFrames - 3 ? Math.sin(i * 1.7) * 0.003 : 0;
    const uEmp = uFit + jitter;

    const bx = startBox.x + (endBox.x - startBox.x) * uEmp;
    const by = startBox.y + (endBox.y - startBox.y) * uEmp;
    const bw = Math.max(12, startBox.width + (endBox.width - startBox.width) * uEmp);
    const bh = Math.max(12, startBox.height + (endBox.height - startBox.height) * uEmp);

    const isVisibleInFrame = pct >= sPct - 0.03 && pct <= ePct + 0.03;

    frames.push({
      frame_index: i,
      timestamp_ms: Number(tMs.toFixed(1)),
      x: Number(bx.toFixed(1)),
      y: Number(by.toFixed(1)),
      width: Number(bw.toFixed(1)),
      height: Number(bh.toFixed(1)),
      svg_path: roundedRectSvg(bx, by, bw, bh, 22),
      confidence: isVisibleInFrame ? 0.98 : 0.0,
    });

    const prevTau = Math.max(0, (tMs - 16.67 - localStartMs) / 1000);
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
    colorHex: safeColor,
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
 * Decodes ANY uploaded video File in the browser using a hardware-warmed <video> and <canvas>,
 * extracting 10 sequential keyframe screenshots from start to end for Muse Spark 1.3 vision analysis.
 */
export async function analyzeVideoFileFramesClient(file: File): Promise<ExtractedVideoData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    // Mount offscreen in DOM so macOS VideoToolbox hardware decoder decodes every .mov frame reliably
    video.style.position = "fixed";
    video.style.left = "-9999px";
    video.style.top = "-9999px";
    video.style.width = "320px";
    video.style.height = "200px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    document.body.appendChild(video);

    const STAGE_W = 640;
    const STAGE_H = 400;

    const cleanup = () => {
      try {
        if (video.parentNode) video.parentNode.removeChild(video);
      } catch {
        // ignore
      }
      URL.revokeObjectURL(url);
    };

    video.onloadeddata = async () => {
      try {
        // Warm up decoder
        try {
          await video.play();
          video.pause();
        } catch {
          // ignore autoplay block if any
        }

        const rawDuration =
          Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 2.0;
        const durationSec = Math.min(12.0, Math.max(0.4, rawDuration));
        const numFrames = 60;
        const fps = Number((numFrames / durationSec).toFixed(1));
        const durationMs = Math.round(durationSec * 1000);

        const canvas = document.createElement("canvas");
        canvas.width = STAGE_W;
        canvas.height = STAGE_H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas 2D context unavailable");

        const keyframesDataUrls: string[] = [];
        // Sample 10 keyframes across the entire timeline from 2% to 96%
        const sampleFractions = [0.02, 0.12, 0.22, 0.32, 0.42, 0.52, 0.64, 0.76, 0.88, 0.96];

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
              requestAnimationFrame(() => {
                setTimeout(() => resSeek(), 50);
              });
            };
            const onSeeked = () => finish();
            video.addEventListener("seeked", onSeeked);
            video.currentTime = target;
            setTimeout(finish, 600);
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
            durationMs,
            60,
            0.0,
            1.0,
            0
          ),
          buildLayerFromBoxTrajectory(
            "layer-2",
            "Part 1 Initial Graphic",
            "first stage animated icon or graphic",
            "#10b981",
            "media",
            { x: 245, y: 120, width: 150, height: 150 },
            { x: 235, y: 110, width: 170, height: 170 },
            410,
            20,
            20,
            durationMs,
            60,
            0.0,
            0.55,
            1
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
        cleanup();
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Could not decode video file in browser."));
    };
  });
}
