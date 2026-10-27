"use client";

import React from "react";
import { Activity, Cpu, Zap, Clock, TrendingUp, CheckCircle2 } from "lucide-react";
import { TrackedLayer } from "@/types/motion";

interface TelemetryPanelProps {
  layer: TrackedLayer;
  currentFrame: number;
  setCurrentFrame: (frame: number) => void;
}

export default function TelemetryPanel({
  layer,
  currentFrame,
  setCurrentFrame,
}: TelemetryPanelProps) {
  const { physics } = layer;
  const series = physics.telemetry_series || [];
  const totalPoints = series.length || 60;

  // SVG Chart dimensions
  const W = 460;
  const H = 152;
  const PAD_X = 32;
  const PAD_Y = 20;
  const plotW = W - PAD_X * 2;
  const plotH = H - PAD_Y * 2;

  // Normalized curve spans roughly [-0.05, 1.25]
  const mapX = (idx: number) =>
    PAD_X + (idx / Math.max(1, totalPoints - 1)) * plotW;
  const mapY = (val: number) => {
    const clamped = Math.max(-0.1, Math.min(1.25, val));
    return PAD_Y + plotH - ((clamped + 0.1) / 1.35) * plotH;
  };

  const fittedPolyline = series
    .map((pt, i) => `${mapX(i).toFixed(1)},${mapY(pt.fittedSpringNormalized).toFixed(1)}`)
    .join(" ");

  // Velocity profile mapping
  const maxVel = Math.max(
    10,
    ...series.map((pt) => Math.abs(pt.velocityPxPerSec))
  );
  const mapVelY = (vel: number) => {
    const norm = (vel + maxVel) / (2 * maxVel);
    return PAD_Y + plotH - norm * plotH;
  };
  const velocityPolyline = series
    .map((pt, i) => `${mapX(i).toFixed(1)},${mapVelY(pt.velocityPxPerSec).toFixed(1)}`)
    .join(" ");

  const playheadX = mapX(Math.min(currentFrame, totalPoints - 1));
  const currentPoint = series[currentFrame] || series[0];

  return (
    <div className="flex flex-col h-full bg-[#090d18] border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-[#0c1222]">
        <div className="flex items-center gap-2.5">
          <Cpu className="w-4 h-4 text-purple-400" />
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Stage 3 • Inverse Kinematics & Spring Solver
            </h2>
            <p className="text-[11px] text-slate-400">
              SciPy Levenberg-Marquardt Harmonic Fit on{" "}
              <span className="text-cyan-300 font-medium">{layer.name}</span>
            </p>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" />
          R² = {(physics.r_squared * 100).toFixed(2)}%
        </span>
      </div>

      <div className="p-3.5 space-y-3.5 flex-1 overflow-y-auto">
        {/* Governing Differential Equation Banner */}
        <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90 flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
            <span>Recovered Governing Differential Equation</span>
            <span className="text-purple-400 font-mono">
              axis: {physics.dominant_axis}
            </span>
          </div>
          <div className="font-mono text-xs text-cyan-200 tracking-tight overflow-x-auto py-0.5">
            u&apos;&apos;(t) + 2({physics.damping_ratio})({physics.natural_freq_rad}
            )u&apos;(t) + ({physics.natural_freq_rad})²(u(t) - 1) = 0
          </div>
        </div>

        {/* 6 Physics Telemetry Cards */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Zap className="w-3 h-3 text-cyan-400" /> Stiffness (k)
            </div>
            <div className="text-lg font-bold font-mono text-white mt-0.5">
              {physics.stiffness}
              <span className="text-[11px] font-normal text-slate-400 ml-1">
                N/m
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Activity className="w-3 h-3 text-purple-400" /> Damping (c)
            </div>
            <div className="text-lg font-bold font-mono text-white mt-0.5">
              {physics.damping}
              <span className="text-[11px] font-normal text-slate-400 ml-1">
                Ns/m
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-amber-400" /> Overshoot
            </div>
            <div className="text-lg font-bold font-mono text-amber-300 mt-0.5">
              {physics.overshoot_pct}%
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">
              Damping Ratio (ζ)
            </div>
            <div className="text-sm font-bold font-mono text-slate-200 mt-0.5">
              {physics.damping_ratio}{" "}
              <span className="text-[10px] text-cyan-400 font-normal">
                ({physics.damping_ratio < 1 ? "Underdamped" : "Critically Damped"})
              </span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Clock className="w-3 h-3 text-emerald-400" /> Stagger (Δt)
            </div>
            <div className="text-sm font-bold font-mono text-emerald-300 mt-0.5">
              +{physics.stagger_delay_ms} ms
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">
              Settling Time
            </div>
            <div className="text-sm font-bold font-mono text-slate-200 mt-0.5">
              {physics.settling_duration_ms} ms
            </div>
          </div>
        </div>

        {/* Chart 1: SAM 3.1 Empirical Points vs Fitted Spring Curve */}
        <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-slate-200">
              Normalized Displacement u(t): SAM 3.1 Masks vs. SciPy Fit
            </span>
            <div className="flex items-center gap-3 text-[10px] font-mono">
              <span className="flex items-center gap-1 text-cyan-300">
                <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" />
                SAM 3.1 Empirical
              </span>
              <span className="flex items-center gap-1 text-purple-300">
                <span className="w-3 h-0.5 bg-purple-400 inline-block" />
                Harmonic Fit
              </span>
            </div>
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-[145px] overflow-visible cursor-crosshair"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = e.clientX - rect.left;
              const ratio = Math.max(0, Math.min(1, relX / rect.width));
              setCurrentFrame(Math.round(ratio * (totalPoints - 1)));
            }}
          >
            {/* Reference lines u=0 and u=1.0 */}
            <line
              x1={PAD_X}
              y1={mapY(0)}
              x2={W - PAD_X}
              y2={mapY(0)}
              stroke="#1e293b"
              strokeWidth={1}
            />
            <line
              x1={PAD_X}
              y1={mapY(1.0)}
              x2={W - PAD_X}
              y2={mapY(1.0)}
              stroke="#334155"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
            <text
              x={4}
              y={mapY(1.0) + 3}
              fill="#64748b"
              fontSize="9"
              fontFamily="monospace"
            >
              1.0
            </text>
            <text
              x={4}
              y={mapY(0.0) + 3}
              fill="#64748b"
              fontSize="9"
              fontFamily="monospace"
            >
              0.0
            </text>

            {/* Analytical SciPy Spring Curve */}
            <polyline
              fill="none"
              stroke="#a855f7"
              strokeWidth={2.4}
              points={fittedPolyline}
            />

            {/* SAM 3.1 Empirical Frame Observations (every 2nd frame for clarity) */}
            {series.map((pt, i) =>
              i % 2 === 0 ? (
                <circle
                  key={i}
                  cx={mapX(i)}
                  cy={mapY(pt.empiricalNormalized)}
                  r={i === currentFrame ? 4.5 : 2.2}
                  fill={i === currentFrame ? "#22d3ee" : "#06b6d4"}
                  opacity={i === currentFrame ? 1 : 0.75}
                />
              ) : null
            )}

            {/* Synchronized Playhead */}
            <line
              x1={playheadX}
              y1={PAD_Y - 6}
              x2={playheadX}
              y2={H - PAD_Y + 6}
              stroke="#22d3ee"
              strokeWidth={1.5}
            />
          </svg>

          {currentPoint && (
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-900">
              <span>
                Frame {currentFrame}: u_sam ={" "}
                <strong className="text-cyan-300">
                  {currentPoint.empiricalNormalized.toFixed(3)}
                </strong>
              </span>
              <span>
                u_fit ={" "}
                <strong className="text-purple-300">
                  {currentPoint.fittedSpringNormalized.toFixed(3)}
                </strong>
              </span>
              <span>
                residual ={" "}
                <strong className="text-emerald-300">
                  {Math.abs(
                    currentPoint.empiricalNormalized -
                      currentPoint.fittedSpringNormalized
                  ).toFixed(4)}
                </strong>
              </span>
            </div>
          )}
        </div>

        {/* Chart 2: Instantaneous Velocity Profile v(t) */}
        <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/90">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold text-slate-200">
              Instantaneous Velocity Profile v(t) & Stagger Onset
            </span>
            <span className="text-[10px] font-mono text-emerald-400">
              v = {currentPoint?.velocityPxPerSec.toFixed(0)} px/s
            </span>
          </div>

          <svg viewBox={`0 0 ${W} 96`} className="w-full h-[86px] overflow-visible">
            <line
              x1={PAD_X}
              y1={mapVelY(0)}
              x2={W - PAD_X}
              y2={mapVelY(0)}
              stroke="#1e293b"
              strokeWidth={1}
            />
            <polyline
              fill="none"
              stroke="#10b981"
              strokeWidth={2}
              points={velocityPolyline}
            />
            <line
              x1={playheadX}
              y1={8}
              x2={playheadX}
              y2={88}
              stroke="#22d3ee"
              strokeWidth={1.5}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
