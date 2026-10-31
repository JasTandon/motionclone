import { AnalysisPayload, FrameBox, SpringPhysics, TrackedLayer, VerificationResult } from "@/types/motion";
import { fitSpring } from "./springFit";

export function springStepScalar(tau: number, omega0: number, zeta: number): number {
  const t = Math.max(0, tau);
  const w0 = Math.max(0.5, omega0);
  const z = Math.max(0.05, zeta);

  if (z < 0.999) {
    const sqrtTerm = Math.sqrt(1 - z * z);
    const wd = w0 * sqrtTerm;
    const envelope = Math.exp(-z * w0 * t);
    const harmonic = Math.cos(wd * t) + (z / sqrtTerm) * Math.sin(wd * t);
    return 1 - envelope * harmonic;
  } else if (z <= 1.001) {
    return 1 - (1 + w0 * t) * Math.exp(-w0 * t);
  } else {
    const sqrtTerm = Math.sqrt(z * z - 1);
    const r1 = w0 * (z - sqrtTerm);
    const r2 = w0 * (z + sqrtTerm);
    return 1 - (r2 * Math.exp(-r1 * t) - r1 * Math.exp(-r2 * t)) / (r2 - r1);
  }
}

function roundedRectSvgPath(x: number, y: number, w: number, h: number, r = 18): string {
  const rad = Math.min(r, w / 2, h / 2);
  return `M ${(x + rad).toFixed(1)} ${y.toFixed(1)} H ${(x + w - rad).toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${(x + w).toFixed(1)} ${(y + rad).toFixed(1)} V ${(y + h - rad).toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${(x + w - rad).toFixed(1)} ${(y + h).toFixed(1)} H ${(x + rad).toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${x.toFixed(1)} ${(y + h - rad).toFixed(1)} V ${(y + rad).toFixed(1)} A ${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${(x + rad).toFixed(1)} ${y.toFixed(1)} Z`;
}

