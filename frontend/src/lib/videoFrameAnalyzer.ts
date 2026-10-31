import { BoxRect, TrackSample, TrackedLayer } from "@/types/motion";
import { buildMeasuredLayer, GlobalMotionFit, STAGE_H, STAGE_W } from "./trackFusion";
import { fitSpring, normalizeTransition } from "./springFit";

export interface ExtractedVideoData {
  fps: number;
  frameCount: number;
  width: number;
  height: number;
  durationMs: number;
  keyframesDataUrls: string[];
  keyframeTimesMs: number[];
  /** Pixel-diff motion envelope (bbox of changed pixels vs. frame 0) at each sampled frame. */
  motionTrack: TrackSample[];
  globalFit: GlobalMotionFit | null;
  layers: TrackedLayer[];
}

const NUM_SAMPLES = 30;
const NUM_KEYFRAMES = 10;
const GRID_W = 96;
const GRID_H = 60;
const DECODE_TIMEOUT_MS = 12000;

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function waitFor(video: HTMLVideoElement, event: string, ms: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener(event, done);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(done, ms);
    video.addEventListener(event, done);
  });
}

/**
 * MediaRecorder WebM files (Record Screen / sample video) report duration = Infinity until
 * the decoder has scanned to the end. Seeking far past the end forces the real duration.
 */
async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  video.currentTime = 1e7;
  await waitFor(video, "durationchange", 2500);
  await waitFor(video, "seeked", 1500);
  const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : video.currentTime;
  video.currentTime = 0;
  await waitFor(video, "seeked", 1500);
  return d > 0 && Number.isFinite(d) ? d : 2;
}

function describeDecodeError(file: File, video: HTMLVideoElement) {
  const code = video.error?.code;
  const isMov = /\.mov$/i.test(file.name) || file.type === "video/quicktime";
  const hint = isMov
    ? " This .mov is probably HEVC/ProRes, which this browser cannot decode — open it in Safari, or re-export as H.264 MP4 (QuickTime → File → Export As → 1080p, or `ffmpeg -i in.mov -c:v libx264 -pix_fmt yuv420p out.mp4`)."
    : " Try re-exporting as H.264 MP4.";
  return `Could not decode "${file.name}"${code ? ` (MediaError ${code})` : ""}.${hint}`;
}

/** Bbox of pixels that differ from the reference frame, in 640x400 stage space. */
function changedRegion(ref: Uint8ClampedArray, cur: Uint8ClampedArray): { box: BoxRect | null; energy: number } {
  let minX = GRID_W;
  let minY = GRID_H;
  let maxX = -1;
  let maxY = -1;
  let energy = 0;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = (y * GRID_W + x) * 4;
      const d =
        (Math.abs(cur[i] - ref[i]) + Math.abs(cur[i + 1] - ref[i + 1]) + Math.abs(cur[i + 2] - ref[i + 2])) / 3;
      energy += d;
      if (d > 28) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const sx = STAGE_W / GRID_W;
  const sy = STAGE_H / GRID_H;
  const box =
    maxX >= minX && (maxX - minX + 1) * (maxY - minY + 1) >= 4
      ? { x: minX * sx, y: minY * sy, width: (maxX - minX + 1) * sx, height: (maxY - minY + 1) * sy }
      : null;
  return { box, energy: energy / (GRID_W * GRID_H) };
}

/**
 * Decodes an uploaded video in the browser, samples 30 uniformly spaced frames, keeps 10 as
 * JPEG keyframes for Muse Spark 1.3 / SAM 3.1, and measures a pixel-diff motion envelope
 * whose energy curve gives a model-free spring fit for the clip's global timing.
 */
