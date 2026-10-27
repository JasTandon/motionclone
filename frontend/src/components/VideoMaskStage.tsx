"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Eye,
  EyeOff,
  Crosshair,
  Sparkles,
  Gauge,
} from "lucide-react";
import { AnalysisPayload, TrackedLayer } from "@/types/motion";

interface VideoMaskStageProps {
  analysis: AnalysisPayload;
  currentFrame: number;
  setCurrentFrame: React.Dispatch<React.SetStateAction<number>>;
  selectedLayerId: string;
  setSelectedLayerId: (id: string) => void;
  uploadedVideoUrl: string | null;
}

export default function VideoMaskStage({
  analysis,
  currentFrame,
  setCurrentFrame,
  selectedLayerId,
  setSelectedLayerId,
  uploadedVideoUrl,
}: VideoMaskStageProps) {
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [slowMo, setSlowMo] = useState<boolean>(false);
  const [showMasks, setShowMasks] = useState<boolean>(true);
  const [showBoxes, setShowBoxes] = useState<boolean>(true);
  const [hiddenLayers, setHiddenLayers] = useState<Record<string, boolean>>({});
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const totalFrames = analysis.layers[0]?.frames.length || 60;

  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = slowMo ? 66 : 22;
    const timer = setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % totalFrames);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isPlaying, slowMo, totalFrames, setCurrentFrame]);

  // Keep uploaded <video> frame-locked with the SAM 3.1 SVG mask overlay
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !uploadedVideoUrl) return;
    const duration = vid.duration;
    if (Number.isFinite(duration) && duration > 0) {
      const targetTime = (currentFrame / Math.max(1, totalFrames - 1)) * duration;
      if (Math.abs(vid.currentTime - targetTime) > 0.03) {
        vid.currentTime = targetTime;
      }
    }
  }, [currentFrame, totalFrames, uploadedVideoUrl]);

  const toggleLayerVisibility = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHiddenLayers((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const currentTimestampMs =
    analysis.layers[0]?.frames[currentFrame]?.timestamp_ms ||
    Math.round((currentFrame / 60) * 1000);

  return (
    <div className="flex flex-col h-full bg-[#090d18] border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl">
      {/* Stage Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-[#0c1222]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse" />
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              Stage 1 & 2 • SAM 3.1 Video Concept Tracker
            </h2>
            <p className="text-[11px] text-slate-400">
              60fps Promptable Concept Segmentation (`sam-3.1` + `meta_sam_parser`)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowMasks(!showMasks)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
              showMasks
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                : "bg-slate-800/70 text-slate-400 border border-slate-700"
            }`}
            title="Toggle SAM 3.1 Vector Masks"
          >
            {showMasks ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            Masks
          </button>
          <button
            onClick={() => setShowBoxes(!showBoxes)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
              showBoxes
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                : "bg-slate-800/70 text-slate-400 border border-slate-700"
            }`}
            title="Toggle Centroids & BBoxes"
          >
            <Crosshair className="w-3.5 h-3.5" />
            BBox
          </button>
        </div>
      </div>

      {/* Main 640x400 Synchronized Video + SAM 3.1 SVG Overlay Viewport */}
      <div className="relative flex-1 min-h-[290px] bg-[#050811] flex items-center justify-center overflow-hidden p-3">
        {/* Subtle calibration grid */}
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, #1e293b 1px, transparent 1px), linear-gradient(to bottom, #1e293b 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        {/* Top-left HUD telemetry badge */}
        <div className="absolute top-3 left-3 z-20 flex items-center gap-2 bg-slate-950/85 backdrop-blur-md border border-slate-800 px-2.5 py-1 rounded-lg text-[11px] font-mono text-slate-300">
          <span className="text-cyan-400 font-semibold">
            FRAME {String(currentFrame).padStart(2, "0")}/{totalFrames - 1}
          </span>
          <span className="text-slate-600">|</span>
          <span>t = {currentTimestampMs.toFixed(0)} ms</span>
          <span className="text-slate-600">|</span>
          <span className="text-emerald-400">{slowMo ? "0.25x SLOW-MO" : "60 FPS"}</span>
        </div>

        {/* Underlying video or rendered source frame */}
        <div className="relative w-full max-w-[540px] aspect-[16/10] rounded-xl overflow-hidden border border-slate-800/90 bg-gradient-to-b from-slate-900/90 to-slate-950 shadow-inner">
          {uploadedVideoUrl && (
            <video
              ref={videoRef}
              src={uploadedVideoUrl}
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-fill opacity-75"
            />
          )}

          {/* Vector SVG Stage rendering both underlying UI motion & SAM 3.1 segmentation masks */}
          <svg
            viewBox="0 0 640 400"
            className="relative z-10 w-full h-full select-none"
          >
            <defs>
              <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Base simulated UI layers when viewing built-in presets */}
            {!uploadedVideoUrl &&
              analysis.layers.map((layer, idx) => {
                const frame = layer.frames[currentFrame] || layer.frames[0];
                if (!frame) return null;
                const isContainer = idx === 0;
                return (
                  <g key={`base-${layer.id}`}>
                    <path
                      d={frame.svg_path}
                      fill={isContainer ? "#080b12" : `${layer.colorHex}26`}
                      stroke={isContainer ? "#1e293b" : "none"}
                      strokeWidth={1.5}
                    />
                  </g>
                );
              })}

            {/* SAM 3.1 Promptable Concept Segmentation Masks & Centroid Tracking */}
            {analysis.layers.map((layer) => {
              if (hiddenLayers[layer.id]) return null;
              const frame = layer.frames[currentFrame] || layer.frames[0];
              if (!frame) return null;
              const isSelected = layer.id === selectedLayerId;
              const cx = frame.x + frame.width / 2;
              const cy = frame.y + frame.height / 2;

              return (
                <g
                  key={`sam-${layer.id}`}
                  onClick={() => setSelectedLayerId(layer.id)}
                  className="cursor-pointer transition-opacity"
                >
                  {/* SAM 3.1 Decoded SVG Mask Path */}
                  {showMasks && (
                    <path
                      d={frame.svg_path}
                      fill={
                        isSelected
                          ? `${layer.colorHex}38`
                          : `${layer.colorHex}18`
                      }
                      stroke={layer.colorHex}
                      strokeWidth={isSelected ? 2.6 : 1.5}
                      strokeDasharray={isSelected ? "none" : "5 3"}
                      filter={isSelected ? "url(#neonGlow)" : undefined}
                    />
                  )}

                  {/* Bounding Box & Centroid Callout */}
                  {showBoxes && (
                    <>
                      <rect
                        x={frame.x}
                        y={frame.y}
                        width={frame.width}
                        height={frame.height}
                        fill="none"
                        stroke={layer.colorHex}
                        strokeOpacity={isSelected ? 0.9 : 0.4}
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                      {/* Centroid target */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isSelected ? 4.5 : 3}
                        fill={layer.colorHex}
                      />
                      <line
                        x1={cx - 8}
                        y1={cy}
                        x2={cx + 8}
                        y2={cy}
                        stroke={layer.colorHex}
                        strokeWidth={1.2}
                      />
                      <line
                        x1={cx}
                        y1={cy - 8}
                        x2={cx}
                        y2={cy + 8}
                        stroke={layer.colorHex}
                        strokeWidth={1.2}
                      />

                      {/* Floating SAM 3.1 Concept Tag */}
                      <g transform={`translate(${frame.x}, ${Math.max(18, frame.y - 8)})`}>
                        <rect
                          x={0}
                          y={-16}
                          width={Math.min(250, layer.samPrompt.length * 7.2 + 58)}
                          height={18}
                          rx={4}
                          fill="#050811"
                          fillOpacity={0.9}
                          stroke={layer.colorHex}
                          strokeWidth={1}
                        />
                        <text
                          x={6}
                          y={-4}
                          fill={layer.colorHex}
                          fontSize="10"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          &quot;{layer.samPrompt}&quot; ({Math.round(frame.width)}×
                          {Math.round(frame.height)})
                        </text>
                      </g>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Scrubber & Playback Controls */}
      <div className="px-4 py-2.5 bg-[#0b101d] border-t border-slate-800/80 flex items-center gap-3">
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="p-2 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30 transition"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          onClick={() => {
            setIsPlaying(false);
            setCurrentFrame(0);
          }}
          className="p-2 rounded-lg bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 border border-slate-700 transition"
          title="Reset to Frame 0"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <input
          type="range"
          min={0}
          max={totalFrames - 1}
          value={currentFrame}
          onChange={(e) => {
            setIsPlaying(false);
            setCurrentFrame(Number(e.target.value));
          }}
          className="flex-1 accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
        />

        <button
          onClick={() => setSlowMo(!slowMo)}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center gap-1 border transition ${
            slowMo
              ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
              : "bg-slate-800/70 text-slate-400 border border-slate-700"
          }`}
        >
          <Gauge className="w-3.5 h-3.5" />
          {slowMo ? "0.25x" : "1.0x"}
        </button>
      </div>

      {/* Discovered SAM 3.1 Concept Layers List */}
      <div className="p-3 bg-[#090d18] border-t border-slate-800/80">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            Muse Spark 1.3 Auto-Discovered Concept Prompts
          </span>
          <span className="text-[11px] text-slate-500 font-mono">
            Click layer to inspect physics
          </span>
        </div>

        <div className="grid grid-cols-1 gap-1.5 max-h-[155px] overflow-y-auto pr-1">
          {analysis.layers.map((layer: TrackedLayer) => {
            const isSelected = layer.id === selectedLayerId;
            const isHidden = !!hiddenLayers[layer.id];
            return (
              <div
                key={layer.id}
                onClick={() => setSelectedLayerId(layer.id)}
                className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer border transition ${
                  isSelected
                    ? "bg-slate-800/90 border-cyan-500/60 shadow-md"
                    : "bg-slate-900/50 border-slate-800/80 hover:bg-slate-800/40"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{
                      backgroundColor: layer.colorHex,
                      boxShadow: isSelected ? `0 0 10px ${layer.colorHex}` : "none",
                    }}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-100 truncate flex items-center gap-2">
                      {layer.name}
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                        &quot;{layer.samPrompt}&quot;
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/50 border border-cyan-800/50 px-2 py-0.5 rounded">
                    k={layer.physics.stiffness} • c={layer.physics.damping}
                  </span>
                  <button
                    onClick={(e) => toggleLayerVisibility(layer.id, e)}
                    className="p-1 text-slate-400 hover:text-slate-200"
                    title="Toggle layer mask visibility"
                  >
                    {isHidden ? (
                      <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
