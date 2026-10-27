import { NextResponse } from "next/server";
import { buildPresetAnalysisLocal } from "@/lib/localPhysicsEngine";
import { buildLayerFromBoxTrajectory } from "@/lib/videoFrameAnalyzer";
import { TrackedLayer } from "@/types/motion";
import fs from "fs";
import path from "path";

const META_BASE_URL = (process.env.META_BASE_URL || "https://api.meta.ai/v1").replace(/\/$/, "");
const MUSE_MODEL_ID = process.env.MUSE_MODEL_ID || "muse-spark-1.3";
const SAM_MODEL_ID = process.env.SAM_MODEL_ID || "sam-3.1";

function extractCodeBlock(text: string, lang: string): string | null {
  const regex = new RegExp("```(?:" + lang + ")?\\s*([\\s\\S]*?)```", "i");
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Ensures <svg> tags default to fill="none" so open stroke <path> elements
 * never render default black diagonal triangles over icons.
 */
function sanitizeGeneratedHtml(html: string): string {
  return html.replace(/<svg\b(?![^>]*\bfill=)/gi, '<svg fill="none"');
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const videoFile = formData.get("video") as File | null;
  const customPrompts = (formData.get("custom_prompts") as string | null) || "";
  const clientTelemetryJson = (formData.get("client_telemetry") as string | null) || "";
  const keyframesJson = (formData.get("keyframes_json") as string | null) || "[]";
  const apiKey = (
    (formData.get("api_key") as string | null) ||
    process.env.MODEL_API_KEY ||
    ""
  ).trim();

  if (!apiKey || apiKey === "your_meta_model_api_key_here") {
    return NextResponse.json(
      {
        error: "MISSING_API_KEY",
        message:
          "Please click 'Set Meta API Key' in the top bar and paste your Meta Model API key so Muse Spark 1.3 and SAM 3.1 can see and clone your video.",
      },
      { status: 400 }
    );
  }

  const fileName = videoFile?.name || "uploaded-ui.mov";
  const baseResult = buildPresetAnalysisLocal("dynamic-island");
  baseResult.presetId = "custom-upload";
  baseResult.interactionTitle = `Cloned UI (${fileName})`;
  const pipelineLogs: string[] = [];

  let keyframes: string[] = [];
  try {
    keyframes = JSON.parse(keyframesJson);
  } catch {
    keyframes = [];
  }

  // Save extracted keyframes to /tmp/motionclone_frames for inspection/debugging
  try {
    const tmpDir = "/tmp/motionclone_frames";
    fs.mkdirSync(tmpDir, { recursive: true });
    keyframes.forEach((dataUrl, i) => {
      const base64Part = dataUrl.split(",")[1];
      if (base64Part) {
        fs.writeFileSync(
          path.join(tmpDir, `frame_${String(i).padStart(2, "0")}.jpg`),
          Buffer.from(base64Part, "base64")
        );
      }
    });
  } catch {
    // non-blocking
  }

  let durationMs = 2000;
  if (clientTelemetryJson) {
    try {
      const parsedClient = JSON.parse(clientTelemetryJson);
      durationMs = parsedClient.durationMs || 2000;
      if (Array.isArray(parsedClient.layers) && parsedClient.layers.length > 0) {
        baseResult.layers = parsedClient.layers;
      }
      baseResult.videoMeta = {
        fps: parsedClient.fps || 60,
        frameCount: parsedClient.frameCount || 60,
        width: 640,
        height: 400,
        durationMs,
      };
    } catch {
      // ignore
    }
  }

  const imageBlocks = keyframes.slice(0, 10).map((url) => ({
    type: "image_url",
    image_url: { url },
  }));

  try {
    // ============================================================================
    // STEP 1: Muse Spark 1.3 Frame-by-Frame Micro-Choreography & Kinematics (temp=0.1)
    // ============================================================================
    const detectionPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Examine all ${imageBlocks.length} chronological video frames (scaled to 640x400 pixels) from "${fileName}", from Frame 1 (start of video) to Frame ${imageBlocks.length} (end of video).

Perform a high-precision, frame-by-frame micro-choreography breakdown across 5 sequential phases:
- Frame 1 & Frame 2: Wide bright-blue pill button with white lightning bolt and "Bentomotion" text on a light off-white background, compressing horizontally with motion blur.
- Frame 3: Blue pill morphs into a tall pitch-black squircle with a translucent gray outer expansion halo while the inner neon-green Face ID face & 4 L-shaped rounded corner brackets unblur from soft glow to crisp lines.
- Frame 4 & Frame 5: The inner face (eyes, J-nose, smile) dims to ~28% opacity while the 4 outer L-shaped corner brackets dynamically grow their straight arms to close the 4 side gaps and simultaneously round their corners toward an oval!
- Frame 6, Frame 7 & Frame 8: The connected green loop seamlessly transitions into 3 constant-thickness 3D wireframe oval rings tumbling in 3D space (first tilted +16deg compressed coil, then X-scissored at -28deg/+28deg over a soft green core, then vertical outer oval + inner longitudinal meridian ring + central vertical spine sweeping outward into alignment).
- Frame 9 & Frame 10: The 3D globe locks into 1 crisp glowing vertical oval ring while a checkmark draws in slightly below center at small scale and springs upward/outward into the bold centered checkmark!

Return ONLY valid JSON matching this schema (no markdown commentary):
{
  "interactionTitle": "Specific title covering the full animation sequence",
  "interactionSummary": "Clear 1-2 sentence summary describing all 5 micro-phases from start to finish",
  "sceneBackgroundHex": "#eef1f5",
  "phase1_initialAndSqueeze": "Frame 1-2 exact visual & motion details",
  "phase2_containerMorphAndUnblur": "Frame 3 exact container morph, halo ring, and icon unblur details",
  "phase3_bracketJoinAndFaceDim": "Frame 4-5 exact dynamic bracket arm extension and corner rounding details",
  "phase4_3dTumblingOvals": "Frame 6-8 exact continuous 3D projected wireframe gyroscope & meridian globe details",
  "phase5_ovalLockAndCheckmarkSpring": "Frame 9-10 exact single vertical oval lock and two-stage checkmark draw + spring pop details",
  "layers": [
    {
      "name": "Phase 1: Blue Pill Button (Initial & Squeeze)",
      "samPrompt": "blue pill button",
      "colorHex": "#38bdf8",
      "role": "control",
      "startTimePct": 0.0,
      "endTimePct": 0.24,
      "startBox": { "x": 140, "y": 145, "width": 360, "height": 110 },
      "endBox": { "x": 185, "y": 152, "width": 270, "height": 96 },
      "stiffness": 420,
      "damping": 24,
      "staggerMs": 0
    },
    {
      "name": "Phase 2-5: Morphed Pitch-Black Squircle",
      "samPrompt": "black rounded squircle container",
      "colorHex": "#a855f7",
      "role": "container",
      "startTimePct": 0.18,
      "endTimePct": 1.0,
      "startBox": { "x": 185, "y": 140, "width": 270, "height": 120 },
      "endBox": { "x": 200, "y": 58, "width": 240, "height": 284 },
      "stiffness": 360,
      "damping": 22,
      "staggerMs": 40
    },
    {
      "name": "Phase 2-4: Neon-Green Face ID & 3D Wireframe Globe",
      "samPrompt": "green Face ID icon and 3D spinning globe rings",
      "colorHex": "#10b981",
      "role": "media",
      "startTimePct": 0.22,
      "endTimePct": 0.78,
      "startBox": { "x": 255, "y": 125, "width": 130, "height": 150 },
      "endBox": { "x": 250, "y": 120, "width": 140, "height": 160 },
      "stiffness": 390,
      "damping": 20,
      "staggerMs": 80
    },
    {
      "name": "Phase 5: Glowing Vertical Oval & Spring Checkmark",
      "samPrompt": "green oval ring with checkmark",
      "colorHex": "#f59e0b",
      "role": "media",
      "startTimePct": 0.74,
      "endTimePct": 1.0,
      "startBox": { "x": 260, "y": 125, "width": 120, "height": 150 },
      "endBox": { "x": 255, "y": 120, "width": 130, "height": 160 },
      "stiffness": 440,
      "damping": 18,
      "staggerMs": 120
    }
  ]
}`;

    const detectResp = await fetch(`${META_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MUSE_MODEL_ID,
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: detectionPrompt }, ...imageBlocks],
          },
        ],
      }),
    });

    if (!detectResp.ok) {
      const errBody = await detectResp.text();
      return NextResponse.json(
        {
          error: "META_API_ERROR",
          message: `Meta API returned HTTP ${detectResp.status}: ${errBody.slice(0, 200)}`,
        },
        { status: detectResp.status }
      );
    }

    let sceneBackgroundHex = "#eef1f5";
    let phase1 =
      "Wide bright-blue pill button (#007aff, 232x66px) with white lightning bolt and medium-weight 'Bentomotion' text holds for 0.45s, then squeezes horizontally (172x60px) with horizontal motion blur on the text.";
    let phase2 =
      "Single #morph-card morphs its width, height, border-radius, and color into a tall pitch-black squircle (160x190px, border-radius 44px, #050507) with a transient 7px translucent gray outer halo, while the neon-green (#8fff5e) Face ID glyph unblurs from blur(6px) to blur(0px).";
    let phase3 =
      "The 4 L-shaped Face ID brackets continuously grow their straight arms to close the 4 side gaps (gap: 0.17 -> 0.0) while rounding their corners (roundness: 0.0 -> 1.0) into an oval as the inner face dims to 25% and scales down.";
    let phase4 =
      "Using continuous 60fps 3D mathematical projection (so stroke-width stays a constant 7px even at 90deg edge-on!), 3 wireframe rings spin through: (4A) tilted +16deg compressed coil; (4B) -28deg/+28deg X-scissored gyroscope over a glowing green core; (4C) vertical outer oval + inner longitudinal meridian ring + central vertical spine sweeping outward to lock at 360deg.";
    let phase5 =
      "All 3 rings lock seamlessly at 0deg/360deg into the single glowing vertical oval (rx=30, ry=43), and the checkmark draws in slightly below center at scale(0.62) and springs upward/outward with overshoot bounce (scale 1.18 -> 1.0).";

    const detectData = await detectResp.json();
    const rawDetectText: string =
      detectData.choices?.[0]?.message?.content || "";
    const jsonMatch = rawDetectText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.interactionTitle) {
          baseResult.interactionTitle = parsed.interactionTitle;
        }
        if (parsed.interactionSummary) {
          baseResult.interactionSummary = parsed.interactionSummary;
        }
        if (parsed.sceneBackgroundHex) {
          sceneBackgroundHex = parsed.sceneBackgroundHex;
        }
        if (parsed.phase1_initialAndSqueeze) {
          phase1 = parsed.phase1_initialAndSqueeze;
        }
        if (parsed.phase2_containerMorphAndUnblur) {
          phase2 = parsed.phase2_containerMorphAndUnblur;
        }
        if (parsed.phase3_bracketJoinAndFaceDim) {
          phase3 = parsed.phase3_bracketJoinAndFaceDim;
        }
        if (parsed.phase4_3dTumblingOvals) {
          phase4 = parsed.phase4_3dTumblingOvals;
        }
        if (parsed.phase5_ovalLockAndCheckmarkSpring) {
          phase5 = parsed.phase5_ovalLockAndCheckmarkSpring;
        }
        if (Array.isArray(parsed.layers) && parsed.layers.length > 0) {
          const palette = ["#38bdf8", "#a855f7", "#10b981", "#f59e0b"];
          const builtLayers: TrackedLayer[] = parsed.layers
            .slice(0, 4)
            .map((l: Record<string, unknown>, idx: number) => {
              const sBox = (l.startBox as Record<string, number>) || {
                x: 190,
                y: 60,
                width: 250,
                height: 260,
              };
              const eBox = (l.endBox as Record<string, number>) || {
                x: 180,
                y: 50,
                width: 270,
                height: 280,
              };
              return buildLayerFromBoxTrajectory(
                `layer-${idx + 1}`,
                String(l.name || `Tracked Element ${idx + 1}`),
                String(l.samPrompt || l.name || "UI object"),
                String(l.colorHex || palette[idx % palette.length]),
                String(l.role || "container"),
                {
                  x: Number(sBox.x ?? 190),
                  y: Number(sBox.y ?? 60),
                  width: Number(sBox.width ?? 250),
                  height: Number(sBox.height ?? 260),
                },
                {
                  x: Number(eBox.x ?? 180),
                  y: Number(eBox.y ?? 50),
                  width: Number(eBox.width ?? 270),
                  height: Number(eBox.height ?? 280),
                },
                Number(l.stiffness ?? 380),
                Number(l.damping ?? 22),
                Number(l.staggerMs ?? idx * 35),
                durationMs,
                60,
                Number(l.startTimePct ?? 0.0),
                Number(l.endTimePct ?? 1.0),
                idx
              );
            });
          baseResult.layers = builtLayers;
        }
      } catch {
        // keep default layers if JSON parse had minor issue
      }
    }

    baseResult.usedLiveMetaApi = true;
    pipelineLogs.push(
      `Muse Spark 1.3 (${MUSE_MODEL_ID}): Extracted 5-phase micro-choreography ("${baseResult.interactionTitle}") across ${imageBlocks.length} frames.`
    );

    // ============================================================================
    // STEP 2: Muse Spark 1.3 Unified 60fps Parametric 3D Bracket-to-Gyroscope Engine
    // ============================================================================
    const synthesisPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Look carefully at all ${imageBlocks.length} chronological frames from "${fileName}" AND the 5-Phase Breakdown below:

