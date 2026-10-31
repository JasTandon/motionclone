"use client";

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
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
  Loader2,
} from "lucide-react";
import { AnalysisPayload, TrackedLayer, VerificationResult } from "@/types/motion";
import { verifyTrajectoryLocal } from "@/lib/localPhysicsEngine";
import {
  buildCssCode,
  buildReactFallbackCode,
  buildSwiftUICode,
  patchReactSprings,
  springFor,
  SpringOverrides,
  SpringParams,
} from "@/lib/codegen";
import { injectPreviewRuntime } from "@/lib/generatedHtml";

interface LiveCodeSandboxProps {
  analysis: AnalysisPayload;
  selectedLayer: TrackedLayer;
  apiBaseUrl: string;
  apiKey: string;
}

function LiveCodeSandbox({
  analysis,
  selectedLayer,
  apiBaseUrl,
  apiKey,
}: LiveCodeSandboxProps) {
  const [activeTab, setActiveTab] = useState<"preview" | "code" | "verify">(
    "preview"
  );
  const [exportLang, setExportLang] = useState<"react" | "swiftui" | "css">(
    "react"
  );
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [iframeKey, setIframeKey] = useState<number>(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Per-layer spring edits (sliders / Auto-Fix). Drives the preview and every export.
  const [overrides, setOverrides] = useState<SpringOverrides>({});
  const live = springFor(selectedLayer, overrides);
  const liveStiffness = live.stiffness;
  const liveDamping = live.damping;
  const liveMass = live.mass;
  const setLive = (patch: Partial<SpringParams>) =>
    setOverrides((prev) => ({
      ...prev,
      [selectedLayer.id]: { ...springFor(selectedLayer, prev), ...patch },
    }));

  const [verification, setVerification] = useState<VerificationResult | null>(
    null
  );
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  const [sparkPrompt, setSparkPrompt] = useState<string>("");
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [customReactCode, setCustomReactCode] = useState<string>(
    analysis.codeExports.reactCode
  );
  const [customPreviewHtml, setCustomPreviewHtml] = useState<string | undefined>(
    analysis.livePreviewHtml
  );
  const [sparkStatus, setSparkStatus] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  // New analysis → reset generated code and edits. Switching layers keeps both.
  useEffect(() => {
    setOverrides({});
    setCustomReactCode(analysis.codeExports.reactCode);
    setCustomPreviewHtml(analysis.livePreviewHtml);
    setRuntimeError(null);
    setSparkStatus(null);
  }, [analysis]);

  useEffect(() => {
    setVerification(null);
  }, [selectedLayer, analysis]);

  // Live springs injected into the generated document; debounced so dragging stays smooth.
  const springMap = useMemo(
    () => ({
      primary: live,
      layers: Object.fromEntries(analysis.layers.map((l) => [l.id, springFor(l, overrides)])),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analysis.layers, overrides, selectedLayer.id]
  );
  const [debouncedSprings, setDebouncedSprings] = useState(springMap);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSprings(springMap), 220);
    return () => clearTimeout(t);
  }, [springMap]);
  const previewSrcDoc = useMemo(
    () => (customPreviewHtml ? injectPreviewRuntime(customPreviewHtml, debouncedSprings) : undefined),
    [customPreviewHtml, debouncedSprings]
  );

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      if (ev.data && ev.data.type === "MC_PREVIEW_ERROR") setRuntimeError(String(ev.data.message));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleReplayAnimation = () => {
    if (customPreviewHtml) {
      setRuntimeError(null);
      setIframeKey((k) => k + 1);
    } else {
      setIsExpanded(false);
      setTimeout(() => setIsExpanded(true), 240);
    }
  };

  const runClosedLoopVerification = (
    stiff = liveStiffness,
    damp = liveDamping,
    m = liveMass
  ) => {
    setIsVerifying(true);
    setVerification(verifyTrajectoryLocal(selectedLayer, stiff, damp, m));
    setActiveTab("verify");
    setIsVerifying(false);
  };

  useEffect(() => {
    if (activeTab === "verify" && !verification) runClosedLoopVerification();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, verification]);

  const applySelfHealingPatch = () => {
    const patch = verification?.recommendedPatch;
    if (!patch) return;
    setLive({ stiffness: patch.stiffness, damping: patch.damping, mass: patch.mass });
    runClosedLoopVerification(patch.stiffness, patch.damping, patch.mass);
  };

  const callSpark = async (payload: { userPrompt?: string; runtimeError?: string }) => {
    setIsRefining(true);
    setSparkStatus(
      payload.runtimeError
        ? "Muse Spark 1.3 is repairing the runtime error…"
        : "Muse Spark 1.3 is updating your cloned UI & code…"
    );
    try {
      const res = await fetch(`${apiBaseUrl}/api/refine-with-spark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          currentReactCode: customReactCode,
          currentPreviewHtml: customPreviewHtml || "",
          apiKey: apiKey || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.reactCode) setCustomReactCode(data.reactCode);
        if (data.livePreviewHtml) {
          setCustomPreviewHtml(data.livePreviewHtml);
          setRuntimeError(null);
          setIframeKey((k) => k + 1);
        }
        setSparkPrompt("");
      }
      setSparkStatus(`${res.ok ? "✨" : "⚠️"} ${data.notice || (res.ok ? "Updated." : `HTTP ${res.status}`)}`);
    } catch (err) {
      setSparkStatus(`⚠️ Could not reach Muse Spark: ${String(err).slice(0, 120)}`);
    } finally {
      setIsRefining(false);
    }
  };

  const handleRefineWithSpark = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sparkPrompt.trim() || isRefining) return;
    callSpark({ userPrompt: sparkPrompt.trim() });
  };

  const exportLayers = analysis.layers;
  const activeCode = useMemo(() => {
    if (exportLang === "swiftui")
      return buildSwiftUICode(analysis.interactionTitle, exportLayers, overrides, analysis.sceneBackgroundHex || "#000000");
    if (exportLang === "css") return buildCssCode(analysis.interactionTitle, exportLayers, overrides);
    const isOriginal = customReactCode === analysis.codeExports.reactCode;
    // Example presets ship hand-written React; uploads get Muse code patched with live springs.
    if (analysis.isExample && isOriginal && Object.keys(overrides).length)
      return buildReactFallbackCode(analysis.interactionTitle, exportLayers, overrides);
    return patchReactSprings(customReactCode, exportLayers, overrides);
  }, [exportLang, analysis, exportLayers, overrides, customReactCode]);

  const copyCode = () => {
    navigator.clipboard?.writeText(activeCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const l0 = analysis.layers[0] ? springFor(analysis.layers[0], overrides) : live;
  const l1Layer = analysis.layers[1] || analysis.layers[0] || selectedLayer;
  const l2Layer = analysis.layers[2] || l1Layer;
  const l1 = { ...springFor(l1Layer, overrides), stagger_delay_ms: l1Layer.physics.stagger_delay_ms };
  const l2 = { ...springFor(l2Layer, overrides), stagger_delay_ms: l2Layer.physics.stagger_delay_ms };

  return (
    <div className="flex flex-col h-full bg-[#090d18] border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header & Clear Tab Switcher */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-[#0c1222]">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-500/20 text-purple-300 font-bold text-xs border border-purple-500/40">
            2
          </span>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              Cloned Working UI & Code
              {analysis.usedLiveMetaApi && (
                <span className="whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Muse Spark 1.3 Live
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400">
              Interact with your cloned animation or copy the generated code
            </p>
          </div>
        </div>

        <div className="flex items-center bg-slate-950/90 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab("preview")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === "preview"
                ? "bg-cyan-500 text-slate-950 shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Interactive UI
          </button>
          <button
            onClick={() => setActiveTab("code")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeTab === "code"
                ? "bg-purple-500 text-white shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Get Code
          </button>
          <button
            onClick={() => runClosedLoopVerification()}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
              activeTab === "verify"
                ? "bg-emerald-500 text-slate-950 shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Verify Match
          </button>
        </div>
      </div>

      {/* TAB 1: LIVE INTERACTIVE CLONE */}
      {activeTab === "preview" && (
        <div className="flex-1 flex flex-col justify-between p-4 space-y-3.5 overflow-y-auto">
          {/* Interactive Component Viewport */}
          <div className="relative flex-1 min-h-[340px] rounded-xl bg-gradient-to-b from-[#050811] via-[#091122] to-[#050811] border border-slate-800/90 flex flex-col items-center justify-center p-2 overflow-hidden">
            <div className="absolute top-3 left-3 z-20 flex items-center gap-2 text-[11px] font-mono text-slate-300 bg-slate-950/85 px-2.5 py-1 rounded-lg border border-slate-800 pointer-events-none">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              {customPreviewHtml ? "Live clone · springs update as you drag" : "Live Cloned Component (click to toggle)"}
            </div>

            <button
              onClick={handleReplayAnimation}
              className="absolute top-3 right-3 z-20 px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg transition"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Replay Animation
            </button>

            {/* If uploaded video generated custom HTML from Muse Spark 1.3, render it live in an iframe! */}
            {previewSrcDoc ? (
              <>
                <iframe
                  key={iframeKey}
                  ref={iframeRef}
                  title="Muse Spark 1.3 Live Cloned UI"
                  srcDoc={previewSrcDoc}
                  className="w-full h-[325px] border-0 rounded-lg bg-transparent"
                  sandbox="allow-scripts"
                />
                {runtimeError && (
                  <div className="absolute bottom-3 left-3 right-3 z-20 flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-950/90 px-3 py-2 text-[11px] text-amber-100">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                    <span className="flex-1 truncate font-mono">Runtime error: {runtimeError}</span>
                    <button
                      onClick={() => callSpark({ runtimeError })}
                      disabled={isRefining}
                      className="shrink-0 rounded-md bg-amber-400 px-2.5 py-1 font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-60"
                    >
                      {isRefining ? "Repairing…" : "Self-heal with Muse Spark"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Built-in example 1: Dynamic Island */}
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
                      stiffness: l0.stiffness,
                      damping: l0.damping,
                      mass: l0.mass,
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
                          mass: l1.mass,
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
                              stiffness={liveStiffness} • damping={liveDamping}
                            </span>
                            <span>-02:18</span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}

                {/* Built-in example 2: Stripe Magnetic Drawer */}
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
                      stiffness: l0.stiffness,
                      damping: l0.damping,
                      mass: l0.mass,
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

                {/* Built-in example 3: Bento Card */}
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
                        stiffness: l0.stiffness,
                        damping: l0.damping,
                        mass: l0.mass,
                      }}
                      className="cursor-pointer rounded-3xl bg-slate-900 border border-blue-500/30 shadow-[0_20px_50px_rgba(59,130,246,0.2)] p-4 flex flex-col justify-between overflow-hidden"
                    >
                      <div className="flex items-center justify-between">
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          CLONED SPRING UI
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
              </>
            )}
          </div>

          {/* Tweak Bounce & Speed Sliders */}
          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5 min-w-0 truncate">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                Spring ({selectedLayer.name.length > 30 ? `${selectedLayer.name.slice(0, 29)}…` : selectedLayer.name})
              </span>
              <button
                onClick={() => runClosedLoopVerification()}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition flex items-center gap-1"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Verify vs. video
              </button>
              <button
                onClick={() => setActiveTab("code")}
                className="hidden xl:flex px-2.5 py-1 rounded-lg text-xs font-semibold bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 transition flex items-center gap-1"
              >
                <Code2 className="w-3.5 h-3.5" />
                View React / CSS Code →
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Snap Speed (Stiffness)</span>
                  <span className="text-cyan-300 font-mono font-bold">
                    {liveStiffness}
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={Math.max(1200, Math.ceil(liveStiffness))}
                  step={1}
                  value={liveStiffness}
                  onChange={(e) => setLive({ stiffness: Number(e.target.value) })}
                  className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Brake / Smoothness (Damping)</span>
                  <span className="text-purple-300 font-mono font-bold">
                    {liveDamping}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={Math.max(80, Math.ceil(liveDamping))}
                  step={0.5}
                  value={liveDamping}
                  onChange={(e) => setLive({ damping: Number(e.target.value) })}
                  className="w-full accent-purple-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Ask Muse Spark 1.3 directly from Preview tab */}
            <form onSubmit={handleRefineWithSpark} className="pt-1 space-y-1.5">
              {sparkStatus && (
                <div className="text-xs font-mono text-emerald-300 px-1">
                  {sparkStatus}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={sparkPrompt}
                  onChange={(e) => setSparkPrompt(e.target.value)}
                  placeholder="Ask Muse Spark 1.3 to customize this UI (e.g. 'Make it a purple notification banner')..."
                  className="flex-1 bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  disabled={isRefining || !sparkPrompt.trim()}
                  className="disabled:opacity-60 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-400 hover:to-purple-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition shrink-0"
                >
                  {isRefining ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  Ask Muse Spark
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: GET CODE (REACT / SWIFTUI / CSS) */}
      {activeTab === "code" && (
        <div className="flex-1 flex flex-col p-4 space-y-3 overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {(["react", "swiftui", "css"] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setExportLang(lang)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    exportLang === lang
                      ? "bg-purple-500/25 text-purple-200 border border-purple-500/40"
                      : "bg-slate-900 text-slate-400 border border-slate-800"
                  }`}
                >
                  {lang === "react"
                    ? "React + Framer Motion"
                    : lang === "swiftui"
                    ? "SwiftUI Spring"
                    : "CSS linear() Spring"}
                </button>
              ))}
            </div>

            <button
              onClick={copyCode}
              className="px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-xs font-bold text-slate-950 flex items-center gap-1.5 transition shadow"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Copied to Clipboard!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy Code
                </>
              )}
            </button>
          </div>

          <pre className="flex-1 rounded-xl bg-[#050811] border border-slate-800 p-3.5 text-xs font-mono text-slate-200 overflow-auto leading-relaxed max-h-[380px]">
            <code>{activeCode}</code>
          </pre>

          <form onSubmit={handleRefineWithSpark} className="space-y-1.5">
            {sparkStatus && (
              <div className="text-xs font-mono text-emerald-300 px-1">
                {sparkStatus}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={sparkPrompt}
                onChange={(e) => setSparkPrompt(e.target.value)}
                placeholder="Ask Muse Spark 1.3 to edit code (e.g., 'Convert to Tailwind dark glass style')..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                disabled={isRefining || !sparkPrompt.trim()}
                className="disabled:opacity-60 px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 transition"
              >
                <Send className="w-3.5 h-3.5" />
                Update Code
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: SAM 3.1 ACCURACY VERIFICATION */}
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
                    Animation Matches Original Video!
                  </span>
                ) : (
                  <span className="text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    Animation Speed/Bounce Drifted from Video
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                RMSE of the candidate spring vs. {selectedLayer.physics.telemetry_series.length} measured samples
                {selectedLayer.fitSource ? ` (${selectedLayer.fitSource})` : ""}
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
                Motion Match
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-200">
                Motion Curve Comparison: Original Video vs. Cloned Code
              </span>
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="text-cyan-300">--- Measured (video)</span>
                <span
                  className={
                    verification.passedThreshold
                      ? "text-emerald-300"
                      : "text-amber-400"
                  }
                >
                  ━━ Candidate spring
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

          <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
            <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-slate-500">RMSE</div>
              <div className="text-slate-100">{verification.rmse}</div>
            </div>
            <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-slate-500">Candidate k / c / m</div>
              <div className="text-slate-100">
                {verification.generatedParams.stiffness} / {verification.generatedParams.damping} / {verification.generatedParams.mass}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
              <div className="text-slate-500">Measured fit R²</div>
              <div className="text-slate-100">{selectedLayer.physics.r_squared}</div>
            </div>
          </div>

          {verification.passedThreshold && (
            <p className="text-[11px] text-slate-400 px-1">
              Drag the Stiffness/Damping sliders on the Interactive UI tab to detune the spring, then Verify again to watch the closed loop catch it.
            </p>
          )}

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
                Auto-Fix Spring Constants to Match Video
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(LiveCodeSandbox);
