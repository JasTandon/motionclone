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

export interface TrackedLayer {
  id: string;
  name: string;
  samPrompt: string;
  colorHex: string;
  role: string;
  physics: SpringPhysics;
  frames: FrameBox[];
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