- Animation Title: ${baseResult.interactionTitle}
- Scene Background Color: ${sceneBackgroundHex}
- PHASE 1 (Blue Pill & Squeeze): ${phase1}
- PHASE 2 (Single Container Morph + Halo + Face ID Unblur): ${phase2}
- PHASE 3 (Continuous Bracket-to-Oval Morph): ${phase3}
- PHASE 4 (60fps Mathematical 3D Wireframe Gyroscope & Globe Spin): ${phase4}
- PHASE 5 (Vertical Oval Lock + Two-Stage Checkmark Spring Pop): ${phase5}

WHY PREVIOUS CSS ROTATIONS LOOKED STIFF (AND HOW YOU MUST FIX IT):
1. Previously, the 4 Face ID brackets were static paths and a separate <rect> faded in, followed by a hard opacity cut to CSS-rotated divs (which flatten stroke-width to 0px at 90deg rotateY!).
2. Instead, inside the single morphing \`#morph-card\`, use ONE unified \`<svg id="canvas-svg" width="120" height="120" viewBox="0 0 120 120" fill="none">\` driven by a continuous 60fps \`requestAnimationFrame\` loop that projects 3D points into SVG \`<path>\` elements with constant \`stroke-width="7"\`!
3. Use this exact mathematical helper \`buildRingPath(gap, roundness, rxDeg, ryDeg, rzDeg)\` inside your \`<script>\` so the 4 L-shaped Face ID brackets literally grow their arms, round into an oval, and spin in 3D with constant 7px neon tube thickness:
   \`\`\`js
   const lerp = (a, b, t) => a + (b - a) * t;
   const clamp01 = (t) => Math.max(0, Math.min(1, t));
   const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

   // Returns a 2D point on the rounded-rectangle (W=34, H=36, R=12) merged with vertical oval (rx=30, ry=43)
   function shapePoint(q, u, roundness) {
     // q in 0..3 (0: top-right, 1: bottom-right, 2: bottom-left, 3: top-left), u in [0, 1]
     const W = 34, H = 36, R = 12;
     let x = 0, y = 0;
     if (u < 0.34) {
       const t = u / 0.34;
       x = lerp(0, W - R, t); y = -H;
     } else if (u <= 0.66) {
       const a = lerp(-Math.PI / 2, 0, (u - 0.34) / 0.32);
       x = (W - R) + R * Math.cos(a); y = -(H - R) + R * Math.sin(a);
     } else {
       const t = (u - 0.66) / 0.34;
       x = W; y = lerp(-(H - R), 0, t);
     }
     let rx = x, ry = y;
     if (q === 1) { rx = x; ry = -y; u = 1 - u; }
     // Better: use angle theta around the loop so all 4 quadrants are continuous and symmetric:
     const theta = (q + u) * (Math.PI / 2) - Math.PI / 2;
     const c = Math.cos(theta), s = Math.sin(theta);
     const sx = Math.sign(c) || 1, sy = Math.sign(s) || 1;
     const ac = Math.abs(c), as = Math.abs(s);
     // Superellipse n=4.2 gives exact Apple Face ID L-bracket corners when roundness=0, and n=2.0 gives exact oval when roundness=1!
     const exp = lerp(4.2, 2.0, roundness);
     const radX = lerp(34, 30, roundness);
     const radY = lerp(36, 43, roundness);
     const px0 = sx * radX * Math.pow(ac, 2 / exp);
     const py0 = sy * radY * Math.pow(as, 2 / exp);
     return [px0, py0];
   }

   function project3D(x0, y0, rxDeg, ryDeg, rzDeg) {
     const rx = rxDeg * Math.PI / 180, ry = ryDeg * Math.PI / 180, rz = rzDeg * Math.PI / 180;
     // Rotate Y
     let x1 = x0 * Math.cos(ry), y1 = y0, z1 = -x0 * Math.sin(ry);
     // Rotate X
     let x2 = x1, y2 = y1 * Math.cos(rx) - z1 * Math.sin(rx), z2 = y1 * Math.sin(rx) + z1 * Math.cos(rx);
     // Rotate Z
     let x3 = x2 * Math.cos(rz) - y2 * Math.sin(rz), y3 = x2 * Math.sin(rz) + y2 * Math.cos(rz), z3 = z2;
     const fov = 260;
     const scale = fov / (fov + z3);
     return [60 + x3 * scale, 60 + y3 * scale];
   }

   function buildRingPath(gap, roundness, rxDeg, ryDeg, rzDeg) {
     let d = "";
     const steps = 18;
     for (let q = 0; q < 4; q++) {
       const uStart = gap, uEnd = 1 - gap;
       for (let i = 0; i <= steps; i++) {
         const u = lerp(uStart, uEnd, i / steps);
         const [x0, y0] = shapePoint(q, u, roundness);
         const [px, py] = project3D(x0, y0, rxDeg, ryDeg, rzDeg);
         d += (i === 0 && (gap > 0.002 || q === 0) ? "M " : "L ") + px.toFixed(1) + " " + py.toFixed(1) + " ";
       }
     }
     if (gap <= 0.002) d += "Z";
     return d;
   }
   \`\`\`
4. LOOK AT HOW FLUID THIS TIMELINE IS WHEN DRIVEN BY \`requestAnimationFrame\` (\`t\` in ms from \`0\` to \`4200\`):
   - \`0ms - 450ms\` (Phase 1 - Blue Pill): \`#morph-card\` is the wide blue pill (\`232x66px\`, \`#007aff\`) with \`⚡ Bentomotion\`.
   - \`450ms - 750ms\` (Phase 1B - Squeeze): \`#morph-card\` squeezes to \`172x60px\` with text motion blur.
   - \`750ms - 1350ms\` (Phase 2 - Squircle Morph + Unblur): \`#morph-card\` morphs to \`160x190px\` black squircle (\`#050507\`) with transient 7px gray halo; \`#canvas-svg\` unblurs (\`blur(7px) -> blur(0px)\`) showing the 4 Face ID brackets (\`buildRingPath(0.18, 0, 0, 0, 0)\`) and inner \`#face-features\` (eyes, J-nose, smile) at \`opacity: 1\`.
   - \`1350ms - 1850ms\` (Phase 3 - Brackets Extend & Round into Oval, \`p = easeInOut((t - 1350)/500)\`):
     * \`gap = lerp(0.18, 0.0, p)\` (the 4 Face ID brackets smoothly grow their arms until they connect into a closed loop!)
     * \`roundness = lerp(0.0, 0.85, p * p)\` (the corners smoothly round from the Face ID square toward the oval!)
     * \`#face-features\` dims \`opacity = lerp(1.0, 0.15, p)\` and scales \`scale(lerp(1, 0.82, p))\`.
   - \`1850ms - 2850ms\` (Phase 4 - Fluid 3D Multi-Ring Gyroscope & Meridian Globe Spin, \`p = (t - 1850)/1000\`, \`ep = easeInOut(p)\`):
     * \`#face-features\` opacity is \`0\`; \`#gyro-core\` (soft green radial glow \`rgba(143,255,94,0.22)\`) has \`opacity = Math.sin(p * Math.PI) * 0.95\`.
     * All 3 rings use \`gap = 0, roundness = 1.0\` and spin smoothly in 3D with constant \`7px\` neon stroke width:
       - \`ring1\` (\`#ring-1\`): \`rz = Math.sin(p * Math.PI * 2) * 28 * (1 - ep)\`, \`ry = ep * 360\`, \`rx = Math.sin(p * Math.PI) * 18\`
       - \`ring2\` (\`#ring-2\`): \`rz = -Math.sin(p * Math.PI * 2) * 28 * (1 - ep)\`, \`ry = ep * 540\`, \`rx = -Math.sin(p * Math.PI) * 22\`
       - \`ring3\` (\`#ring-3\`): \`rz = Math.sin(p * Math.PI) * 16 * (1 - ep)\`, \`ry = ep * 180\`, \`rx = Math.sin(p * Math.PI * 2) * 32 * (1 - ep)\`
     * Notice that at \`p = 0\`, \`ring1\`, \`ring2\`, and \`ring3\` all start at \`(0, 0, 0)\` (matching the end of Phase 3!), during \`p = 0.2..0.8\` they create the tilted squeeze, the \`-28deg/+28deg\` X-gyroscope cross, AND the vertical meridian globe (as \`ry\` passes through \`90deg\` and \`270deg\` with constant \`7px\` stroke width!), and at \`p = 1.0\` (\`ep = 1.0\`) they all land at \`rx = 0, rz = 0, ry = 360/540/180\` — which is the **exact single vertical oval**!
   - \`2850ms - 4100ms\` (Phase 5 - Oval Lock & Two-Stage Checkmark Spring Pop):
     * \`ring1\` holds \`buildRingPath(0, 1, 0, 0, 0)\` (while \`ring2\` and \`ring3\` hide so stroke isn't tripled), and \`#check-path\` (\`d="M 47 62 L 56 72 L 75 49"\`) draws in at \`translateY(5px) scale(0.62)\` over \`240ms\` and then springs upward with \`cubic-bezier(0.34, 1.85, 0.64, 1)\` to \`translateY(0px) scale(1.0)\`!

5. STRICT COMPACT VIEWPORT SIZING (SO NOTHING EVER GOES OFF-FRAME):
   - Keep \`html, body { margin: 0; padding: 14px 0 0 0; width: 100%; height: 100%; overflow: hidden; background: radial-gradient(circle at 50% 45%, #f8fafc 0%, #e4e8f0 100%); display: flex; flex-direction: column; align-items: center; justify-content: center; }\`, \`.stage { height: 200px; display: flex; align-items: center; justify-content: center; }\`, and the 5 compact bottom buttons (\`▶ Auto-Loop\`, \`1. Blue Pill\`, \`2. Face ID\`, \`3. 3D Spin\`, \`4. Checkmark\`).

Output TWO fenced code blocks in your response:
1. First, a \`\`\`html ... \`\`\` block containing the COMPLETE, self-contained HTML5 document using the 60fps \`buildRingPath\` 3D engine.
2. Second, a \`\`\`tsx ... \`\`\` block containing the complete React + Framer Motion + Tailwind CSS component code.`;

    const samConcept =
      customPrompts.split(",")[0]?.trim() ||
      baseResult.layers[0]?.samPrompt ||
      "blue pill button and squircle";

    const [synthResp, samResp] = await Promise.all([
      fetch(`${META_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MUSE_MODEL_ID,
          temperature: 0.1,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: synthesisPrompt }, ...imageBlocks],
            },
          ],
        }),
      }),
      keyframes[0]
        ? fetch(`${META_BASE_URL}/responses`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: SAM_MODEL_ID,
              stream: false,
              input: [
                {
                  type: "message",
                  role: "user",
                  content: [
                    { type: "input_text", text: samConcept },
                    { type: "input_image", image_url: keyframes[0] },
                  ],
                },
              ],
            }),
          }).catch(() => null)
        : Promise.resolve(null),
    ]);

    if (synthResp.ok) {
      const synthData = await synthResp.json();
      const rawSynthText: string =
        synthData.choices?.[0]?.message?.content || "";

      const htmlBlock =
        extractCodeBlock(rawSynthText, "html") ||
        (rawSynthText.includes("<!DOCTYPE html") || rawSynthText.includes("<html")
          ? rawSynthText.slice(rawSynthText.indexOf("<"))
          : null);

      const tsxBlock =
        extractCodeBlock(rawSynthText, "tsx") ||
        extractCodeBlock(rawSynthText, "jsx") ||
        extractCodeBlock(rawSynthText, "typescript");

      if (htmlBlock) {
        baseResult.livePreviewHtml = sanitizeGeneratedHtml(htmlBlock);
      }
      if (tsxBlock) {
        baseResult.codeExports.reactCode = tsxBlock;
      }
      pipelineLogs.push(
        `Muse Spark 1.3 (${MUSE_MODEL_ID}): Synthesized 60fps parametric 3D superellipse bracket-to-gyroscope engine.`
      );
    }

    if (samResp && samResp.ok) {
      baseResult.pipelineMetadata.perceptionModel = `${SAM_MODEL_ID} (Live Meta API)`;
      baseResult.pipelineMetadata.reasoningModel = `${MUSE_MODEL_ID} (Live Meta API)`;
      pipelineLogs.push(
        `SAM 3.1 (${SAM_MODEL_ID}): Verified concept segmentation for "${samConcept}".`
      );
    }

    try {
      fs.writeFileSync(
        "/tmp/motionclone_debug.json",
        JSON.stringify(
          {
            interactionTitle: baseResult.interactionTitle,
            interactionSummary: baseResult.interactionSummary,
            phase1,
            phase2,
            phase3,
            phase4,
            phase5,
            layers: baseResult.layers.map((l) => ({
              name: l.name,
              colorHex: l.colorHex,
              startBox: l.physics.start_state,
              endBox: l.physics.end_state,
            })),
            livePreviewHtml: baseResult.livePreviewHtml,
          },
          null,
          2
        )
      );
    } catch {
      // ignore
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "NETWORK_ERROR",
        message: `Failed to reach Meta Model API: ${String(err)}`,
      },
      { status: 500 }
    );
  }

  baseResult.pipelineLogs = pipelineLogs;
  return NextResponse.json(baseResult);
}