export async function analyzeVideoFileFramesClient(
  file: File,
  onProgress?: (msg: string) => void
): Promise<ExtractedVideoData> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  // Kept in the DOM (offscreen) so hardware decoders deliver frames reliably.
  Object.assign(video.style, {
    position: "fixed",
    left: "-9999px",
    top: "-9999px",
    width: "320px",
    height: "200px",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(video);

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error(describeDecodeError(file, video)));
        video.src = url;
      }),
      DECODE_TIMEOUT_MS,
      `Timed out decoding "${file.name}". ${/\.mov$/i.test(file.name) ? "HEVC/ProRes .mov files need Safari or an H.264 re-export." : "Try an H.264 MP4."}`
    );
    if (!video.videoWidth || !video.videoHeight) throw new Error(`"${file.name}" has no video track.`);

    try {
      await video.play();
      video.pause();
    } catch {
      // Autoplay may be blocked; seeking still works.
    }

    const durationSec = Math.min(20, Math.max(0.3, await resolveDuration(video)));
    const durationMs = Math.round(durationSec * 1000);

    const canvas = document.createElement("canvas");
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;
    const ctx = canvas.getContext("2d");
    const grid = document.createElement("canvas");
    grid.width = GRID_W;
    grid.height = GRID_H;
    const gctx = grid.getContext("2d", { willReadFrequently: true });
    if (!ctx || !gctx) throw new Error("Canvas 2D context unavailable");

    const seekTo = async (timeSec: number) => {
      const target = Math.min(Math.max(0, durationSec - 0.03), Math.max(0, timeSec));
      if (Math.abs(video.currentTime - target) < 1e-3) return;
      const seeked = waitFor(video, "seeked", 1500);
      video.currentTime = target;
      await seeked;
      // Let the decoded frame reach the compositor; rAF is paused in background tabs, so race it.
      await new Promise((r) => {
        requestAnimationFrame(() => r(null));
        setTimeout(r, 60);
      });
    };

    const keyIdx = new Set(
      Array.from({ length: NUM_KEYFRAMES }, (_, i) => Math.round((i * (NUM_SAMPLES - 1)) / (NUM_KEYFRAMES - 1)))
    );
    const keyframesDataUrls: string[] = [];
    const keyframeTimesMs: number[] = [];
    const motionTrack: TrackSample[] = [];
    const energy: { tMs: number; u: number }[] = [];
    let ref: Uint8ClampedArray | null = null;

    for (let i = 0; i < NUM_SAMPLES; i++) {
      const tSec = (i / (NUM_SAMPLES - 1)) * durationSec;
      await seekTo(tSec);
      ctx.drawImage(video, 0, 0, STAGE_W, STAGE_H);
      gctx.drawImage(canvas, 0, 0, GRID_W, GRID_H);
      const px = gctx.getImageData(0, 0, GRID_W, GRID_H).data;
      if (!ref) ref = new Uint8ClampedArray(px);
      const { box, energy: e } = changedRegion(ref, px);
      const tMs = Math.round(tSec * 1000);
      motionTrack.push({ tMs, box, source: "pixel" });
      energy.push({ tMs, u: e });
      if (keyIdx.has(i)) {
        keyframesDataUrls.push(canvas.toDataURL("image/jpeg", 0.82));
        keyframeTimesMs.push(tMs);
      }
      if (i % 6 === 5) onProgress?.(`Decoded ${i + 1}/${NUM_SAMPLES} frames…`);
    }

    // Model-free timing: normalized pixel-energy curve → spring fit.
    const normalized = normalizeTransition(energy);
    const globalFit = normalized.length >= 4 ? { fit: fitSpring(normalized), samples: normalized } : null;

    // The envelope starts at the first moving frame; frame 0 itself has no diff.
    const firstMoving = motionTrack.findIndex((s) => s.box);
    const envelopeTrack =
      firstMoving > 0 ? [{ ...motionTrack[firstMoving], tMs: 0 }, ...motionTrack.slice(1)] : motionTrack;
    const layers = envelopeTrack.some((s) => s.box)
      ? [
          buildMeasuredLayer(
            {
              id: "layer-1",
              name: "Motion Envelope (pixel diff)",
              samPrompt: "moving UI region",
              colorHex: "#06b6d4",
              role: "container",
              cornerRadius: 10,
              track: envelopeTrack,
            },
            durationMs,
            globalFit
          ),
        ]
      : [];

    return {
      fps: Number((NUM_SAMPLES / durationSec).toFixed(1)),
      frameCount: NUM_SAMPLES,
      width: STAGE_W,
      height: STAGE_H,
      durationMs,
      keyframesDataUrls,
      keyframeTimesMs,
      motionTrack,
      globalFit,
      layers,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}
