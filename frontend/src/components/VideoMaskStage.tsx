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
    const vid = videoRef.current;
    if (uploadedVideoUrl && vid) {
      vid.loop = true;
      vid.playbackRate = slowMo ? 0.35 : 1.0;
      if (isPlaying) {
        vid.play().catch(() => {});
      } else {
        vid.pause();
      }

      let rafId = 0;
      const syncFromVideo = () => {
        if (vid && Number.isFinite(vid.duration) && vid.duration > 0 && !vid.paused) {
          const nextFrame = Math.min(
            totalFrames - 1,
            Math.max(0, Math.round((vid.currentTime / vid.duration) * (totalFrames - 1)))
          );
          setCurrentFrame(nextFrame);
        }
        if (isPlaying) {
          rafId = requestAnimationFrame(syncFromVideo);
        }
      };
      if (isPlaying) {
        rafId = requestAnimationFrame(syncFromVideo);
      }
      return () => cancelAnimationFrame(rafId);
    }

    if (!isPlaying) return;
    const intervalMs = slowMo ? 66 : 22;
    const timer = setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % totalFrames);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isPlaying, slowMo, totalFrames, uploadedVideoUrl, setCurrentFrame]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !uploadedVideoUrl || isPlaying) return;
    const duration = vid.duration;
    if (Number.isFinite(duration) && duration > 0) {
      vid.currentTime = (currentFrame / Math.max(1, totalFrames - 1)) * duration;
    }
  }, [currentFrame, totalFrames, uploadedVideoUrl, isPlaying]);

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
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 font-bold text-xs border border-cyan-500/40">
            1
          </span>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              Input Video & SAM 3.1 Tracking
            </h2>
            <p className="text-xs text-slate-400">
              SAM 3.1 outlines every moving UI piece across 60 frames
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
            title="Toggle SAM 3.1 Vector Outlines"
          >
            {showMasks ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            Outlines
          </button>
          <button
            onClick={() => setShowBoxes(!showBoxes)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
              showBoxes
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                : "bg-slate-800/70 text-slate-400 border border-slate-700"
            }`}
            title="Toggle Size Labels"
          >
            <Crosshair className="w-3.5 h-3.5" />
            Labels
          </button>
        </div>
      </div>

      {/* Main 640x400 Synchronized Video + SAM 3.1 SVG Overlay Viewport */}
      <div className="relative flex-1 min-h-[260px] bg-[#050811] flex items-center justify-center overflow-hidden p-3">
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, #1e293b 1px, transparent 1px), linear-gradient(to bottom, #1e293b 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="absolute top-3 left-3 z-20 flex items-center gap-2 bg-slate-950/85 backdrop-blur-md border border-slate-800 px-2.5 py-1 rounded-lg text-[11px] font-mono text-slate-300">
          <span className="text-cyan-400 font-semibold">
            Frame {String(currentFrame).padStart(2, "0")}/{totalFrames - 1}
          </span>
          <span className="text-slate-600">|</span>
          <span>{currentTimestampMs.toFixed(0)} ms</span>
        </div>

        <div className="relative w-full max-w-[520px] aspect-[16/10] rounded-xl overflow-hidden border border-slate-800/90 bg-gradient-to-b from-slate-900/90 to-slate-950 shadow-inner">
          {uploadedVideoUrl && (
            <video
              ref={videoRef}
              src={uploadedVideoUrl}
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-fill opacity-85"
            />
          )}

          <svg
            viewBox="0 0 640 400"
            className="relative z-10 w-full h-full select-none"
          >
            <defs>
              <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3.5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

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

            {analysis.layers.map((layer) => {
              if (hiddenLayers[layer.id]) return null;
              const frame = layer.frames[currentFrame] || layer.frames[0];
              if (!frame) return null;
              const isSelected = layer.id === selectedLayerId;
              if (frame.confidence <= 0.1 && !isSelected) return null;
              const cx = frame.x + frame.width / 2;
              const cy = frame.y + frame.height / 2;

              return (
                <g
                  key={`sam-${layer.id}`}
                  onClick={() => setSelectedLayerId(layer.id)}
                  className="cursor-pointer transition-opacity"
                >
                  {showMasks && (
                    <path
                      d={frame.svg_path}
                      fill={
                        isSelected
                          ? `${layer.colorHex}24`
                          : `${layer.colorHex}10`
                      }
                      stroke={layer.colorHex}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                      strokeDasharray={isSelected ? "none" : "5 3"}
                      filter={isSelected ? "url(#neonGlow)" : undefined}
                    />
                  )}

                  {showBoxes && (
                    <>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isSelected ? 4 : 2.5}
                        fill={layer.colorHex}
                      />
                      <g transform={`translate(${frame.x}, ${Math.max(18, frame.y - 6)})`}>
                        <rect
                          x={0}
                          y={-16}
                          width={Math.min(250, layer.name.length * 7.2 + 64)}
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
                          {layer.name} ({Math.round(frame.width)}×
                          {Math.round(frame.height)}px)
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
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          onClick={() => {
            setIsPlaying(false);
            setCurrentFrame(0);
          }}
          className="p-2 rounded-lg bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 border border-slate-700 transition"
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
          {slowMo ? "Slow-Mo" : "1.0x"}
        </button>
      </div>

      {/* Plain-English Summary & Detected Moving Elements */}
      <div className="p-3.5 bg-[#090d18] border-t border-slate-800/80 space-y-2.5">
        <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800/90">
          <div className="text-xs font-bold text-white flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            {analysis.interactionTitle}
          </div>
          <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
            {analysis.interactionSummary}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-1.5 max-h-[145px] overflow-y-auto pr-1">
          {analysis.layers.map((layer: TrackedLayer) => {
            const isSelected = layer.id === selectedLayerId;
            const isHidden = !!hiddenLayers[layer.id];
            return (
              <div
                key={layer.id}
                onClick={() => setSelectedLayerId(layer.id)}
                className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer border transition ${
                  isSelected
                    ? "bg-slate-800/90 border-cyan-500/60"
                    : "bg-slate-900/50 border-slate-800/80 hover:bg-slate-800/40"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: layer.colorHex }}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-100 truncate">
                      {layer.name}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono truncate">
                      {Math.round(layer.physics.start_state.width)}×
                      {Math.round(layer.physics.start_state.height)}px →{" "}
                      {Math.round(layer.physics.end_state.width)}×
                      {Math.round(layer.physics.end_state.height)}px
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/50 border border-cyan-800/50 px-2 py-0.5 rounded">
                    {layer.physics.settling_duration_ms}ms • {layer.physics.overshoot_pct}% bounce
                  </span>
                  <button
                    onClick={(e) => toggleLayerVisibility(layer.id, e)}
                    className="p-1 text-slate-400 hover:text-slate-200"
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
