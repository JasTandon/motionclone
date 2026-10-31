/**
 * Deterministic code exporters. Every number comes from the fitted (or user-tuned)
 * spring constants, so moving a slider or applying Auto-Fix changes the exported code.
 */
import { TrackedLayer } from "@/types/motion";
import { springFromKC, settlingMs } from "./springFit";
import { springStepScalar } from "./localPhysicsEngine";

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
}

export type SpringOverrides = Record<string, SpringParams>;

export function springFor(layer: TrackedLayer, overrides: SpringOverrides): SpringParams {
  return (
    overrides[layer.id] ?? {
      stiffness: layer.physics.stiffness,
      damping: layer.physics.damping,
      mass: layer.physics.mass,
    }
  );
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const ident = (name: string, i: number) => {
  const base = name.replace(/^phase[^:]*:\s*/i, "").replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""));
  const id = base.charAt(0).toLowerCase() + base.slice(1);
  return /^[a-z]/.test(id) ? id.slice(0, 32) : `layer${i + 1}`;
};

/** CSS `linear()` easing sampled from the analytic step response (captures overshoot). */
export function cssLinearEasing(p: SpringParams, points = 40) {
  const { omega0, zeta } = springFromKC(p.stiffness, p.damping, p.mass);
  const durationMs = Math.min(4000, Math.max(200, settlingMs(omega0, zeta)));
  const stops: string[] = [];
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * (durationMs / 1000);
    stops.push(i === points ? "1" : String(Number(springStepScalar(t, omega0, zeta).toFixed(4))));
  }
  return { easing: `linear(${stops.join(", ")})`, durationMs };
}

export function buildSwiftUICode(title: string, layers: TrackedLayer[], overrides: SpringOverrides, bgHex = "#000000") {
  const springs = layers
    .map((l, i) => {
      const p = springFor(l, overrides);
      const { omega0, zeta } = springFromKC(p.stiffness, p.damping, p.mass);
      return `    // ${l.name}: ω₀=${omega0.toFixed(2)} rad/s, ζ=${zeta.toFixed(3)}, response=${((2 * Math.PI) / omega0).toFixed(3)}s
    static let ${ident(l.name, i)} = Animation.interpolatingSpring(mass: ${r1(p.mass)}, stiffness: ${r1(p.stiffness)}, damping: ${r1(p.damping)})${l.physics.stagger_delay_ms > 0 ? `.delay(${(l.physics.stagger_delay_ms / 1000).toFixed(3)})` : ""}`;
    })
    .join("\n");
  const views = layers
    .map((l, i) => {
      const s = l.physics.start_state;
      const e = l.physics.end_state;
      return `            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(hex: "${l.colorHex}"))
                .frame(width: isActive ? ${Math.round(e.width)} : ${Math.round(s.width)}, height: isActive ? ${Math.round(e.height)} : ${Math.round(s.height)})
                .offset(x: isActive ? ${Math.round(e.x + e.width / 2 - 320)} : ${Math.round(s.x + s.width / 2 - 320)}, y: isActive ? ${Math.round(e.y + e.height / 2 - 200)} : ${Math.round(s.y + s.height / 2 - 200)})
                .animation(MotionCloneSprings.${ident(l.name, i)}, value: isActive)`;
    })
    .join("\n");
  return `import SwiftUI

// Compiled by MotionClone — ${title}
// Spring constants fitted to SAM 3.1 / Muse Spark 1.3 keyframe tracks (Levenberg–Marquardt).
enum MotionCloneSprings {
${springs}
}

struct ClonedMotionView: View {
    @State private var isActive = false

    var body: some View {
        ZStack {
            Color(hex: "${bgHex}").ignoresSafeArea()
${views}
        }
        .frame(width: 640, height: 400)
        .contentShape(Rectangle())
        .onTapGesture { isActive.toggle() }
    }
}

extension Color {
    init(hex: String) {
        let v = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}`;
}

