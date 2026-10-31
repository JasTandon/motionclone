"use client";

import React from "react";
import { Activity, Cpu, Zap, Clock, TrendingUp, CheckCircle2 } from "lucide-react";
import { TrackedLayer } from "@/types/motion";
import { springModel } from "@/lib/springFit";

interface TelemetryPanelProps {
  layer: TrackedLayer;
  currentFrame: number;
  setCurrentFrame: (frame: number) => void;
  /** Playhead time in ms (from the stage's frame clock). */
  timeMs: number;
}

export default function TelemetryPanel({
  layer,
  currentFrame,
  setCurrentFrame,
  timeMs,
}: TelemetryPanelProps) {
  const { physics } = layer;
  const series = physics.telemetry_series || [];
  const frameCount = layer.frames.length || 60;
  const tEnd = Math.max(
    1,
    layer.frames[frameCount - 1]?.timestamp_ms ?? 0,
    ...series.map((p) => p.timeMs)
  );

  // SVG chart dimensions
  const W = 460;
  const H = 152;
  const VH = 96;
  const PAD_X = 32;
  const PAD_Y = 20;
  const VPAD_Y = 10;
  const plotW = W - PAD_X * 2;
  const plotH = H - PAD_Y * 2;

  const mapT = (t: number) => PAD_X + (Math.max(0, Math.min(tEnd, t)) / tEnd) * plotW;
  const mapY = (val: number) => {
    const clamped = Math.max(-0.1, Math.min(1.25, val));
    return PAD_Y + plotH - ((clamped + 0.1) / 1.35) * plotH;
  };

  // Dense analytic curve of the fitted oscillator (not just the sample points).
  const dense = Array.from({ length: 121 }, (_, i) => {
    const t = (i / 120) * tEnd;
    const u = springModel(t, physics.natural_freq_rad, physics.damping_ratio, physics.stagger_delay_ms);
    const du = (springModel(t + 4, physics.natural_freq_rad, physics.damping_ratio, physics.stagger_delay_ms) - u) / 0.004;
    return { t, u, du };
  });
  const fittedPolyline = dense.map((p) => `${mapT(p.t).toFixed(1)},${mapY(p.u).toFixed(1)}`).join(" ");

  // Velocity of the fitted spring along the dominant axis, px/s.
  const span = Math.max(
    20,
    Math.hypot(
      physics.end_state.x - physics.start_state.x,
      physics.end_state.y - physics.start_state.y,
      physics.end_state.width - physics.start_state.width,
      physics.end_state.height - physics.start_state.height
    )
  );
  const maxVel = Math.max(10, ...dense.map((p) => Math.abs(p.du * span)));
  const mapVelY = (vel: number) => VPAD_Y + (VH - 2 * VPAD_Y) * (1 - (vel + maxVel) / (2 * maxVel));
  const velocityPolyline = dense.map((p) => `${mapT(p.t).toFixed(1)},${mapVelY(p.du * span).toFixed(1)}`).join(" ");

  const playheadX = mapT(timeMs);
  const currentPoint = series.length
    ? series.reduce((a, p) => (Math.abs(p.timeMs - timeMs) < Math.abs(a.timeMs - timeMs) ? p : a), series[0])
    : undefined;
  const velNow =
    (springModel(timeMs + 4, physics.natural_freq_rad, physics.damping_ratio, physics.stagger_delay_ms) -
      springModel(timeMs, physics.natural_freq_rad, physics.damping_ratio, physics.stagger_delay_ms)) /
    0.004 *
    span;

  return (
    <div className="flex flex-col h-full bg-[#090d18] border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-[#0c1222]">
        <div className="flex items-center gap-2.5">
          <Cpu className="w-4 h-4 text-purple-400" />
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Inverse Spring Identification
            </h2>
            <p className="text-[11px] text-slate-400">
              Levenberg–Marquardt fit of ω₀, ζ, t₀ on{" "}
              <span className="text-cyan-300 font-medium">{layer.name}</span>
              {layer.fitSource && <span className="text-slate-500"> · {layer.fitSource}</span>}
            </p>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {physics.r_squared > 0 ? `R² = ${(physics.r_squared * 100).toFixed(2)}%` : "R² n/a (static)"}
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
                ({physics.damping_ratio < 0.98 ? "Underdamped" : physics.damping_ratio <= 1.02 ? "Critically damped" : "Overdamped"})
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
              Normalized progress u(t): measured keyframes vs. fitted oscillator
            </span>
            <div className="flex items-center gap-3 text-[10px] font-mono">
              <span className="flex items-center gap-1 text-cyan-300">
                <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" />
                Measured
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
              setCurrentFrame(Math.round(ratio * (frameCount - 1)));
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

            {/* Measured samples (every 2nd point when dense) */}
            {series.map((pt, i) =>
              series.length <= 30 || i % 2 === 0 ? (
                <circle
                  key={i}
                  cx={mapT(pt.timeMs)}
                  cy={mapY(pt.empiricalNormalized)}
                  r={pt === currentPoint ? 4.5 : 2.6}
                  fill={pt === currentPoint ? "#22d3ee" : "#06b6d4"}
                  opacity={pt === currentPoint ? 1 : 0.8}
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
                t={Math.round(currentPoint.timeMs)}ms: u_measured ={" "}
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
              v = {velNow.toFixed(0)} px/s
            </span>
          </div>

          <svg viewBox={`0 0 ${W} ${VH}`} className="w-full h-[86px]">
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
              y1={4}
              x2={playheadX}
              y2={VH - 4}
              stroke="#22d3ee"
              strokeWidth={1.5}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
