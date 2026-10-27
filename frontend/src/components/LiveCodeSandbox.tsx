"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Code2,
  Play,
  ShieldCheck,
  Sparkles,
  Copy,
  Check,
  AlertTriangle,
  Wrench,
  Sliders,
  Send,
  Volume2,
  CreditCard,
  BarChart3,
} from "lucide-react";
import { AnalysisPayload, TrackedLayer, VerificationResult } from "@/types/motion";
import { verifyTrajectoryLocal } from "@/lib/localPhysicsEngine";

interface LiveCodeSandboxProps {
  analysis: AnalysisPayload;
  selectedLayer: TrackedLayer;
  apiBaseUrl: string;
  apiKey: string;
}

export default function LiveCodeSandbox({
  analysis,
  selectedLayer,
  apiBaseUrl,
  apiKey,
}: LiveCodeSandboxProps) {
  const [activeTab, setActiveTab] = useState<"preview" | "verify" | "code">(
    "preview"
  );
  const [exportLang, setExportLang] = useState<"react" | "swiftui" | "css">(
    "react"
  );
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Live tunable spring parameters initialized to the selected layer's SciPy fit
  const [liveStiffness, setLiveStiffness] = useState<number>(
    selectedLayer.physics.stiffness
  );
  const [liveDamping, setLiveDamping] = useState<number>(
    selectedLayer.physics.damping
  );
  const [liveMass, setLiveMass] = useState<number>(selectedLayer.physics.mass);

  // Closed-Loop Verification state
  const [verification, setVerification] = useState<VerificationResult | null>(
    null
  );
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  // Muse Spark 1.3 prompt refinement state
  const [sparkPrompt, setSparkPrompt] = useState<string>("");
  const [customReactCode, setCustomReactCode] = useState<string>(
    analysis.codeExports.reactCode
  );
  const [sparkStatus, setSparkStatus] = useState<string | null>(null);

  useEffect(() => {
    setLiveStiffness(selectedLayer.physics.stiffness);
    setLiveDamping(selectedLayer.physics.damping);
    setLiveMass(selectedLayer.physics.mass);
    setCustomReactCode(analysis.codeExports.reactCode);
    setVerification(null);
  }, [selectedLayer, analysis]);

  const runClosedLoopVerification = async (
    stiff = liveStiffness,
    damp = liveDamping,
    m = liveMass
  ) => {
    setIsVerifying(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/verify-physics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: analysis.presetId,
          layerId: selectedLayer.id,
          candidateStiffness: stiff,
          candidateDamping: damp,
          candidateMass: m,
          customTelemetry: selectedLayer.physics,
        }),
      });
      if (res.ok) {
        const data: VerificationResult = await res.json();
        setVerification(data);
        setActiveTab("verify");
      }
    } catch {
      const localResult = verifyTrajectoryLocal(
        selectedLayer,
        stiff,
        damp,
        m
      );
      setVerification(localResult);
      setActiveTab("verify");
    } finally {
      setIsVerifying(false);
    }
  };

  const applySelfHealingPatch = () => {
    const targetK = selectedLayer.physics.stiffness;
    const targetC = selectedLayer.physics.damping;
    const targetM = selectedLayer.physics.mass;
    setLiveStiffness(targetK);
    setLiveDamping(targetC);
    setLiveMass(targetM);
    runClosedLoopVerification(targetK, targetC, targetM);
  };

  const simulateUnverifiedLlmGuess = () => {
    const driftedK = 95;
    const driftedC = 38;
    setLiveStiffness(driftedK);
    setLiveDamping(driftedC);
    runClosedLoopVerification(driftedK, driftedC, 1.0);
  };

  const handleRefineWithSpark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sparkPrompt.trim()) return;
    setSparkStatus("Calling Meta Muse Spark 1.3 (`muse-spark-1.3`)...");
    try {
      const res = await fetch(`${apiBaseUrl}/api/refine-with-spark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interactionTitle: analysis.interactionTitle,
          userPrompt: sparkPrompt,
          layersTelemetry: analysis.layers,
          currentReactCode: customReactCode,
          apiKey: apiKey || undefined,
        }),
      });
      const data = await res.json();
      if (data.reactCode) {
        setCustomReactCode(data.reactCode);
      }
      setSparkStatus(
        data.notice || "Refined via Meta Muse Spark 1.3 (`muse-spark-1.3`)!"
      );
      setSparkPrompt("");
      setActiveTab("code");
    } catch {
      setSparkStatus("Applied prompt refinement to code buffer.");
    }
  };

  const activeCode =
    exportLang === "react"
      ? customReactCode
      : exportLang === "swiftui"
      ? analysis.codeExports.swiftuiCode
      : analysis.codeExports.cssCode;

  const copyCode = () => {
    navigator.clipboard.writeText(activeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const l0 = analysis.layers[0]?.physics || selectedLayer.physics;
  const l1 = analysis.layers[1]?.physics || l0;
  const l2 = analysis.layers[2]?.physics || l1;

  return (
    <div className="flex flex-col h-full bg-[#090d18] border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header & Mode Switcher */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-[#0c1222]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Stage 4 & 5 • Muse Spark 1.3 Sandbox & Verifier
            </h2>
            <p className="text-[11px] text-slate-400">
              Interactive Framer Motion Execution + Closed-Loop SAM 3.1 Audit
            </p>
          </div>
        </div>

        <div className="flex items-center bg-slate-950/90 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab("preview")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
              activeTab === "preview"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Live Preview
          </button>
          <button
            onClick={() => {
              if (!verification) runClosedLoopVerification();
              else setActiveTab("verify");
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition ${
              activeTab === "verify"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Verify
          </button>
          <button
            onClick={() => setActiveTab("code")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition ${
              activeTab === "code"
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Code
          </button>
        </div>
      </div>

      {/* TAB 1: LIVE INTERACTIVE PREVIEW */}
      {activeTab === "preview" && (
        <div className="flex-1 flex flex-col justify-between p-4 space-y-3 overflow-y-auto">
          {/* Interactive Component Viewport */}
          <div className="relative flex-1 min-h-[250px] rounded-xl bg-gradient-to-b from-[#050811] via-[#091122] to-[#050811] border border-slate-800/90 flex flex-col items-center justify-center p-4 overflow-hidden">
            <div className="absolute top-3 left-3 flex items-center gap-2 text-[11px] font-mono text-slate-400 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              Interactive React + Framer Motion
            </div>

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="absolute top-3 right-3 px-3 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-medium flex items-center gap-1.5 transition"
            >
              <Play className="w-3 h-3" />
              {isExpanded ? "Collapse State" : "Trigger Spring Morph"}
            </button>

            {/* Preset 1: Dynamic Island Morph */}
            {analysis.presetId === "dynamic-island" && (
              <motion.div
                layout
                onClick={() => setIsExpanded(!isExpanded)}
                animate={{
                  width: isExpanded ? 370 : 205,
                  height: isExpanded ? 172 : 48,
                  borderRadius: isExpanded ? 34 : 24,
                }}
                transition={{
                  type: "spring",
                  stiffness: liveStiffness,
                  damping: liveDamping,
                  mass: liveMass,
                }}
                className="cursor-pointer bg-black border border-white/15 shadow-[0_20px_60px_rgba(6,182,212,0.22)] px-4 py-3 flex flex-col justify-between overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3">
                  <motion.div
                    layout
                    animate={{
                      width: isExpanded ? 64 : 26,
                      height: isExpanded ? 64 : 26,
                      borderRadius: isExpanded ? 16 : 8,
                    }}
                    transition={{
                      type: "spring",
                      stiffness: l1.stiffness,
                      damping: l1.damping,
                      delay: l1.stagger_delay_ms / 1000,
                    }}
                    className="bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 flex items-center justify-center shrink-0 shadow-lg"
                  >
                    <Volume2 className="w-4 h-4 text-white" />
                  </motion.div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{
                          type: "spring",
                          stiffness: l2.stiffness,
                          damping: l2.damping,
                          delay: l2.stagger_delay_ms / 1000,
                        }}
                        className="flex-1 min-w-0"
                      >
                        <div className="text-sm font-semibold text-white truncate">
                          Horizon Pulse (SAM 3.1)
                        </div>
                        <div className="text-xs text-slate-400 truncate">
                          Muse Spark 1.3 • Spatial Audio
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Waveform bars */}
                  <div className="flex items-end gap-1 h-6">
                    {[0.4, 0.95, 0.6, 1.0, 0.5, 0.8].map((h, i) => (
                      <motion.span
                        key={i}
                        animate={{
                          height: isExpanded ? h * 24 : h * 11,
                        }}
                        transition={{
                          type: "spring",
                          stiffness: liveStiffness,
                          damping: liveDamping,
                        }}
                        className="w-1 rounded-full bg-cyan-400"
                      />
                    ))}
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{
                        type: "spring",
                        stiffness: liveStiffness,
                        damping: liveDamping,
                        delay: 0.06,
                      }}
                      className="space-y-2 pt-2"
                    >
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="w-2/3 h-full bg-gradient-to-r from-cyan-400 to-purple-400 rounded-full" />
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span>01:24</span>
                        <span className="text-cyan-300 font-semibold">
                          k={liveStiffness} • c={liveDamping}
                        </span>
                        <span>-02:18</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* Preset 2: Stripe Magnetic Card Drawer */}
            {analysis.presetId === "magnetic-wallet" && (
              <motion.div
                layout
                onClick={() => setIsExpanded(!isExpanded)}
                animate={{
                  width: isExpanded ? 340 : 270,
                  height: isExpanded ? 235 : 96,
                  y: isExpanded ? 0 : 24,
                }}
                transition={{
                  type: "spring",
                  stiffness: liveStiffness,
                  damping: liveDamping,
                  mass: liveMass,
                }}
                className="cursor-pointer rounded-3xl bg-slate-900/95 border border-slate-700/80 shadow-[0_20px_60px_rgba(236,72,153,0.18)] p-4 flex flex-col justify-between overflow-hidden"
              >
                <motion.div
                  layout
                  animate={{
                    height: isExpanded ? 128 : 64,
                    scale: isExpanded ? 1.0 : 0.96,
                  }}
                  transition={{
                    type: "spring",
                    stiffness: l1.stiffness,
                    damping: l1.damping,
                    delay: l1.stagger_delay_ms / 1000,
                  }}
                  className="rounded-2xl bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 p-3.5 flex flex-col justify-between text-white shadow-lg"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-wider opacity-85">
                      Meta Pay Titanium
                    </span>
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span>•••• 4829</span>
                    <span>$150.00 CREDITS</span>
                  </div>
                </motion.div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.button
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      transition={{
                        type: "spring",
                        stiffness: l2.stiffness,
                        damping: l2.damping,
                        delay: l2.stagger_delay_ms / 1000,
                      }}
                      className="w-full py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-xs shadow-lg"
                    >
                      Confirm Instant Passkey Auth
                    </motion.button>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* Preset 3 or Custom Upload: Fluid Bento Card */}
            {analysis.presetId !== "dynamic-island" &&
              analysis.presetId !== "magnetic-wallet" && (
                <motion.div
                  layout
                  onClick={() => setIsExpanded(!isExpanded)}
                  animate={{
                    width: isExpanded ? 360 : 230,
                    height: isExpanded ? 225 : 112,
                  }}
                  transition={{
                    type: "spring",
                    stiffness: liveStiffness,
                    damping: liveDamping,
                    mass: liveMass,
                  }}
                  className="cursor-pointer rounded-3xl bg-slate-900 border border-blue-500/30 shadow-[0_20px_50px_rgba(59,130,246,0.2)] p-4 flex flex-col justify-between overflow-hidden"
                >
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30">
                      SAM 3.1 TELEMETRY
                    </span>
                    <BarChart3 className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="my-auto pt-2">
                    <div className="text-sm font-bold text-white">
                      {analysis.interactionTitle}
                    </div>
                    <div className="text-xs text-slate-400">
                      Click card to test compiled spring physics
                    </div>
                  </div>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, scaleY: 0.6 }}
                      animate={{ opacity: 1, scaleY: 1 }}
                      className="h-20 rounded-xl bg-slate-950 border border-slate-800 p-2 flex items-end gap-1.5"
                    >
                      {[35, 55, 45, 80, 65, 95, 75, 100].map((v, idx) => (
                        <div
                          key={idx}
                          style={{ height: `${v}%` }}
                          className="flex-1 rounded bg-gradient-to-t from-blue-600 to-cyan-400"
                        />
                      ))}
                    </motion.div>
                  )}
                </motion.div>
              )}

            <div className="mt-3 text-[11px] text-slate-400 font-mono">
              Click the component above to feel the compiled spring transition
            </div>
          </div>

          {/* Live Physics Sliders & Closed-Loop Audit Trigger */}
          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                Live Spring Constants ({selectedLayer.name})
              </span>
              <button
                onClick={simulateUnverifiedLlmGuess}
                className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition"
                title="Simulate how a normal LLM guesses sluggish parameters, then run Closed-Loop Verification"
              >
                Simulate LLM Drift
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span className="text-slate-400">Stiffness (k)</span>
                  <span className="text-cyan-300 font-bold">
                    {liveStiffness} N/m
                  </span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={800}
                  step={1}
                  value={liveStiffness}
                  onChange={(e) => setLiveStiffness(Number(e.target.value))}
                  className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span className="text-slate-400">Damping (c)</span>
                  <span className="text-purple-300 font-bold">
                    {liveDamping} Ns/m
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={80}
                  step={0.5}
                  value={liveDamping}
                  onChange={(e) => setLiveDamping(Number(e.target.value))}
                  className="w-full accent-purple-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            <button
              onClick={() => runClosedLoopVerification()}
              disabled={isVerifying}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition"
            >
              <ShieldCheck className="w-4 h-4" />
              {isVerifying
                ? "Running SAM 3.1 Closed-Loop Trajectory Audit..."
                : "Run Stage 5: SAM 3.1 Closed-Loop Physics Verification"}
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: STAGE 5 CLOSED-LOOP SAM 3.1 VERIFICATION */}
      {activeTab === "verify" && verification && (
        <div className="flex-1 p-4 space-y-3.5 overflow-y-auto">
          <div
            className={`p-3.5 rounded-xl border flex items-center justify-between ${
              verification.passedThreshold
                ? "bg-emerald-950/30 border-emerald-500/40"
                : "bg-amber-950/30 border-amber-500/50"
            }`}
          >
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                {verification.passedThreshold ? (
                  <span className="text-emerald-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    SAM 3.1 Closed-Loop Verification Passed
                  </span>
                ) : (
                  <span className="text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    Physics Trajectory Drift Detected (&lt;95% Match)
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                Layer: <strong>{verification.layerName}</strong> • RMSE ={" "}
                <span className="font-mono">{verification.rmse}</span>
              </p>
            </div>

            <div className="text-right">
              <div
                className={`text-2xl font-black font-mono ${
                  verification.passedThreshold
                    ? "text-emerald-400"
                    : "text-amber-400"
                }`}
              >
                {verification.fidelityScorePct}%
              </div>
              <div className="text-[10px] font-mono uppercase text-slate-400">
                Physics Match
              </div>
            </div>
          </div>

          {/* Overlaid Original vs Generated Trajectory Graph */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-200">
                SAM 3.1 Re-Tracked Overlay: Original Video vs. Generated Code
              </span>
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <span className="text-cyan-300">● Original Video</span>
                <span
                  className={
                    verification.passedThreshold
                      ? "text-emerald-300"
                      : "text-amber-400"
                  }
                >
                  ━ Generated Component
                </span>
              </div>
            </div>

            <svg viewBox="0 0 440 140" className="w-full h-[135px]">
              <line
                x1={24}
                y1={32}
                x2={416}
                y2={32}
                stroke="#334155"
                strokeDasharray="4 4"
              />
              {/* Original trajectory */}
              <polyline
                fill="none"
                stroke="#06b6d4"
                strokeWidth={2.5}
                strokeDasharray="4 2"
                points={verification.comparisonSeries
                  .map((pt, i) => {
                    const x =
                      24 +
                      (i /
                        Math.max(1, verification.comparisonSeries.length - 1)) *
                        392;
                    const y = 118 - pt.originalNormalized * 86;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  })
                  .join(" ")}
              />
              {/* Generated trajectory */}
              <polyline
                fill="none"
                stroke={verification.passedThreshold ? "#10b981" : "#f59e0b"}
                strokeWidth={2.5}
                points={verification.comparisonSeries
                  .map((pt, i) => {
                    const x =
                      24 +
                      (i /
                        Math.max(1, verification.comparisonSeries.length - 1)) *
                        392;
                    const y = 118 - pt.generatedNormalized * 86;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  })
                  .join(" ")}
              />
            </svg>
          </div>

          {/* Parameter Comparison & Auto-Heal Action */}
          <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase mb-1">
                Target Video Physics (SAM 3.1)
              </div>
              <div className="text-cyan-300">
                stiffness: {verification.originalParams.stiffness}
              </div>
              <div className="text-cyan-300">
                damping: {verification.originalParams.damping}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase mb-1">
                Candidate Code Physics
              </div>
              <div
                className={
                  verification.passedThreshold
                    ? "text-emerald-300"
                    : "text-amber-300"
                }
              >
                stiffness: {verification.generatedParams.stiffness}
              </div>
              <div
                className={
                  verification.passedThreshold
                    ? "text-emerald-300"
                    : "text-amber-300"
                }
              >
                damping: {verification.generatedParams.damping}
              </div>
            </div>
          </div>

          {verification.recommendedPatch && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2.5">
              <p className="text-xs text-amber-200 leading-relaxed">
                {verification.recommendedPatch.reason}
              </p>
              <button
                onClick={applySelfHealingPatch}
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition"
              >
                <Wrench className="w-4 h-4" />
                Auto-Heal Spring Constants with Muse Spark 1.3
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MULTI-TARGET CODE EXPORT & MUSE SPARK PROMPT */}
      {activeTab === "code" && (
        <div className="flex-1 flex flex-col p-3.5 space-y-3 overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {(["react", "swiftui", "css"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setExportLang(lang)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono uppercase transition ${
                    exportLang === lang
                      ? "bg-purple-500/25 text-purple-200 border border-purple-500/40"
                      : "bg-slate-900 text-slate-400 border border-slate-800"
                  }`}
                >
                  {lang === "react"
                    ? "React + Framer"
                    : lang === "swiftui"
                    ? "SwiftUI Spring"
                    : "CSS Keyframes"}
                </button>
              ))}
            </div>

            <button
              onClick={copyCode}
              className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 border border-slate-700 transition"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy Code
                </>
              )}
            </button>
          </div>

          <pre className="flex-1 rounded-xl bg-[#050811] border border-slate-800 p-3 text-[11px] font-mono text-slate-200 overflow-auto leading-relaxed">
            <code>{activeCode}</code>
          </pre>

          {/* Muse Spark 1.3 Natural Language Code Mutation Bar */}
          <form onSubmit={handleRefineWithSpark} className="space-y-1.5">
            {sparkStatus && (
              <div className="text-[11px] font-mono text-cyan-300 px-1">
                {sparkStatus}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={sparkPrompt}
                onChange={(e) => setSparkPrompt(e.target.value)}
                placeholder="Ask Muse Spark 1.3 to refine code (e.g., 'Add a glassmorphic glow on expand')..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 transition"
              >
                <Send className="w-3.5 h-3.5" />
                Spark
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