export function buildCssCode(title: string, layers: TrackedLayer[], overrides: SpringOverrides) {
  const blocks = layers
    .map((l, i) => {
      const p = springFor(l, overrides);
      const { easing, durationMs } = cssLinearEasing(p);
      const s = l.physics.start_state;
      const e = l.physics.end_state;
      const cls = `mc-${ident(l.name, i).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      return `/* ${l.name} — k=${r1(p.stiffness)}, c=${r1(p.damping)}, m=${r1(p.mass)} */
.${cls} {
  --mc-easing: ${easing};
  position: absolute;
  left: ${Math.round(s.x)}px; top: ${Math.round(s.y)}px;
  width: ${Math.round(s.width)}px; height: ${Math.round(s.height)}px;
  background: ${l.colorHex};
  border-radius: 18px;
  transition-property: left, top, width, height;
  transition-duration: ${durationMs}ms;
  transition-delay: ${Math.round(l.physics.stagger_delay_ms)}ms;
  transition-timing-function: var(--mc-easing);
}
.mc-stage.is-active .${cls} {
  left: ${Math.round(e.x)}px; top: ${Math.round(e.y)}px;
  width: ${Math.round(e.width)}px; height: ${Math.round(e.height)}px;
}`;
    })
    .join("\n\n");
  return `/* Compiled by MotionClone — ${title}
 * Easing is the exact damped-oscillator step response sampled into CSS linear(),
 * so overshoot and ringing survive (cubic-bezier cannot express oscillation). */
.mc-stage { position: relative; width: 640px; height: 400px; overflow: hidden; }

${blocks}`;
}

export function buildReactFallbackCode(title: string, layers: TrackedLayer[], overrides: SpringOverrides) {
  const config = layers
    .map((l, i) => {
      const p = springFor(l, overrides);
      return `  ${ident(l.name, i)}: { type: "spring" as const, stiffness: ${r1(p.stiffness)}, damping: ${r1(p.damping)}, mass: ${r1(p.mass)}, delay: ${(l.physics.stagger_delay_ms / 1000).toFixed(3)} },`;
    })
    .join("\n");
  const els = layers
    .map((l, i) => {
      const s = l.physics.start_state;
      const e = l.physics.end_state;
      return `      <motion.div
        initial={false}
        animate={active
          ? { left: ${Math.round(e.x)}, top: ${Math.round(e.y)}, width: ${Math.round(e.width)}, height: ${Math.round(e.height)} }
          : { left: ${Math.round(s.x)}, top: ${Math.round(s.y)}, width: ${Math.round(s.width)}, height: ${Math.round(s.height)} }}
        transition={SPRING_CONFIG.${ident(l.name, i)}}
        style={{ position: "absolute", borderRadius: 18, background: "${l.colorHex}" }}
      />`;
    })
    .join("\n");
  return `import React, { useState } from "react";
import { motion } from "framer-motion";

// Compiled by MotionClone — ${title}
// Spring constants fitted to measured keyframe tracks (SAM 3.1 + Muse Spark 1.3).
export const SPRING_CONFIG = {
${config}
};

export default function ClonedMotionComponent() {
  const [active, setActive] = useState(false);
  return (
    <div onClick={() => setActive((a) => !a)} style={{ position: "relative", width: 640, height: 400, overflow: "hidden" }}>
${els}
    </div>
  );
}`;
}

/**
 * Rewrites the spring constants Muse Spark emitted for a layer (it is instructed to use
 * the fitted k/c verbatim) to the user's live values.
 */
export function patchReactSprings(code: string, layers: TrackedLayer[], overrides: SpringOverrides) {
  let out = code;
  for (const l of layers) {
    const o = overrides[l.id];
    if (!o) continue;
    const k = l.physics.stiffness;
    const c = l.physics.damping;
    const re = new RegExp(
      `stiffness(\\s*[:=]\\s*\\{?\\s*)${String(k).replace(".", "\\.")}(\\b[^\\n]{0,80}?damping\\s*[:=]\\s*\\{?\\s*)${String(c).replace(".", "\\.")}\\b`,
      "g"
    );
    out = out.replace(re, `stiffness$1${r1(o.stiffness)}$2${r1(o.damping)}`);
  }
  return out;
}
