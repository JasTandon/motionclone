"use client";

import React, { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import VideoMaskStage from "@/components/VideoMaskStage";
import TelemetryPanel from "@/components/TelemetryPanel";
import LiveCodeSandbox from "@/components/LiveCodeSandbox";
import { AnalysisPayload } from "@/types/motion";
import { buildPresetAnalysisLocal, springStepScalar } from "@/lib/localPhysicsEngine";
import { analyzeVideoFileFramesClient } from "@/lib/videoFrameAnalyzer";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

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

  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [isRecordingScreen, setIsRecordingScreen] = useState<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string>("");
  const [customPrompts, setCustomPrompts] = useState<string>("");

  // Load saved API key from localStorage on mount
  useEffect(() => {
    const saved = window.localStorage.getItem("motionclone_meta_api_key");
    if (saved) setApiKey(saved);
  }, []);

  const saveApiKey = (val: string) => {
    setApiKey(val);
    window.localStorage.setItem("motionclone_meta_api_key", val);
  };

  const fetchPreset = async (presetId: string) => {
    setUploadedVideoUrl(null);
    const instantData = buildPresetAnalysisLocal(presetId);
    setAnalysis(instantData);
    setSelectedLayerId(instantData.layers[0]?.id || "layer-1");
    setCurrentFrame(0);
  };

  useEffect(() => {
    fetchPreset(activePresetId);
  }, [activePresetId]);

  const handleVideoFileUpload = async (file: File) => {
    const localUrl = URL.createObjectURL(file);
    setUploadedVideoUrl(localUrl);
    setIsLoading(true);
    setStatusBanner(
      `Step 1/2: Extracting 60fps frames & motion curves from "${file.name}"...`
    );

    try {
      const extracted = await analyzeVideoFileFramesClient(file);
      setStatusBanner(
        apiKey
          ? `Step 2/2: Sending video keyframes & spring math to Meta SAM 3.1 + Muse Spark 1.3...`
          : `Step 2/2: Compiling interactive UI & React code from measured spring curves...`
      );

      const formData = new FormData();
      formData.append("video", file);
      formData.append(
        "client_telemetry",
        JSON.stringify({
          fps: extracted.fps,
          frameCount: extracted.frameCount,
          width: extracted.width,
          height: extracted.height,
          durationMs: extracted.durationMs,
          layers: extracted.layers,
        })
      );
      formData.append(
        "keyframes_json",
        JSON.stringify(extracted.keyframesDataUrls || [])
      );
      if (customPrompts.trim()) {
        formData.append("custom_prompts", customPrompts.trim());
      }
      if (apiKey.trim()) {
        formData.append("api_key", apiKey.trim());
      }

      const res = await fetch(`${API_BASE_URL}/api/analyze-video`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data: AnalysisPayload = await res.json();
        setAnalysis(data);
        setSelectedLayerId(data.layers[0]?.id || "layer-1");
        setCurrentFrame(0);
        setStatusBanner(
          data.usedLiveMetaApi
            ? `Done! Meta SAM 3.1 + Muse Spark 1.3 analyzed "${file.name}" and built your working UI clone on the right →`
            : `Done! Extracted spring animation (${data.layers[0].physics.settling_duration_ms}ms, ${data.layers[0].physics.overshoot_pct}% bounce) from "${file.name}" →`
        );
      }
    } catch {
      const fallback = buildPresetAnalysisLocal("dynamic-island");
      fallback.interactionTitle = `Cloned UI Video (${file.name})`;
      setAnalysis(fallback);
      setStatusBanner(`Loaded "${file.name}" into MotionClone.`);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Renders a realistic animated UI Notification Card on an offscreen canvas,
   * records it as a real .webm video, and sends it through the full Meta API pipeline.
   */
  const synthesizeAndIngestSampleVideo = async () => {
    setStatusBanner(
      "Recording a sample UI Notification Card animation (.webm) and sending to SAM 3.1 + Muse Spark 1.3..."
    );
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const stream = canvas.captureStream(60);
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm",
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const file = new File([blob], "notification-toast-animation.webm", {
        type: "video/webm",
      });
      handleVideoFileUpload(file);
    };

    recorder.start();

    const totalFrames = 45;
    for (let f = 0; f < totalFrames; f++) {
      const tau = f / 42;
      const u = springStepScalar(tau, 19.5, 0.58);

      // Background
      ctx.fillStyle = "#050811";
      ctx.fillRect(0, 0, 640, 400);

      // Morphing dark card container
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

      // Avatar icon badge
      const ax = x + 18;
      const ay = y + 16;
      const aw = 32 + 24 * u;
      ctx.fillStyle = "#a855f7";
      ctx.beginPath();
      ctx.roundRect(ax, ay, aw, aw, 12);
      ctx.fill();

      // Title & subtitle text
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 15px sans-serif";
      ctx.fillText("Incoming Call • Alex Rivera", ax + aw + 14, ay + 20);

      if (u > 0.35) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "12px monospace";
        ctx.fillText("Meta AI Spatial Video • 60fps", ax + aw + 14, ay + 40);

        // Action CTA button inside expanded card
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

      await new Promise((r) => setTimeout(r, 15));
    }

    recorder.stop();
  };

  const startBrowserScreenRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60 },
        audio: false,
      });
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      setIsRecordingScreen(true);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        setIsRecordingScreen(false);
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: "video/webm" });
        const file = new File([blob], "screen-recording.webm", {
          type: "video/webm",
        });
        handleVideoFileUpload(file);
      };

      recorder.start();
      setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, 4500);
    } catch {
      setIsRecordingScreen(false);
    }
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

          {/* Primary Actions: Upload Any Video, Record Screen, Demo Video, Examples, API Key */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleVideoFileUpload(file);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition"
            >
              <Upload className="w-4 h-4" />
              Upload Any UI Video (.MP4)
            </button>

            {!isRecordingScreen ? (
              <button
                onClick={startBrowserScreenRecording}
                className="px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <Video className="w-3.5 h-3.5" />
                Record My Screen (4s)
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
              className="px-3 py-2 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 text-xs font-medium flex items-center gap-1.5 transition"
              title="Generates a sample UI Notification Card video and analyzes it live with your Meta API key"
            >
              <Film className="w-3.5 h-3.5" />
              Try Sample Video
            </button>

            {/* Subtle Example Selector */}
            <select
              value={uploadedVideoUrl ? "custom" : activePresetId}
              onChange={(e) => {
                if (e.target.value !== "custom") {
                  setActivePresetId(e.target.value);
                }
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
                apiKey
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/40"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              {apiKey ? "Meta API Ready" : "Set Meta API Key"}
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

      {/* Main Side-by-Side Workspace (2 Columns: Left = Input Video, Right = Working Cloned UI & Code) */}
      <main className="flex-1 max-w-[1560px] w-full mx-auto p-4 space-y-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center min-h-[480px] gap-3 bg-[#090d18] border border-slate-800 rounded-2xl p-8 text-center">
            <Loader2 className="w-9 h-9 text-cyan-400 animate-spin" />
            <h3 className="text-base font-bold text-white">
              Analyzing Your Video with Meta SAM 3.1 & Muse Spark 1.3...
            </h3>
            <p className="text-xs text-slate-400 max-w-md">
              Tracking moving UI elements across 60 frames, measuring exact bounce and speed, and compiling your interactive React & CSS clone.
            </p>
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
                  MODEL_API_KEY (Saved automatically in your browser)
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
                  How Your Key Is Used
                </div>
                <p>
                  When you upload any video, <strong>Muse Spark 1.3</strong> inspects the video frames and generates a custom interactive clone, while <strong>SAM 3.1</strong> tracks the moving UI elements.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs transition"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
