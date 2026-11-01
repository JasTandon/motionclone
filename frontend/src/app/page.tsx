"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Video,
  KeyRound,
  Sparkles,
  Activity,
  CheckCircle2,
  X,
  StopCircle,
  Loader2,
  Film,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import VideoMaskStage from "@/components/VideoMaskStage";
import TelemetryPanel from "@/components/TelemetryPanel";
import LiveCodeSandbox from "@/components/LiveCodeSandbox";
import { AnalysisPayload, PipelineEvent, StageId } from "@/types/motion";
import { buildPresetAnalysisLocal, springStepScalar } from "@/lib/localPhysicsEngine";
import { analyzeVideoFileFramesClient, ExtractedVideoData } from "@/lib/videoFrameAnalyzer";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

const STAGES: { id: StageId | "decode"; label: string }[] = [
  { id: "decode", label: "Decode 30 frames + pixel-motion envelope (browser)" },
  { id: "muse-detect", label: "Muse Spark 1.3 · multi-frame layer & phase reasoning" },
  { id: "sam-track", label: "SAM 3.1 · per-keyframe concept segmentation" },
  { id: "spring-fit", label: "Inverse spring fit · Levenberg–Marquardt" },
  { id: "muse-synth", label: "Muse Spark 1.3 · grounded 60fps code synthesis" },
  { id: "self-heal", label: "Self-heal · lint + JS parse + repair pass" },
  { id: "visual-verify", label: "Visual verify · render clone in headless Chrome, score vs. video frames" },
  { id: "visual-refine", label: "Visual refine · Muse Spark fixes the worst-matching frames" },
];

type StageState = { status: "pending" | "start" | "done" | "warn"; message?: string };

function pickRecorderMime() {
  const options = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) || "";
}

function recordingFile(chunks: BlobPart[], mime: string, base: string) {
  const type = (mime || "video/webm").split(";")[0];
  const ext = type.includes("mp4") ? "mp4" : "webm";
  return new File([new Blob(chunks, { type })], `${base}.${ext}`, { type });
}

const EXAMPLE_CLIPS = [
  { id: "dynamic-island", label: "Example: Dynamic Island Music Player" },
  { id: "magnetic-wallet", label: "Example: Magnetic Payment Drawer" },
  { id: "bento-morph", label: "Example: Expandable Analytics Card" },
];

