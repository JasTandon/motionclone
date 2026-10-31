/**
 * Inverse spring identification.
 *
 * Model: unit-step response of the damped harmonic oscillator
 *   u''(t) + 2ζω₀u'(t) + ω₀²(u(t) − 1) = 0,  u(0) = 0, u'(0) = 0,
 * delayed by an onset t₀. Parameters p = [ω₀, ζ, t₀] are recovered from measured
 * (t, u) samples by a coarse grid search followed by Levenberg–Marquardt refinement.
 */
import { springStepScalar } from "./localPhysicsEngine";

export interface ProgressSample {
  tMs: number;
  u: number;
}

export interface SpringFit {
  omega0: number;
  zeta: number;
  onsetMs: number;
  stiffness: number;
  damping: number;
  rSquared: number;
  rmse: number;
  iterations: number;
  samples: number;
}

const BOUNDS = {
  omega0: [2, 60] as const,
  zeta: [0.08, 2.5] as const,
};

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function springModel(tMs: number, omega0: number, zeta: number, onsetMs: number) {
  return springStepScalar(Math.max(0, (tMs - onsetMs) / 1000), omega0, zeta);
}

function sse(samples: ProgressSample[], p: number[]) {
  let s = 0;
  for (const pt of samples) {
    const r = pt.u - springModel(pt.tMs, p[0], p[1], p[2]);
    s += r * r;
  }
  return s;
}

function solve3(A: number[][], b: number[]): number[] | null {
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** Fits ω₀, ζ and onset to normalized progress samples (u: 0 = start state, 1 = rest state). */
export function fitSpring(
  samplesIn: ProgressSample[],
  init?: { omega0: number; zeta: number; onsetMs: number }
): SpringFit {
  const samples = samplesIn.filter((s) => Number.isFinite(s.tMs) && Number.isFinite(s.u));
  const tMax = Math.max(1, ...samples.map((s) => s.tMs));
  const onsetHi = tMax * 0.8;
  const project = (p: number[]) => [
    clamp(p[0], BOUNDS.omega0[0], BOUNDS.omega0[1]),
    clamp(p[1], BOUNDS.zeta[0], BOUNDS.zeta[1]),
    clamp(p[2], 0, onsetHi),
  ];

  let best = init ? project([init.omega0, init.zeta, init.onsetMs]) : [18, 0.6, 0];
  let bestErr = samples.length ? sse(samples, best) : 0;

  if (samples.length >= 3) {
    // Coarse grid: ω₀ log-spaced, ζ linear, onset across the first 70% of the clip.
    for (let i = 0; i < 18; i++) {
      const w = 3 * Math.pow(50 / 3, i / 17);
      for (let j = 0; j < 16; j++) {
        const z = 0.1 + (1.9 * j) / 15;
        for (let k = 0; k < 14; k++) {
          const p = [w, z, (tMax * 0.7 * k) / 13];
          const e = sse(samples, p);
          if (e < bestErr) {
            bestErr = e;
            best = p;
          }
        }
      }
    }
  }

  // Levenberg–Marquardt with a central-difference Jacobian.
  let lambda = 1e-2;
  let iterations = 0;
  const steps = [1e-3, 1e-4, Math.max(1e-2, tMax * 1e-4)];
  for (; iterations < 60 && samples.length >= 3; iterations++) {
    const JtJ = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const Jtr = [0, 0, 0];
    for (const pt of samples) {
      const r = pt.u - springModel(pt.tMs, best[0], best[1], best[2]);
      const J = [0, 1, 2].map((d) => {
        const h = steps[d] * Math.max(1, Math.abs(best[d]));
        const hi = [...best];
        const lo = [...best];
        hi[d] += h;
        lo[d] -= h;
        return (
          (springModel(pt.tMs, hi[0], hi[1], hi[2]) - springModel(pt.tMs, lo[0], lo[1], lo[2])) /
          (2 * h)
        );
      });
      for (let a = 0; a < 3; a++) {
        Jtr[a] += J[a] * r;
        for (let b = 0; b < 3; b++) JtJ[a][b] += J[a] * J[b];
      }
    }
    const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v + lambda * (v || 1e-9) : v)));
    const delta = solve3(A, Jtr);
    if (!delta) break;
    const candidate = project(best.map((v, d) => v + delta[d]));
    const candErr = sse(samples, candidate);
    if (candErr < bestErr) {
      const improvement = bestErr - candErr;
      best = candidate;
      bestErr = candErr;
      lambda = Math.max(1e-7, lambda / 3);
      if (improvement < 1e-10) break;
    } else {
      lambda *= 4;
      if (lambda > 1e6) break;
    }
  }

  const mean = samples.reduce((a, s) => a + s.u, 0) / Math.max(1, samples.length);
  const ssTot = samples.reduce((a, s) => a + (s.u - mean) ** 2, 0);
  const rSquared = ssTot > 1e-9 ? 1 - bestErr / ssTot : 0;
  const [omega0, zeta, onsetMs] = best;
  return {
    omega0: Number(omega0.toFixed(3)),
    zeta: Number(zeta.toFixed(3)),
    onsetMs: Number(onsetMs.toFixed(1)),
    stiffness: Number((omega0 * omega0).toFixed(1)),
    damping: Number((2 * zeta * omega0).toFixed(2)),
    rSquared: Number(clamp(rSquared, 0, 1).toFixed(4)),
    rmse: Number(Math.sqrt(bestErr / Math.max(1, samples.length)).toFixed(4)),
    iterations,
    samples: samples.length,
  };
}

/** k, c, m → ω₀ = √(k/m), ζ = c / (2√(km)). */
export function springFromKC(stiffness: number, damping: number, mass = 1) {
  const k = Math.max(1e-3, stiffness);
  const m = Math.max(1e-3, mass);
  return { omega0: Math.sqrt(k / m), zeta: damping / (2 * Math.sqrt(k * m)) };
}

export function overshootPct(zeta: number) {
  return zeta < 1 ? Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)) * 100 : 0;
}

/** 2% settling time of the step response, in ms. */
export function settlingMs(omega0: number, zeta: number) {
  return Math.round((4 / Math.max(0.05, Math.min(zeta, 1) * omega0)) * 1000);
}

/**
 * Converts a 1D trajectory (displacement from its first visible state) into normalized
 * progress for the first transition: u = 0 at the start state, u = 1 at the rest state.
 * Clips that return to the start (expand → collapse) are windowed to the outbound move.
 */
export function normalizeTransition(raw: ProgressSample[]): ProgressSample[] {
  if (raw.length < 3) return [];
  const peakIdx = raw.reduce((bi, s, i) => (s.u > raw[bi].u ? i : bi), 0);
  const peak = raw[peakIdx].u;
  if (!(peak > 1e-6)) return [];
  let end = raw.length - 1;
  for (let i = peakIdx + 1; i < raw.length; i++) {
    if (raw[i].u < peak * 0.5) {
      end = i - 1;
      break;
    }
  }
  const plateau = raw.slice(peakIdx, end + 1).map((s) => s.u).sort((a, b) => a - b);
  const settled = end === raw.length - 1 && end > peakIdx ? raw[end].u : plateau[Math.floor(plateau.length / 2)];
  const target = Math.max(settled, peak * 0.5);
  return raw.slice(0, end + 1).map((s) => ({ tMs: s.tMs, u: s.u / target }));
}