export function buildPresetAnalysisLocal(presetId: string): AnalysisPayload {
  const catalog: Record<string, {
    id: string;
    title: string;
    summary: string;
    layers: {
      id: string;
      name: string;
      samPrompt: string;
      colorHex: string;
      role: string;
      startBox: { x: number; y: number; width: number; height: number };
      endBox: { x: number; y: number; width: number; height: number };
      omega0: number;
      zeta: number;
      staggerMs: number;
      radius: number;
    }[];
  }> = {
    "dynamic-island": {
      id: "dynamic-island",
      title: "Apple Dynamic Island — Fluid Music Player Morph",
      summary: "Underdamped spring expansion (zeta=0.58, 10.6% overshoot) with staggered album cover scale-up and waveform equalizer reveal.",
      layers: [
        {
          id: "layer-1",
          name: "Dynamic Island Pill Shell",
          samPrompt: "black pill container",
          colorHex: "#06b6d4",
          role: "container",
          startBox: { x: 210, y: 48, width: 220, height: 48 },
          endBox: { x: 110, y: 40, width: 420, height: 196 },
          omega0: 19.5,
          zeta: 0.58,
          staggerMs: 0,
          radius: 28,
        },
        {
          id: "layer-2",
          name: "Album Cover Artwork",
          samPrompt: "rounded square album artwork",
          colorHex: "#a855f7",
          role: "media",
          startBox: { x: 222, y: 58, width: 28, height: 28 },
          endBox: { x: 134, y: 62, width: 84, height: 84 },
          omega0: 21.0,
          zeta: 0.62,
          staggerMs: 33.3,
          radius: 16,
        },
        {
          id: "layer-3",
          name: "Audio Waveform Visualizer",
          samPrompt: "neon waveform visualizer badge",
          colorHex: "#10b981",
          role: "control",
          startBox: { x: 384, y: 60, width: 32, height: 24 },
          endBox: { x: 442, y: 76, width: 64, height: 44 },
          omega0: 23.0,
          zeta: 0.52,
          staggerMs: 50.0,
          radius: 10,
        },
        {
          id: "layer-4",
          name: "Scrubber & Transport Controls",
          samPrompt: "bottom playback controls bar",
          colorHex: "#f59e0b",
          role: "control",
          startBox: { x: 240, y: 82, width: 160, height: 10 },
          endBox: { x: 134, y: 166, width: 372, height: 48 },
          omega0: 17.8,
          zeta: 0.66,
          staggerMs: 83.3,
          radius: 12,
        },
      ],
    },
    "magnetic-wallet": {
      id: "magnetic-wallet",
      title: "Stripe Magnetic Card Drawer — 3D Spring Snap",
      summary: "High-stiffness magnetic drawer lift (k=462 N/m) with bouncy titanium card elevation and staggered CTA button entrance.",
      layers: [
        {
          id: "layer-1",
          name: "Glassmorphic Checkout Drawer",
          samPrompt: "floating dark checkout card container",
          colorHex: "#06b6d4",
          role: "container",
          startBox: { x: 160, y: 240, width: 320, height: 110 },
          endBox: { x: 130, y: 54, width: 380, height: 292 },
          omega0: 21.5,
          zeta: 0.60,
          staggerMs: 0,
          radius: 26,
        },
        {
          id: "layer-2",
          name: "Titanium Credit Card Surface",
          samPrompt: "gradient credit card rectangle",
          colorHex: "#ec4899",
          role: "media",
          startBox: { x: 180, y: 256, width: 280, height: 72 },
          endBox: { x: 154, y: 76, width: 332, height: 168 },
          omega0: 24.2,
          zeta: 0.51,
          staggerMs: 33.3,
          radius: 18,
        },
        {
          id: "layer-3",
          name: "Apple Pay / Passkey Confirm CTA",
          samPrompt: "glowing bottom confirm button",
          colorHex: "#10b981",
          role: "control",
          startBox: { x: 200, y: 325, width: 240, height: 20 },
          endBox: { x: 154, y: 268, width: 332, height: 54 },
          omega0: 18.4,
          zeta: 0.68,
          staggerMs: 83.3,
          radius: 14,
        },
      ],
    },
    "bento-morph": {
      id: "bento-morph",
      title: "Linear Fluid Bento Card — Shared Layout Telemetry Expand",
      summary: "Snappy low-drag layout expansion (k=510 N/m, zeta=0.71) with synchronized telemetry chart unroll.",
      layers: [
        {
          id: "layer-1",
          name: "Bento Telemetry Card Shell",
          samPrompt: "dark bento card panel",
          colorHex: "#3b82f6",
          role: "container",
          startBox: { x: 190, y: 135, width: 260, height: 130 },
          endBox: { x: 96, y: 46, width: 448, height: 308 },
          omega0: 22.6,
          zeta: 0.71,
          staggerMs: 0,
          radius: 24,
        },
        {
          id: "layer-2",
          name: "Live Sparkline Graph Canvas",
          samPrompt: "glowing telemetry chart area",
          colorHex: "#10b981",
          role: "media",
          startBox: { x: 210, y: 190, width: 220, height: 52 },
          endBox: { x: 124, y: 128, width: 392, height: 148 },
          omega0: 20.4,
          zeta: 0.64,
          staggerMs: 50.0,
          radius: 14,
        },
        {
          id: "layer-3",
          name: "Status Badge & Metric Pill",
          samPrompt: "top status pill badge",
          colorHex: "#f59e0b",
          role: "control",
          startBox: { x: 210, y: 152, width: 96, height: 26 },
          endBox: { x: 124, y: 72, width: 168, height: 36 },
          omega0: 25.0,
          zeta: 0.59,
          staggerMs: 16.7,
          radius: 99,
        },
      ],
    },
  };

  const spec = catalog[presetId] || catalog["dynamic-island"];
  const layersOut: TrackedLayer[] = spec.layers.map((raw) => {
    const frames: FrameBox[] = [];
    const telemetrySeries = [];
    const stiffness = Number((raw.omega0 * raw.omega0).toFixed(1));
    const damping = Number((2 * raw.zeta * Math.sqrt(stiffness)).toFixed(1));
    const overshootPct =
      raw.zeta < 1
        ? Number(
            (
              Math.exp((-Math.PI * raw.zeta) / Math.sqrt(1 - raw.zeta * raw.zeta)) *
              100
            ).toFixed(1)
          )
        : 0;
    const settlingMs = Math.round((4 / (raw.zeta * raw.omega0)) * 1000);

    for (let i = 0; i < 60; i++) {
      const tMs = (i / 60) * 1000;
      const tau = Math.max(0, (tMs - raw.staggerMs) / 1000);
      const uFit = springStepScalar(tau, raw.omega0, raw.zeta);
      const jitter = i > 1 && i < 56 ? Math.sin(i * 1.9) * 0.0035 : 0;
      const uEmp = uFit + jitter;

      const bx = raw.startBox.x + (raw.endBox.x - raw.startBox.x) * uEmp;
      const by = raw.startBox.y + (raw.endBox.y - raw.startBox.y) * uEmp;
      const bw = raw.startBox.width + (raw.endBox.width - raw.startBox.width) * uEmp;
      const bh = raw.startBox.height + (raw.endBox.height - raw.startBox.height) * uEmp;

      frames.push({
        frame_index: i,
        timestamp_ms: Number(tMs.toFixed(1)),
        x: Number(bx.toFixed(1)),
        y: Number(by.toFixed(1)),
        width: Number(bw.toFixed(1)),
        height: Number(bh.toFixed(1)),
        svg_path: roundedRectSvgPath(bx, by, bw, bh, raw.radius),
        confidence: 0.98,
      });

      const prevTau = Math.max(0, (tMs - 16.67 - raw.staggerMs) / 1000);
      const uPrev = springStepScalar(prevTau, raw.omega0, raw.zeta);
      const vel = ((uFit - uPrev) * (raw.endBox.width - raw.startBox.width)) * 60;

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

    // Real R² of the reference curve against its (synthetic, jittered) samples.
    const meanEmp = telemetrySeries.reduce((a, p) => a + p.empiricalNormalized, 0) / telemetrySeries.length;
    const ssTot = telemetrySeries.reduce((a, p) => a + (p.empiricalNormalized - meanEmp) ** 2, 0);
    const ssRes = telemetrySeries.reduce((a, p) => a + (p.empiricalNormalized - p.fittedSpringNormalized) ** 2, 0);

    const physics: SpringPhysics = {
      transition_type: "spring",
      stiffness,
      damping,
      mass: 1.0,
      damping_ratio: raw.zeta,
      natural_freq_rad: raw.omega0,
      overshoot_pct: overshootPct,
      settling_duration_ms: settlingMs,
      stagger_delay_ms: raw.staggerMs,
      cubic_bezier: [0.24, 0.0, 0.2, Number((1 + overshootPct / 200).toFixed(2))],
      r_squared: Number((1 - ssRes / Math.max(1e-9, ssTot)).toFixed(4)),
      dominant_axis: "width",
      start_state: raw.startBox,
      end_state: raw.endBox,
      telemetry_series: telemetrySeries,
    };

    return {
      id: raw.id,
      name: raw.name,
      samPrompt: raw.samPrompt,
      colorHex: raw.colorHex,
      role: raw.role,
      physics,
      frames,
    };
  });

  const l0 = layersOut[0].physics;
  const l1 = layersOut[1]?.physics || l0;
  const l2 = layersOut[2]?.physics || l1;

  const reactCode = `import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Compiled by MotionClone (Meta SAM 3.1 + Harmonic Spring Solver + Muse Spark 1.3)
export const SPRING_CONFIG = {
  container: { type: "spring" as const, stiffness: ${l0.stiffness}, damping: ${l0.damping}, mass: 1.0, delay: ${(l0.stagger_delay_ms / 1000).toFixed(3)} },
  media: { type: "spring" as const, stiffness: ${l1.stiffness}, damping: ${l1.damping}, mass: 1.0, delay: ${(l1.stagger_delay_ms / 1000).toFixed(3)} },
  controls: { type: "spring" as const, stiffness: ${l2.stiffness}, damping: ${l2.damping}, mass: 1.0, delay: ${(l2.stagger_delay_ms / 1000).toFixed(3)} },
};

export default function ClonedMotionComponent() {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      layout
      onClick={() => setExpanded(!expanded)}
      animate={{
        width: expanded ? ${l0.end_state.width} : ${l0.start_state.width},
        height: expanded ? ${l0.end_state.height} : ${l0.start_state.height},
        borderRadius: expanded ? 34 : 24,
      }}
      transition={SPRING_CONFIG.container}
      className="cursor-pointer bg-black border border-white/15 shadow-2xl p-4 flex flex-col justify-between overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3">
        <motion.div
          layout
          animate={{
            width: expanded ? ${l1.end_state.width} : ${l1.start_state.width},
            height: expanded ? ${l1.end_state.height} : ${l1.start_state.height},
          }}
          transition={SPRING_CONFIG.media}
          className="rounded-xl bg-gradient-to-br from-cyan-400 to-purple-600 shrink-0"
        />
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={SPRING_CONFIG.controls}
              className="flex-1 text-white text-sm font-semibold"
            >
              ${spec.title}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}`;

  const respSec = ((2 * Math.PI) / l0.natural_freq_rad).toFixed(3);
  const swiftuiCode = `import SwiftUI

// Compiled by MotionClone — SAM 3.1 Harmonic Fit
struct ClonedMotionView: View {
    @State private var isExpanded = false
    private let spring = Animation.spring(response: ${respSec}, dampingFraction: ${l0.damping_ratio})

    var body: some View {
        RoundedRectangle(cornerRadius: isExpanded ? 34 : 24, style: .continuous)
            .fill(.black)
            .frame(
                width: isExpanded ? ${l0.end_state.width} : ${l0.start_state.width},
                height: isExpanded ? ${l0.end_state.height} : ${l0.start_state.height}
            )
            .animation(spring, value: isExpanded)
            .onTapGesture { isExpanded.toggle() }
    }
}`;

  const cssCode = `/* Compiled by MotionClone (SAM 3.1 + Harmonic Spring Solver) */
:root {
  --mc-stiffness: ${l0.stiffness};
  --mc-damping: ${l0.damping};
  --mc-overshoot: ${l0.overshoot_pct}%;
  --mc-duration: ${l0.settling_duration_ms}ms;
  --mc-easing: cubic-bezier(${l0.cubic_bezier.join(", ")});
}

.cloned-container {
  width: ${l0.start_state.width}px;
  height: ${l0.start_state.height}px;
  transition: all var(--mc-duration) var(--mc-easing);
}

.cloned-container.expanded {
  width: ${l0.end_state.width}px;
  height: ${l0.end_state.height}px;
}`;

  return {
    presetId: spec.id,
    isExample: true,
    interactionTitle: spec.title,
    interactionSummary: `${spec.summary} (Built-in example with synthetic reference telemetry — upload a video for measured data.)`,
    videoMeta: { fps: 60, frameCount: 60, width: 640, height: 400, durationMs: 1000 },
    pipelineMetadata: {
      perceptionModel: "sam-3.1",
      reasoningModel: "muse-spark-1.3",
      physicsSolver: "Damped harmonic oscillator, Levenberg–Marquardt (in-browser)",
      framesAnalyzed: 60,
    },
    layers: layersOut,
    codeExports: { reactCode, swiftuiCode, cssCode },
  };
}

export function verifyTrajectoryLocal(
  layer: TrackedLayer,
  candStiffness: number,
  candDamping: number,
  candMass = 1.0
): VerificationResult {
  const genW0 = Math.sqrt(Math.max(1, candStiffness) / Math.max(0.1, candMass));
  const genZeta =
    candDamping /
    (2 * Math.sqrt(Math.max(0.1, candMass) * Math.max(1, candStiffness)));
  const onsetSec = layer.physics.stagger_delay_ms / 1000;

  let sqSum = 0;
  const comparisonSeries = layer.physics.telemetry_series.map((pt) => {
    const tau = Math.max(0, pt.timeMs / 1000 - onsetSec);
    const genVal = springStepScalar(tau, genW0, genZeta);
    const err = Math.abs(pt.empiricalNormalized - genVal);
    sqSum += err * err;
    return {
      timeMs: pt.timeMs,
      originalNormalized: pt.empiricalNormalized,
      generatedNormalized: Number(genVal.toFixed(4)),
      errorAbs: Number(err.toFixed(4)),
    };
  });

  const rmse = Math.sqrt(sqSum / Math.max(1, comparisonSeries.length));
  const fidelity = Number(
    Math.max(0, Math.min(99.9, (1 - rmse) * 100)).toFixed(1)
  );
  const passed = fidelity >= 95.0;

  // Self-heal: re-run the LM solver against the measured samples, seeded from the candidate.
  let recommendedPatch: VerificationResult["recommendedPatch"] = null;
  if (!passed) {
    const refit = fitSpring(
      layer.physics.telemetry_series.map((pt) => ({ tMs: pt.timeMs, u: pt.empiricalNormalized })),
      { omega0: genW0, zeta: genZeta, onsetMs: layer.physics.stagger_delay_ms }
    );
    const useRefit = refit.samples >= 3 && refit.rmse < rmse;
    const k = useRefit ? refit.stiffness : layer.physics.stiffness;
    const c = useRefit ? refit.damping : layer.physics.damping;
    recommendedPatch = {
      stiffness: Number((k * candMass).toFixed(1)),
      damping: Number((c * candMass).toFixed(2)),
      mass: candMass,
      reason: `Candidate spring (k=${candStiffness}, c=${candDamping}, m=${candMass}) deviates from the measured track by RMSE=${rmse.toFixed(3)}. Levenberg–Marquardt refit (${refit.iterations} iterations, ${refit.samples} samples) recovers k=${(k * candMass).toFixed(1)}, c=${(c * candMass).toFixed(2)}${useRefit ? ` with RMSE=${refit.rmse.toFixed(3)}` : ""}.`,
    };
  }

  return {
    fidelityScorePct: fidelity,
    rmse: Number(rmse.toFixed(4)),
    passedThreshold: passed,
    layerName: layer.name,
    samPrompt: layer.samPrompt,
    originalParams: {
      stiffness: layer.physics.stiffness,
      damping: layer.physics.damping,
      mass: layer.physics.mass,
      overshootPct: layer.physics.overshoot_pct,
    },
    generatedParams: {
      stiffness: candStiffness,
      damping: candDamping,
      mass: candMass,
    },
    recommendedPatch,
    comparisonSeries,
  };
}