export default function MotionCloneStudioPage() {
  const [activePresetId, setActivePresetId] =
    useState<string>("dynamic-island");
  const [analysis, setAnalysis] = useState<AnalysisPayload>(() =>
    buildPresetAnalysisLocal("dynamic-island")
  );
  const [selectedLayerId, setSelectedLayerId] = useState<string>("layer-1");
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [showMathDrawer, setShowMathDrawer] = useState<boolean>(false);
  const [stages, setStages] = useState<Record<string, StageState>>({});
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const extractedRef = useRef<{ file: File; data: ExtractedVideoData } | null>(null);

  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [isRecordingScreen, setIsRecordingScreen] = useState<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string>("");
  const [customPrompts, setCustomPrompts] = useState<string>("");
  const [serverKey, setServerKey] = useState<boolean>(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("motionclone_meta_api_key");
    if (saved) setApiKey(saved);
    fetch(`${API_BASE_URL}/api/analyze-video`)
      .then((r) => r.json())
      .then((d) => setServerKey(!!d.serverKeyConfigured))
      .catch(() => {});
  }, []);

  const saveApiKey = (val: string) => {
    setApiKey(val);
    window.localStorage.setItem("motionclone_meta_api_key", val);
  };

  const fetchPreset = (presetId: string) => {
    abortRef.current?.abort();
    requestSeqRef.current++;
    setIsLoading(false);
    setActivePresetId(presetId);
    setUploadedVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setLastUploadedFile(null);
    const instantData = buildPresetAnalysisLocal(presetId);
    setAnalysis(instantData);
    setSelectedLayerId(instantData.layers[0]?.id || "layer-1");
    setCurrentFrame(0);
  };

  const handleVideoFileUpload = async (
    file: File,
    overrideKey?: string,
    continueFrom?: AnalysisPayload
  ) => {
    setLastUploadedFile(file);
    setUploadedVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });

    // An empty key is fine when the server has MODEL_API_KEY; otherwise it answers MISSING_API_KEY.
    const activeKey = (overrideKey ?? apiKey).trim();

    // A newer upload supersedes any in-flight analysis.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeqRef.current;
    const isCurrent = () => seq === requestSeqRef.current;
    const setStage = (id: string, st: StageState) =>
      isCurrent() && setStages((prev) => ({ ...prev, [id]: st }));

    const reuse = continueFrom && extractedRef.current?.file === file ? extractedRef.current.data : null;
    setIsLoading(true);
    if (reuse) {
      const reused: StageState = { status: "done", message: "Reused from the previous run" };
      setStages({ decode: reused, "muse-detect": reused, "sam-track": reused, "spring-fit": reused, "muse-synth": reused, "self-heal": reused });
      setStatusBanner(`Refining the clone of "${file.name}"…`);
    } else {
      setStages({ decode: { status: "start", message: `Decoding "${file.name}"…` } });
      setStatusBanner(`Analyzing "${file.name}"…`);
    }

    try {
      const extracted =
        reuse ??
        (await analyzeVideoFileFramesClient(file, (msg) =>
          setStage("decode", { status: "start", message: msg })
        ));
      if (!isCurrent()) return;
      extractedRef.current = { file, data: extracted };
      if (!reuse) setStage("decode", {
        status: "done",
        message: `${extracted.keyframesDataUrls.length} keyframes over ${(extracted.durationMs / 1000).toFixed(2)}s${
          extracted.globalFit
            ? ` · pixel-motion fit ζ=${extracted.globalFit.fit.zeta}, R²=${extracted.globalFit.fit.rSquared}`
            : ""
        }`,
      });

      const res = await fetch(`${API_BASE_URL}/api/analyze-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          fileName: file.name,
          durationMs: extracted.durationMs,
          keyframes: extracted.keyframesDataUrls,
          keyframeTimesMs: extracted.keyframeTimesMs,
          motionTrack: extracted.motionTrack,
          globalFit: extracted.globalFit,
          customPrompts: customPrompts.trim(),
          apiKey: activeKey,
          continueFrom: reuse ? continueFrom : undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        if (!isCurrent()) return;
        setStatusBanner(`⚠️ ${data.message || `Analysis failed (HTTP ${res.status}).`}`);
        if (data.error === "MISSING_API_KEY") setShowKeyModal(true);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: AnalysisPayload | null = null;
      let failure: { error?: string; message?: string } | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const evt = JSON.parse(line) as
            | PipelineEvent
            | { type: "result"; data: AnalysisPayload }
            | { type: "error"; error: string; message: string };
          if (evt.type === "stage") setStage(evt.stage, { status: evt.status, message: evt.message });
          else if (evt.type === "result") result = evt.data;
          else if (evt.type === "error") failure = evt;
        }
      }
      if (!isCurrent()) return;

      if (failure || !result) {
        setStatusBanner(`⚠️ ${failure?.message || "The analysis stream ended without a result."}`);
        if (failure?.error === "INVALID_API_KEY") setShowKeyModal(true);
        return;
      }
      if (!result.layers.length) {
        result.layers = extracted.layers;
      }
      setAnalysis(result);
      setSelectedLayerId(result.layers[0]?.id || "layer-1");
      setCurrentFrame(0);
      const agree = result.crossModelAgreement;
      const vm = result.visualMatch;
      setStatusBanner(
        `✨ "${result.interactionTitle}" cloned — ${result.layers.length} layers${
          agree ? ` · SAM↔Muse IoU ${agree.meanIoU.toFixed(2)}` : ""
        }${vm ? ` · visual match ${(vm.score * 100).toFixed(1)}%` : ""}${result.selfHeal?.repaired ? " · self-healed" : ""}`
      );
    } catch (err) {
      if (!isCurrent() || (err as Error).name === "AbortError") return;
      setStatusBanner(`⚠️ ${String((err as Error).message || err).slice(0, 300)}`);
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  };

  // Stable callback so the memoized sandbox does not re-render on every playback frame.
  const refineAgainRef = useRef<() => void>(() => {});
  refineAgainRef.current = () => {
    if (lastUploadedFile && !isLoading) handleVideoFileUpload(lastUploadedFile, undefined, analysis);
  };
  const onRefineAgain = useCallback(() => refineAgainRef.current(), []);

  const synthesizeAndIngestSampleVideo = async () => {
    setStatusBanner(
      "Generating sample UI Notification Card video (.webm)..."
    );
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const stream = canvas.captureStream(60);
    const mime = pickRecorderMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      handleVideoFileUpload(recordingFile(chunks, recorder.mimeType || mime, "notification-toast-animation"));
    };

    recorder.start();

    // 0.3s hold, then a 1.2s spring expansion, so the clip has a measurable onset.
    const totalFrames = 90;
    for (let f = 0; f < totalFrames; f++) {
      const tau = Math.max(0, (f - 18) / 60);
      const u = springStepScalar(tau, 19.5, 0.58);

      ctx.fillStyle = "#050811";
      ctx.fillRect(0, 0, 640, 400);

      const x = 195 - 75 * u;
      const y = 72 - 18 * u;
      const w = 250 + 150 * u;
      const h = 60 + 130 * u;

      ctx.fillStyle = "#0f172a";
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 22);
      ctx.fill();
      ctx.stroke();

      const ax = x + 18;
      const ay = y + 16;
      const aw = 32 + 24 * u;
      ctx.fillStyle = "#a855f7";
      ctx.beginPath();
      ctx.roundRect(ax, ay, aw, aw, 12);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 15px sans-serif";
      ctx.fillText("Incoming Call • Alex Rivera", ax + aw + 14, ay + 20);

      if (u > 0.35) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "12px monospace";
        ctx.fillText("Meta AI Spatial Video • 60fps", ax + aw + 14, ay + 40);

        const bx = x + 20;
        const by = y + h - 52;
        const bw = w - 40;
        ctx.fillStyle = "#10b981";
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, 36, 10);
        ctx.fill();

        ctx.fillStyle = "#050811";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText("Accept Video Call", bx + bw / 2 - 55, by + 23);
      }

      await new Promise((r) => setTimeout(r, 1000 / 60));
    }

    recorder.stop();
  };

  const startBrowserScreenRecording = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60 },
        audio: false,
      });
    } catch {
      setStatusBanner("Screen recording was cancelled or blocked by the browser.");
      return;
    }
    const chunks: BlobPart[] = [];
    const mime = pickRecorderMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRecorderRef.current = recorder;
    setIsRecordingScreen(true);
    setStatusBanner("● Recording 4s — play the animation you want to clone now…");

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      setIsRecordingScreen(false);
      stream.getTracks().forEach((t) => t.stop());
      if (!chunks.length) {
        setStatusBanner("Recording captured no frames — try again.");
        return;
      }
      handleVideoFileUpload(recordingFile(chunks, recorder.mimeType || mime, "screen-recording"));
    };
    // The browser's own "Stop sharing" button ends the track, not the recorder.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (recorder.state === "recording") recorder.stop();
    });

    recorder.start(250);
    setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 4000);
  };

  const stopBrowserScreenRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
  };

  const selectedLayer =
    analysis.layers.find((l) => l.id === selectedLayerId) ||
    analysis.layers[0];

  return (
    <div className="min-h-screen flex flex-col bg-[#050811] text-slate-100">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-[#080c17]/95 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1560px] mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 via-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Activity className="w-5 h-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white">
                  MotionClone
                </h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                  Meta SAM 3.1 + Muse Spark 1.3
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Upload any UI screen recording → Get working interactive code with matching animation physics
              </p>
            </div>
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleVideoFileUpload(file);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition"
            >
              <Upload className="w-4 h-4" />
              Upload Any UI Video (.MP4/.MOV)
            </button>

            {lastUploadedFile && (
              <button
                onClick={() => handleVideoFileUpload(lastUploadedFile)}
                disabled={isLoading}
                className="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1.5 transition"
                title="Re-run Muse Spark 1.3 & SAM 3.1 on the current video"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Re-Analyze Video
              </button>
            )}

            {!isRecordingScreen ? (
              <button
                onClick={startBrowserScreenRecording}
                className="px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <Video className="w-3.5 h-3.5" />
                Record Screen (4s)
              </button>
            ) : (
              <button
                onClick={stopBrowserScreenRecording}
                className="px-3.5 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5 animate-pulse"
              >
                <StopCircle className="w-3.5 h-3.5" />
                Stop Recording
              </button>
            )}

            <button
              onClick={synthesizeAndIngestSampleVideo}
              disabled={isLoading}
              className="px-3 py-2 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 text-xs font-medium flex items-center gap-1.5 transition"
            >
              <Film className="w-3.5 h-3.5" />
              Try Sample Video
            </button>

            <select
              value={uploadedVideoUrl ? "custom" : activePresetId}
              onChange={(e) => {
                if (e.target.value !== "custom") fetchPreset(e.target.value);
              }}
              className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-xl px-2.5 py-2 focus:outline-none focus:border-cyan-500"
            >
              {uploadedVideoUrl && (
                <option value="custom">📹 Custom Uploaded Video</option>
              )}
              {EXAMPLE_CLIPS.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.label}
                </option>
              ))}
            </select>

            <button
              onClick={() => setShowKeyModal(true)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition ${
                apiKey || serverKey
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                  : "bg-amber-500 text-slate-950 border-amber-400 font-bold animate-pulse"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              {apiKey ? "Meta API Ready" : serverKey ? "Meta API Ready (server key)" : "Set Meta API Key"}
            </button>
          </div>
        </div>

        {/* Status Notification Strip */}
        {statusBanner && (
          <div className="bg-cyan-950/70 border-t border-cyan-800/50 px-4 py-2 text-xs text-cyan-100 flex items-center justify-between max-w-[1560px] mx-auto">
            <span className="flex items-center gap-2 font-medium">
              <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
              {statusBanner}
            </span>
            <button
              onClick={() => setStatusBanner(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      {/* Main Side-by-Side Workspace */}
      <main className="flex-1 max-w-[1560px] w-full mx-auto p-4 space-y-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center min-h-[480px] gap-5 bg-[#090d18] border border-slate-800 rounded-2xl p-8">
            <div className="flex items-center gap-3">
              <Loader2 className="w-7 h-7 text-cyan-400 animate-spin" />
              <h3 className="text-lg font-bold text-white">
                Closed-loop pipeline running: SAM 3.1 ⇄ Muse Spark 1.3
              </h3>
            </div>
            <ol className="w-full max-w-2xl space-y-2">
              {STAGES.map((st, i) => {
                const state = stages[st.id]?.status ?? "pending";
                return (
                  <li
                    key={st.id}
                    className={`flex items-start gap-3 px-3 py-2 rounded-xl border text-xs ${
                      state === "start"
                        ? "border-cyan-500/50 bg-cyan-950/30"
                        : state === "done"
                        ? "border-emerald-600/40 bg-emerald-950/20"
                        : state === "warn"
                        ? "border-amber-500/40 bg-amber-950/20"
                        : "border-slate-800 bg-slate-950/40 opacity-60"
                    }`}
                  >
                    <span className="mt-0.5 w-5 shrink-0 text-center font-mono">
                      {state === "start" ? (
                        <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                      ) : state === "done" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : state === "warn" ? (
                        "⚠️"
                      ) : (
                        <span className="text-slate-500">{i + 1}</span>
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-100">{st.label}</div>
                      {stages[st.id]?.message && (
                        <div className="text-slate-400 font-mono break-words mt-0.5">
                          {stages[st.id]?.message}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
              {/* LEFT SIDE: 1. Input Video & SAM 3.1 Tracking */}
              <VideoMaskStage
                analysis={analysis}
                currentFrame={currentFrame}
                setCurrentFrame={setCurrentFrame}
                selectedLayerId={selectedLayer.id}
                setSelectedLayerId={setSelectedLayerId}
                uploadedVideoUrl={uploadedVideoUrl}
              />

              {/* RIGHT SIDE: 2. Cloned Working UI & Code */}
              <LiveCodeSandbox
                analysis={analysis}
                selectedLayer={selectedLayer}
                apiBaseUrl={API_BASE_URL}
                apiKey={apiKey}
                onRefineAgain={lastUploadedFile ? onRefineAgain : undefined}
              />
            </div>

            {/* Optional Expandable Under-the-Hood Math & Telemetry Drawer */}
            <div className="rounded-2xl bg-[#090d18] border border-slate-800/80 overflow-hidden">
              <button
                onClick={() => setShowMathDrawer(!showMathDrawer)}
                className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-slate-300 hover:bg-slate-900/60 transition"
              >
                <span className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-purple-400" />
                  Under the Hood: View Extracted Spring Curves, Velocity Graph & Differential Equations
                </span>
                <span className="flex items-center gap-1 text-cyan-400">
                  {showMathDrawer ? (
                    <>
                      Hide Math Telemetry <ChevronUp className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      Show Math Telemetry <ChevronDown className="w-4 h-4" />
                    </>
                  )}
                </span>
              </button>

              {showMathDrawer && (
                <div className="p-4 border-t border-slate-800">
                  <TelemetryPanel
                    layer={selectedLayer}
                    currentFrame={currentFrame}
                    setCurrentFrame={setCurrentFrame}
                    timeMs={
                      selectedLayer.frames[currentFrame]?.timestamp_ms ??
                      (currentFrame / 59) * analysis.videoMeta.durationMs
                    }
                  />
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Meta Model API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#0b101d] border border-slate-800 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-cyan-400" />
                Meta Model API Key (`sam-3.1` & `muse-spark-1.3`)
              </h3>
              <button
                onClick={() => setShowKeyModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Paste your MODEL_API_KEY (Required to analyze custom videos)
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => saveApiKey(e.target.value)}
                  placeholder="Paste your Meta Model API bearer token..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Optional Custom SAM 3.1 Concept Prompts (comma-separated)
                </label>
                <input
                  type="text"
                  value={customPrompts}
                  onChange={(e) => setCustomPrompts(e.target.value)}
                  placeholder="Leave blank for Muse Spark 1.3 auto-discovery"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
                <div className="text-slate-200 font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Saved in Browser LocalStorage
                </div>
                <p>
                  Your key is saved locally in your browser so you only need to paste it once.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setShowKeyModal(false);
                  if (lastUploadedFile && apiKey.trim()) {
                    handleVideoFileUpload(lastUploadedFile, apiKey.trim());
                  }
                }}
                className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition"
              >
                {lastUploadedFile
                  ? `Save & Analyze "${lastUploadedFile.name}"`
                  : "Save & Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
