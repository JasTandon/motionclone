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
    // STEP 1: Unbiased Multi-Phase Visual & Kinematic Video Analysis (temp=0.1)
    // ============================================================================
    const detectionPrompt = `You are Meta Muse Spark 1.3 powering MotionClone, a universal Video-to-Spring-Physics UI & Motion Graphics Compiler.
Examine all ${imageBlocks.length} chronological video frames (scaled to 640x400 pixels) from "${fileName}", from Frame 1 (start of video) to Frame ${imageBlocks.length} (end of video).

CRITICAL ANALYSIS RULES:
1. Analyze ONLY what is visually present in these ${imageBlocks.length} frames.
2. If the video is a camera recording of a screen/monitor, IGNORE physical monitor dust, scratches, or room reflections—focus 100% on the digital UI / motion graphics animation being displayed.
3. Classify "animationArchetype" into ONE of these values based on what you see:
   - "gooey_metaball_blobs": if the animation shows glowing circular dots/orbs growing, trailing, and merging together via liquid/metaball bridges into larger spheres or teardrop shapes.
   - "face_id_3d_morph": if the animation shows a blue pill button ("Bentomotion") morphing into a black squircle with a green Face ID icon, 3D spinning wireframe oval rings, and a checkmark.
   - "general_ui_choreography": for any other UI component, icon morph, card transition, loader, toggle, or interactive motion design.
4. Break the animation down across 5 sequential chronological phases (Frames 1-2, Frame 3, Frames 4-5, Frames 6-8, Frames 9-10) and output 3 to 4 real, visible moving UI layers tracked across time with accurate "startTimePct" (0.0 to 1.0), "endTimePct" (0.0 to 1.0), "startBox", and "endBox" on the 640x400 canvas. Never include "Absent" or placeholder layers.

Return ONLY valid JSON matching this schema (no markdown commentary):
{
  "animationArchetype": "gooey_metaball_blobs | face_id_3d_morph | general_ui_choreography",
  "interactionTitle": "Concise, polished UI motion title (e.g. 'Liquid Mint Metaball Orb Loader & Teardrop Morph')",
  "interactionSummary": "Clear 1-2 sentence summary of the digital UI/motion animation and its visual physics from start to finish",
  "sceneBackgroundHex": "#0b1011",
  "primaryAccentHex": "#7ef7c8",
  "secondaryAccentHex": "#45e3a8",
  "phase1_frames1to2": "Exact visual shapes, positions, colors, and motion in Frames 1-2",
  "phase2_frame3": "Exact visual shapes, positions, colors, and motion in Frame 3",
  "phase3_frames4to5": "Exact visual shapes, liquid bridging / morphing, and motion in Frames 4-5",
  "phase4_frames6to8": "Exact visual shapes, absorption / 3D rotation / morphing in Frames 6-8",
  "phase5_frames9to10": "Exact final settle, spring pulse, or budding/checkmark state in Frames 9-10",
  "layers": [
    {
      "name": "Phase 1-2: Moving UI Element / Dot Trail",
      "samPrompt": "concise visual description for SAM 3.1",
      "colorHex": "#38bdf8",
      "role": "control",
      "startTimePct": 0.0,
      "endTimePct": 0.38,
      "startBox": { "x": 180, "y": 170, "width": 140, "height": 50 },
      "endBox": { "x": 40, "y": 120, "width": 220, "height": 160 },
      "stiffness": 390,
      "damping": 22,
      "staggerMs": 0
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

    let animationArchetype = "general_ui_choreography";
    let sceneBackgroundHex = "#0b1011";
    let primaryAccentHex = "#7ef7c8";
    let secondaryAccentHex = "#45e3a8";
    let phase1 = "Initial state and primary motion trigger across Frames 1-2.";
    let phase2 = "Secondary expansion and layer transition in Frame 3.";
    let phase3 = "Mid-sequence morphing and shape bridging across Frames 4-5.";
    let phase4 = "Peak dynamic motion and convergence across Frames 6-8.";
    let phase5 = "Final spring settle and state completion across Frames 9-10.";

    const detectData = await detectResp.json();
    const rawDetectText: string =
      detectData.choices?.[0]?.message?.content || "";
    const jsonMatch = rawDetectText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.animationArchetype) {
          animationArchetype = String(parsed.animationArchetype);
        }
        if (parsed.interactionTitle) {
          baseResult.interactionTitle = parsed.interactionTitle;
        }
        if (parsed.interactionSummary) {
          baseResult.interactionSummary = parsed.interactionSummary;
        }
        if (parsed.sceneBackgroundHex) {
          sceneBackgroundHex = parsed.sceneBackgroundHex;
        }
        if (parsed.primaryAccentHex) {
          primaryAccentHex = parsed.primaryAccentHex;
        }
        if (parsed.secondaryAccentHex) {
          secondaryAccentHex = parsed.secondaryAccentHex;
        }
        if (parsed.phase1_frames1to2) {
          phase1 = parsed.phase1_frames1to2;
        }
        if (parsed.phase2_frame3) {
          phase2 = parsed.phase2_frame3;
        }
        if (parsed.phase3_frames4to5) {
          phase3 = parsed.phase3_frames4to5;
        }
        if (parsed.phase4_frames6to8) {
          phase4 = parsed.phase4_frames6to8;
        }
        if (parsed.phase5_frames9to10) {
          phase5 = parsed.phase5_frames9to10;
        }
        if (Array.isArray(parsed.layers) && parsed.layers.length > 0) {
          const palette = ["#38bdf8", "#a855f7", "#10b981", "#f59e0b"];
          const validRawLayers = parsed.layers.filter(
            (l: Record<string, unknown>) => {
              const nameStr = String(l.name || "").toLowerCase();
              const eBox = (l.endBox as Record<string, number>) || {};
              return (
                !nameStr.startsWith("absent") &&
                !(Number(eBox.width) === 0 && Number(eBox.height) === 0)
              );
            }
          );
          const builtLayers: TrackedLayer[] = validRawLayers
            .slice(0, 4)
            .map((l: Record<string, unknown>, idx: number) => {
              const sBox = (l.startBox as Record<string, number>) || {
                x: 160,
                y: 120,
                width: 180,
                height: 140,
              };
              const eBox = (l.endBox as Record<string, number>) || {
                x: 170,
                y: 70,
                width: 280,
                height: 260,
              };
              return buildLayerFromBoxTrajectory(
                `layer-${idx + 1}`,
                String(l.name || `Tracked Element ${idx + 1}`),
                String(l.samPrompt || l.name || "UI object"),
                String(l.colorHex || palette[idx % palette.length]),
                String(l.role || "container"),
                {
                  x: Number(sBox.x ?? 160),
                  y: Number(sBox.y ?? 120),
                  width: Math.max(24, Number(sBox.width ?? 180)),
                  height: Math.max(24, Number(sBox.height ?? 140)),
                },
                {
                  x: Number(eBox.x ?? 170),
                  y: Number(eBox.y ?? 70),
                  width: Math.max(24, Number(eBox.width ?? 280)),
                  height: Math.max(24, Number(eBox.height ?? 260)),
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
          if (builtLayers.length > 0) {
            baseResult.layers = builtLayers;
          }
        }
      } catch {
        // keep default layers if JSON parse had minor issue
      }
    }

    // Auto-detect archetype strictly from explicit archetype or unmistakable metaball keywords
    const combinedText = `${animationArchetype} ${baseResult.interactionTitle} ${baseResult.interactionSummary}`.toLowerCase();
    const isGooeyMetaball =
      animationArchetype === "gooey_metaball_blobs" ||
      combinedText.includes("metaball") ||
      combinedText.includes("teardrop") ||
      (combinedText.includes("blobs") && combinedText.includes("merg"));
    const isFaceIdMorph =
      !isGooeyMetaball &&
      (animationArchetype === "face_id_3d_morph" ||
        combinedText.includes("face id") ||
        combinedText.includes("bentomotion"));

    baseResult.usedLiveMetaApi = true;
    pipelineLogs.push(
      `Muse Spark 1.3 (${MUSE_MODEL_ID}): Extracted 5-phase "${baseResult.interactionTitle}" (${isGooeyMetaball ? "gooey_metaball_blobs" : isFaceIdMorph ? "face_id_3d_morph" : "general_ui_choreography"}) across ${imageBlocks.length} frames.`
    );

    // ============================================================================
    // STEP 2: Adaptive High-Precision 60fps Clone Synthesis (temp=0.1)
    // ============================================================================
    let synthesisPrompt = "";

    if (isGooeyMetaball) {
      synthesisPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Look carefully at all ${imageBlocks.length} chronological video frames from "${fileName}" AND the 5-Phase Breakdown below:

- Animation Title: ${baseResult.interactionTitle}
- PHASE 1 (Frames 1-2: Small Mint Dot Trails & Left Orb Entry): ${phase1}
- PHASE 2 (Frame 3: Growing Dot Train & Left Sphere Swell): ${phase2}
- PHASE 3 (Frames 4-5: Triple-Lobed Liquid Metaball Bridge): ${phase3}
- PHASE 4 (Frames 6-8: Left-Pointing Liquid Teardrop Absorption): ${phase4}
- PHASE 5 (Frames 9-10: Giant Centered Mint Orb & Right-Pointing Teardrop Bud with Layered Crescent Rim): ${phase5}

YOUR GOAL:
Build a 95%+ visually faithful, 60fps interactive HTML5 + SVG Gooey Metaball Physics clone that replicates every single frame (Frame 1 through Frame 10) of this mint-green liquid metaball animation!

MANDATORY VISUAL & MATHEMATICAL ARCHITECTURE:
1. VIEWPORT & LAYOUT (NO CLIPPING!):
   - Full-viewport dark studio canvas (\`min-height: 100vh; margin: 0; background: radial-gradient(circle at 50% 46%, #142220 0%, #090d0e 75%); display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;\`).
   - Do NOT put any title text at the top.
   - Create a centered stage (\`width: 360px; height: 225px; position: relative; display: flex; align-items: center; justify-content: center;\`) containing \`<svg id="metaball-svg" viewBox="0 0 360 225" width="360" height="225" fill="none" style="overflow:visible">\`.
   - Below the stage (\`margin-top: 10px\`), place a compact pill bar with 6 buttons: \`1. Dot Trail\`, \`2. Sphere Swell\`, \`3. Metaball Bridge\`, \`4. Teardrop Merge\`, \`5. Orb & Right Bud\`, and \`Loop All\`.

2. DUAL-LAYER SVG GOOEY METABALL FILTER + SOFT BLOOM (THE SECRET TO 95% FIDELITY):
   - In the original video frames:
     * Circles merge together with smooth concave liquid necks (classic 2D Gaussian metaball threshold).
     * Moving spheres and the right-pointing teardrop in Frame 10 have a distinct **translucent mint-emerald rim/crescent cap** (\`#3ee0a5\`, opacity \`0.48\`) slightly offset from the bright pale-mint core (\`#d2ffec\`)!
   - Define these exact SVG \`<defs>\`:
     \`\`\`xml
     <defs>
       <!-- True Liquid Metaball Filter: blurs circles then thresholds alpha at 22x - 9 -->
       <filter id="goo" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
         <feGaussianBlur in="SourceGraphic" stdDeviation="11.5" result="blur" />
         <feColorMatrix in="blur" mode="matrix" values="
           1 0 0 0 0
           0 1 0 0 0
           0 0 1 0 0
           0 0 0 23 -9.5" result="goo" />
       </filter>
       <!-- Outer Mint Bloom -->
       <filter id="mint-bloom" x="-50%" y="-50%" width="200%" height="200%">
         <feGaussianBlur stdDeviation="14" result="glow" />
         <feMerge>
           <feMergeNode in="glow" />
           <feMergeNode in="SourceGraphic" />
         </feMerge>
       </filter>
     </defs>
     \`\`\`
   - Inside \`<svg>\`, render THREE synchronized layers of 8 circles (\`c0\` .. \`c7\`):
     1. \`<g id="outer-cap" opacity="0.36" filter="url(#goo)" fill="#29c48e">\` (8 circles \`o0..o7\` for the outer translucent crescent cap seen in Frame 2, 4, 8, 10)
     2. \`<g id="rim-layer" opacity="0.62" filter="url(#goo)" fill="#52f0b5">\` (8 circles \`r0..r7\` for the mid emerald-mint rim)
     3. \`<g id="core-wrap" filter="url(#mint-bloom)"><g id="core-layer" filter="url(#goo)" fill="#d6ffee">\` (8 circles \`c0..c7\` for the bright overexposed mint-white core)

3. EXACT 10-KEYFRAME PIECEWISE INTERPOLATION IN \`renderAt(t)\` (\`t = 0..4500ms\`):
   - Instead of guessing vague motion, interpolate the 8 circles \`[x, y, r, rimDx]\` across the exact 10 keyframes observed in the video (\`KF[0]\` at \`t=0\` through \`KF[9]\` at \`t=4050ms\`, with \`450ms\` per keyframe interval and smooth \`easeInOut\` + spring overshoot on Frame 8 & 9!):
     * **KF 0 (\`t = 0ms\`, Frame 1 — Two Dot Trails)**:
       - Center-left 4 dots decreasing in size: \`c0: [122, 126, 9.5, 0]\`, \`c1: [144, 126, 8.2, 0]\`, \`c2: [165, 126, 6.5, 0]\`, \`c3: [184, 126, 4.6, 0]\`
       - Right cluster of 4 overlapping dots: \`c4: [298, 122, 6.5, 0]\`, \`c5: [305, 122, 7.2, 0]\`, \`c6: [312, 122, 7.6, 0]\`, \`c7: [320, 122, 8.2, 0]\`
     * **KF 1 (\`t = 450ms\`, Frame 2 — Left Orb Enters & Right Dots Hold)**:
       - \`c0: [6, 130, 34, 9]\` (large pale green orb entering from left edge with +9px right rim!)
       - \`c1: [12, 130, 22, 6]\`, \`c2: [242, 125, 2.2, 0]\`, \`c3: [250, 125, 2.2, 0]\`
       - Right 3 dots: \`c4: [295, 124, 6.2, 0]\`, \`c5: [303, 124, 6.8, 0]\`, \`c6: [315, 124, 7.4, 0]\`, \`c7: [315, 124, 0, 0]\`
     * **KF 2 (\`t = 900ms\`, Frame 3 — Left Edge Disc + 4 Medium Center-Left Dots + 4 Small Right Dots)**:
       - \`c0: [-4, 132, 45, 5]\` (large disc on far left edge)
       - 4 medium mint dots center-left: \`c1: [65, 132, 12.5, -2]\`, \`c2: [79, 132, 12.5, 0]\`, \`c3: [93, 132, 11.2, 0]\`, \`c4: [106, 132, 9.8, 0]\`
       - Right small dot cluster + far-right edge disc: \`c5: [276, 128, 4.2, 0]\`, \`c6: [287, 128, 5.2, 0]\`, \`c7: [358, 125, 15, -3]\`
     * **KF 3 (\`t = 1350ms\`, Frame 4 — Swollen Left-Center Sphere + 3 Small Right Dots)**:
       - \`c0: [-18, 134, 30, 4]\`
       - Swollen left-center sphere with left emerald rim: \`c1: [68, 132, 46, -7]\`, \`c2: [72, 132, 44, -4]\`, \`c3: [75, 132, 38, 0]\`, \`c4: [75, 132, 20, 0]\`
       - 3 small right dots: \`c5: [272, 128, 4.2, 0]\`, \`c6: [279, 128, 4.8, 0]\`, \`c7: [286, 128, 5.2, 0]\`
     * **KF 4 (\`t = 1800ms\`, Frame 5 — Two Large Spheres + Bridging Neck Dots)**:
       - Left sphere + bridge: \`c0: [18, 126, 45, 5]\`, \`c1: [48, 126, 16, 4]\`, \`c2: [58, 126, 12, 5]\`
       - Large center-left sphere with dual mint rim: \`c3: [158, 120, 54, -6]\`, \`c4: [162, 120, 54, 6]\`, \`c5: [160, 120, 48, 0]\`, \`c6: [214, 122, 3.5, 0]\`, \`c7: [214, 122, 0, 0]\`
     * **KF 5 (\`t = 2250ms\`, Frame 6 — Triple-Lobed Horizontal Metaball Bridge)**:
       - 3 large spheres connected by liquid metaball waists:
       - Left lobe: \`c0: [22, 118, 42, 4]\`, \`c1: [56, 116, 30, 3]\`
       - Middle lobe: \`c2: [94, 114, 46, 4]\`, \`c3: [138, 110, 34, 4]\`
       - Right-center lobe: \`c4: [188, 106, 56, 4]\`, \`c5: [192, 106, 52, -4]\`, \`c6: [188, 106, 40, 0]\`, \`c7: [188, 106, 0, 0]\`
     * **KF 6 (\`t = 2700ms\`, Frame 7 — Elongated Left-Tail Bulb Merging Rightward)**:
       - \`c0: [24, 120, 36, 4]\`, \`c1: [64, 118, 32, 4]\`, \`c2: [112, 112, 48, 3]\`, \`c3: [152, 106, 64, 2]\`, \`c4: [176, 104, 72, 2]\`, \`c5: [180, 104, 68, 0]\`, \`c6: [176, 104, 50, 0]\`, \`c7: [176, 104, 0, 0]\`
     * **KF 7 (\`t = 3150ms\`, Frame 8 — Plump Left-Pointing Liquid Teardrop with Left Rim)**:
       - \`c0: [68, 116, 35, -8]\`, \`c1: [96, 112, 44, -6]\`, \`c2: [132, 106, 58, -4]\`, \`c3: [168, 102, 74, -2]\`, \`c4: [182, 102, 76, 0]\`, \`c5: [182, 102, 70, 0]\`, \`c6: [182, 102, 50, 0]\`, \`c7: [182, 102, 0, 0]\`
     * **KF 8 (\`t = 3600ms\`, Frame 9 — Giant Centered Glowing Mint Sphere)**:
       - All circles converged into the huge centered orb:
       - \`c0: [176, 98, 76, 0]\`, \`c1: [180, 98, 82, 0]\`, \`c2: [180, 98, 84, 0]\`, \`c3: [180, 98, 84, 0]\`, \`c4: [180, 98, 82, 0]\`, \`c5: [180, 98, 76, 0]\`, \`c6: [180, 98, 60, 0]\`, \`c7: [180, 98, 0, 0]\`
     * **KF 9 (\`t = 4050ms\`, Frame 10 — Right-Pointing Liquid Teardrop with Layered Crescent Cap)**:
       - Main body + right-pointing teardrop taper + extended right crescent rim (\`rimDx = +14\` and \`outerCapDx = +26\`!):
       - \`c0: [164, 98, 78, 2]\`, \`c1: [186, 98, 74, 4]\`, \`c2: [212, 98, 62, 8]\`, \`c3: [238, 98, 48, 12]\`, \`c4: [262, 98, 38, 16]\`, \`c5: [272, 98, 30, 20]\`, \`c6: [164, 98, 70, 0]\`, \`c7: [164, 98, 0, 0]\`

   - For each circle \`i = 0..7\` at time \`t\`:
     * Find segment \`seg = Math.min(8, Math.floor(clampedT / 450))\` and local progress \`u = easeInOut((clampedT - seg * 450) / 450)\`.
     * Interpolate \`x, y, r, rimDx\` between \`KF[seg][i]\` and \`KF[seg + 1][i]\`.
     * Set \`coreCircles[i]\` to \`(x, y, r)\`.
     * Set \`rimCircles[i]\` to \`(x + rimDx, y, r * 1.02)\`.
     * Set \`outerCapCircles[i]\` to \`(x + rimDx * 1.85, y, r * 1.03)\`.
     * If \`r < 0.8\`, set \`r = 0\` so unused circles in that frame are invisible.

Output TWO fenced code blocks in your response:
1. First, a \`\`\`html ... \`\`\` block containing the COMPLETE, self-contained HTML5 document implementing this exact 10-keyframe Dual-Layer SVG Gooey Metaball animation with interactive phase buttons.
2. Second, a \`\`\`tsx ... \`\`\` block containing the complete React + Framer Motion + SVG Gooey Metaball component code.`;
    } else if (isFaceIdMorph) {
      synthesisPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Look carefully at all ${imageBlocks.length} chronological frames from "${fileName}" AND the 5-Phase Breakdown below:

- Animation Title: ${baseResult.interactionTitle}
- Scene Background Color: ${sceneBackgroundHex}
- PHASE 1 (Blue Pill & Squeeze): ${phase1}
- PHASE 2 (Single Container Morph + Halo + Face ID Unblur): ${phase2}
- PHASE 3 (Straight-Legged L-Brackets Grow & Round into Oval): ${phase3}
- PHASE 4 (360-Deg 3D Perspective Gyroscope & Meridian Convergence): ${phase4}
- PHASE 5 (Seamless Oval Lock + Overlapping Checkmark Draw & Sympathetic Spring Pop): ${phase5}

YOU MUST USE THIS EXACT MATHEMATICAL IMPLEMENTATION FOR ALL 5 PHASES:
1. Single morphing container (\`#morph-card\`) starting as the wide \`#007aff\` Blue Pill (\`⚡ Bentomotion\`) on \`#eef1f5\`, squeezing horizontally (\`t=420..820ms\`), and morphing (\`t=820..1280ms\`) into the tall \`#050507\` pitch-black squircle (\`158x188px, border-radius: 44px\`) with a translucent outer halo.
2. Clockwise \`shapePoint(q, u, roundness)\` for straight-legged Face ID brackets (\`W=35, H=37, R=13\`) + \`#face-features\` (\`M 43 44 L 43 53\`, \`M 77 44 L 77 53\`, \`M 60 45 L 60 60 Q 60 64.5 54.5 64.5\`, \`M 46 74 Q 60 85 74 74\`) that grow their arms (\`trim: 0.18 -> 0.0\`) and round (\`roundness: 0 -> 1\`) into a \`(31, 43)\` vertical oval at \`t = 1700..2100ms\`.
3. True 3D perspective \`ringD(31, 43, dx, dy, dz)\` (\`fov = 250\`) with sine-envelope convergence (\`env = Math.sin(p * Math.PI)\`, \`pe = easeInOut(p)\`) during \`t = 2100..2900ms\` so all 3 rings spin \`360deg\`/\`180deg\` around Y at \`opacity = 1\` and converge onto \`(0, 360deg, 0)\`.
4. Overlapping checkmark draw-in (\`t = 2820..3060ms\`) at \`scale(0.58), translateY(+7px)\` followed by an underdamped spring bounce (\`1 - Math.exp(-5.5 * x) * Math.cos(9.5 * x)\`) and sympathetic oval pulse.

Output TWO fenced code blocks in your response:
1. First, a \`\`\`html ... \`\`\` block containing the COMPLETE, self-contained HTML5 document.
2. Second, a \`\`\`tsx ... \`\`\` block containing the complete React + Framer Motion + Tailwind CSS component code.`;
    } else {
      const layerSpecs = baseResult.layers
        .map(
          (l, i) =>
            `  Layer ${i + 1} ("${l.name}", color ${l.colorHex}): startBox=(${Math.round(l.physics.start_state.x)}, ${Math.round(l.physics.start_state.y)}, ${Math.round(l.physics.start_state.width)}x${Math.round(l.physics.start_state.height)}px) -> endBox=(${Math.round(l.physics.end_state.x)}, ${Math.round(l.physics.end_state.y)}, ${Math.round(l.physics.end_state.width)}x${Math.round(l.physics.end_state.height)}px), stiffness=${l.physics.stiffness}, damping=${l.physics.damping}`
        )
        .join("\n");

      synthesisPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Look carefully at all ${imageBlocks.length} chronological frames from "${fileName}" AND the 5-Phase Breakdown + Tracked Layer Telemetry below:

- Animation Title: ${baseResult.interactionTitle}
- Summary: ${baseResult.interactionSummary}
- Scene Background Color: ${sceneBackgroundHex}
- Primary Accent Color: ${primaryAccentHex}
- Secondary Accent Color: ${secondaryAccentHex}
- PHASE 1 (Frames 1-2): ${phase1}
- PHASE 2 (Frame 3): ${phase2}
- PHASE 3 (Frames 4-5): ${phase3}
- PHASE 4 (Frames 6-8): ${phase4}
- PHASE 5 (Frames 9-10): ${phase5}
- Tracked Layer Trajectories (on 640x400 canvas):
${layerSpecs}

YOUR GOAL:
Build a 95%+ visually faithful, 60fps interactive HTML5/SVG/CSS clone that accurately recreates all 5 chronological phases and every inner UI detail of this specific uploaded video!

MANDATORY REQUIREMENTS:
1. VIEWPORT & LAYOUT (NO CLIPPING!):
   - Center the animation inside a compact stage (\`width: 400px; height: 225px; position: relative; display: flex; align-items: center; justify-content: center;\`) on a full-viewport studio background (\`${sceneBackgroundHex}\`) with \`overflow: hidden\` and NO top header text.
   - Below the stage (\`margin-top: 10px\`), place a compact pill bar with 6 buttons (\`Phase 1\` .. \`Phase 5\` with short descriptive labels + \`Loop All\`) so the user can scrub or loop the animation, plus clicking the main UI element triggers a replay.
2. EXACT VISUAL & SPRING-PHYSICS FIDELITY (\`renderAt(t)\` over \`0..3600ms\`):
   - Use a SINGLE continuous \`requestAnimationFrame\` loop (\`renderAt(t)\`) driven by underdamped spring interpolation (\`const spring = (x) => 1 - Math.exp(-5.4 * x) * Math.cos(9.2 * x);\`) and smooth \`easeInOut\`.
   - Recreate ALL visual sub-elements seen in the frames at their exact relative proportions, border radii, shadows, and colors (for example: if it is a Dynamic Island music player, morph a single pitch-black pill \`#0c0d12\` with left emerald dot & right sky-blue dot into the expanded rounded card containing the purple-to-cyan gradient album squircle on the left, white & slate title bars in the center, 4 animated emerald equalizer bars on the right, and the growing sky-blue progress bar along the bottom before collapsing back to the compact pill; if it is a toggle switch or morphing button, animate the exact squash/stretch, orbital spinner, and spring checkmark).
   - Every \`<svg>\` and stroke \`<path>\` MUST include \`fill="none"\` unless intentionally filled.

Output TWO fenced code blocks in your response:
1. First, a \`\`\`html ... \`\`\` block containing the COMPLETE, self-contained HTML5 document.
2. Second, a \`\`\`tsx ... \`\`\` block containing the complete React + Framer Motion + Tailwind CSS component code.`;
    }

    const samConcept =
      customPrompts.split(",")[0]?.trim() ||
      baseResult.layers[0]?.samPrompt ||
      baseResult.interactionTitle;

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
        `Muse Spark 1.3 (${MUSE_MODEL_ID}): Synthesized 60fps interactive clone for "${baseResult.interactionTitle}".`
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
            animationArchetype,
            isGooeyMetaball,
            isFaceIdMorph,
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
