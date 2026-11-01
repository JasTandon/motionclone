export interface FrameBox {
  frame_index: number;
  timestamp_ms: number;
  x: number;
  y: number;
  width: number;
  height: number;
  svg_path: string;
  confidence: number;
}

export interface TelemetryPoint {
  frame: number;
  timeMs: number;
  empiricalNormalized: number;
  fittedSpringNormalized: number;
  x: number;
  y: number;
  width: number;
  height: number;
  velocityPxPerSec: number;
}

export interface SpringPhysics {
  transition_type: string;
  stiffness: number;
  damping: number;
  mass: number;
  damping_ratio: number;
  natural_freq_rad: number;
  overshoot_pct: number;
  settling_duration_ms: number;
  stagger_delay_ms: number;
  cubic_bezier: [number, number, number, number];
  r_squared: number;
  dominant_axis: string;
  start_state: { x: number; y: number; width: number; height: number };
  end_state: { x: number; y: number; width: number; height: number };
  telemetry_series: TelemetryPoint[];
}

export interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One measured observation of a layer at a sampled keyframe. */
export interface TrackSample {
  tMs: number;
  box: BoxRect | null;
  source: "sam" | "muse" | "pixel";
  /** SAM 3.1 mask outline (SVG path in 640x400 stage space), when returned. */
  maskPath?: string;
}

export interface TrackedLayer {
  id: string;
  name: string;
  samPrompt: string;
  colorHex: string;
  role: string;
  physics: SpringPhysics;
  frames: FrameBox[];
  track?: TrackSample[];
  /** Human-readable provenance of the spring fit, e.g. "SAM 3.1 ×7 + Muse ×3". */
  fitSource?: string;
}

export interface AnalysisPayload {
  presetId: string;
  interactionTitle: string;
  interactionSummary: string;
  videoMeta: {
    fps: number;
    frameCount: number;
    width: number;
    height: number;
    durationMs: number;
  };
  usedLiveMetaApi?: boolean;
  /** True for built-in examples whose telemetry is synthetic reference data. */
  isExample?: boolean;
  sceneBackgroundHex?: string;
  /** Mean IoU between SAM 3.1 boxes and Muse Spark 1.3 boxes on the same keyframes. */
  crossModelAgreement?: { meanIoU: number; pairs: number } | null;
  selfHeal?: { issuesFound: string[]; repaired: boolean } | null;
  /** Headless render of the clone vs. source keyframes (content region: 0.4·SSIM + 0.6·colour-match fraction). */
  visualMatch?: {
    score: number;
    target: number;
    rounds: number;
    history: number[];
    frames: { tMs: number; score: number }[];
  } | null;
  pipelineLogs?: string[];
  pipelineMetadata: {
    perceptionModel: string;
    reasoningModel: string;
    physicsSolver: string;
    framesAnalyzed: number;
  };
  layers: TrackedLayer[];
  livePreviewHtml?: string;
  codeExports: {
    reactCode: string;
    swiftuiCode: string;
    cssCode: string;
  };
}

export interface VerificationResult {
  fidelityScorePct: number;
  rmse: number;
  passedThreshold: boolean;
  layerName: string;
  samPrompt: string;
  originalParams: {
    stiffness: number;
    damping: number;
    mass: number;
    overshootPct: number;
  };
  generatedParams: {
    stiffness: number;
    damping: number;
    mass: number;
  };
  recommendedPatch?: {
    stiffness: number;
    damping: number;
    mass: number;
    reason: string;
  } | null;
  comparisonSeries: {
    timeMs: number;
    originalNormalized: number;
    generatedNormalized: number;
    errorAbs: number;
  }[];
}

export type StageId =
  | "muse-detect"
  | "sam-track"
  | "spring-fit"
  | "muse-synth"
  | "self-heal"
  | "visual-verify"
  | "visual-refine";

export type PipelineEvent = { type: "stage"; stage: StageId; status: "start" | "done" | "warn"; message: string };
