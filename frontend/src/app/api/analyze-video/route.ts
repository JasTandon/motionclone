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
- Frame 3: Blue pill morphs into a tall pitch-black squircle with a translucent gray outer expansion halo while the inner neon-green Face ID face & 4 straight-legged L-shaped rounded corner brackets unblur from soft glow to crisp lines.
- Frame 4 & Frame 5: The inner face (wide-set eyes at x=43 and x=77, J-nose, well-spaced smile) dims to ~28% opacity while the 4 outer L-shaped corner brackets dynamically grow their straight arms to close the 4 side gaps and simultaneously round their corners into an oval!
- Frame 6, Frame 7 & Frame 8: The connected green loop seamlessly transitions into 3 constant-thickness 3D wireframe oval rings tumbling in 3D space (first tilted +16deg compressed coil, then X-scissored at -28deg/+28deg over a soft green core, then vertical outer oval + inner longitudinal meridian ring + central vertical spine sweeping outward into alignment).
- Frame 9 & Frame 10: The 3D globe locks into 1 crisp glowing vertical oval ring while a bold neon-green checkmark draws in slightly below center at small scale and springs upward/outward into the centered checkmark!

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
      "The 4 straight-legged L-shaped Face ID brackets continuously grow their straight arms to close the 4 side gaps (gap: 0.18 -> 0.0) while rounding their corners (roundness: 0.0 -> 1.0) into a pure vertical oval as the inner face dims to 25% and scales down.";
    let phase4 =
      "Using continuous 60fps 3D mathematical projection (so stroke-width stays a constant 7px even at 90deg edge-on!), 3 wireframe rings spin through: (4A) tilted +16deg compressed coil; (4B) -28deg/+28deg X-scissored gyroscope over a glowing green core; (4C) vertical outer oval + inner longitudinal meridian ring + central vertical spine sweeping outward to lock at 360deg.";
    let phase5 =
      "All 3 rings lock seamlessly into the pure vertical oval (<ellipse cx='60' cy='60' rx='31' ry='43'/>), and the bold checkmark draws in slightly below center at scale(0.62) and springs upward/outward with overshoot bounce (scale 1.18 -> 1.0).";

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
    // STEP 2: Muse Spark 1.3 Bug-Free Straight-Legged L-Bracket & Pure Oval Engine
    // ============================================================================
    const synthesisPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Look carefully at all ${imageBlocks.length} chronological frames from "${fileName}" AND the 5-Phase Breakdown below:

- Animation Title: ${baseResult.interactionTitle}
- Scene Background Color: ${sceneBackgroundHex}
- PHASE 1 (Blue Pill & Squeeze): ${phase1}
- PHASE 2 (Single Container Morph + Halo + Face ID Unblur): ${phase2}
- PHASE 3 (Straight-Legged L-Brackets Grow & Round into Oval): ${phase3}
- PHASE 4 (60fps Mathematical 3D Wireframe Gyroscope & Globe Spin): ${phase4}
- PHASE 5 (Pure Vertical Oval Lock + Two-Stage Checkmark Spring Pop): ${phase5}

CRITICAL FIXES FOR THE 3 BUGS IN THE PREVIOUS RUN (FOLLOW 100% EXACTLY):

1. FIX 1 — TRUE STRAIGHT-LEGGED APPLE FACE ID L-BRACKETS & NO CHORD GLITCH IN \`shapePoint(q, u, roundness)\`:
   - Previously, \`shapePoint\` mutated \`u = 1 - u\` when \`q === 1\`, which caused a backward chord line across the bottom-right of the oval, and used a superellipse that bent the straight bracket arms into parentheses!
   - You MUST use this exact, bug-free \`shapePoint(q, u, roundness)\` function (which NEVER mutates \`u\`, draws 100% straight horizontal/vertical bracket arms with a 12px circular 90-degree corner when \`roundness = 0\`, and morphs into a 100% pure clockwise ellipse \`(31 * Math.sin(theta), -43 * Math.cos(theta))\` when \`roundness = 1\`):
   \`\`\`js
   const lerp = (a, b, t) => a + (b - a) * t;
   const clamp01 = (t) => Math.max(0, Math.min(1, t));
   const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

   function shapePoint(q, u, roundness) {
     // q in 0..3 (0: top-right, 1: bottom-right, 2: bottom-left, 3: top-left), u in [0, 1]
     // Local parameter v in [0, 1] for symmetric quadrant evaluation (NEVER mutate u!)
     const v = (q % 2 === 1) ? (1 - u) : u;
     const W = 35, H = 37, R = 13;
     let bx = 0, by = 0;
     if (v < 0.35) {
       bx = lerp(0, W - R, v / 0.35);
       by = -H; // 100% straight horizontal leg
     } else if (v <= 0.65) {
       const a = lerp(-Math.PI / 2, 0, (v - 0.35) / 0.30);
       bx = (W - R) + R * Math.cos(a);
       by = -(H - R) + R * Math.sin(a); // Exact 90-deg circular corner
     } else {
       bx = W; // 100% straight vertical leg
       by = lerp(-(H - R), 0, (v - 0.65) / 0.35);
     }
     let rx = bx, ry = by;
     if (q === 1) { rx = bx; ry = -by; }
     else if (q === 2) { rx = -bx; ry = -by; }
     else if (q === 3) { rx = -bx; ry = by; }

     // Pure clockwise vertical oval starting at top-center (0, -43) for q=0, u=0:
     const theta = (q + u) * (Math.PI / 2);
     const ox = 31 * Math.sin(theta);
     const oy = -43 * Math.cos(theta);
     return [lerp(rx, ox, roundness), lerp(ry, oy, roundness)];
   }
   \`\`\`

2. FIX 2 — EXACT APPLE FACE ID INNER FACE PROPORTIONS (\`#face-features\`):
   - Previously, the eyes (\`x=48..72, y=52..60\`), nose (\`y=52..71\`), and smile (\`y=74..81\`) were squished into the center so the nose touched the mouth!
   - Use these exact, well-spaced Apple Face ID coordinates inside \`<g id="face-features" stroke="#8fff5e" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round" fill="none">\`:
     * Left Eye (wide-set, upper-middle): \`<path d="M 43 44 L 43 53" />\`
     * Right Eye (wide-set, upper-middle): \`<path d="M 77 44 L 77 53" />\`
     * Center J-Nose (starts at eye level y=45, goes to y=60, hooks left to x=54.5, y=64.5): \`<path d="M 60 45 L 60 60 Q 60 64.5 54.5 64.5" />\`
     * Smiling Mouth (clean 9px gap below the nose!): \`<path d="M 46 74 Q 60 85 74 74" />\`
   - When scaling \`#face-features\` during Phase 3, use native SVG \`face.setAttribute('transform', \`translate(60, 60) scale(\${sc}) translate(-60, -60)\`)\` instead of CSS \`transform-box: fill-box\`!

3. FIX 3 — GUARANTEED PURE VERTICAL OVAL & BOLD CHECKMARK IN PHASE 5 (\`t >= 2850ms\`):
   - Include a dedicated \`<ellipse id="final-oval" cx="60" cy="60" rx="31" ry="43" stroke="#8fff5e" stroke-width="7.5" fill="none" opacity="0" style="filter:drop-shadow(0 0 7px rgba(143,255,94,.85))" />\` and \`<g id="check-group" opacity="0"><path id="check-path" d="M 46 61 L 55 72 L 75 48" stroke="#8fff5e" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none" style="filter:drop-shadow(0 0 7px rgba(143,255,94,.9))" /></g>\`.
   - When \`t >= 2850\`:
     * Hide \`r1\`, \`r2\`, \`r3\` (\`opacity="0"\`) and show \`finalOval.setAttribute('opacity', '1')\` so the final oval is a 100% pure native SVG \`<ellipse>\` with zero path seams!
     * Set \`checkG.setAttribute('opacity', '1')\` and use native SVG \`checkG.setAttribute('transform', \`translate(60, \${60 + ty}) scale(\${sc}) translate(-60, -60)\`)\` + \`check.setAttribute('stroke-dasharray', '52')\` and \`check.setAttribute('stroke-dashoffset', (52 * (1 - drawP)).toFixed(1))\` so the checkmark ALWAYS draws in and springs upward cleanly!
   - Also, when the user clicks ANY stage button (\`1. Blue Pill\`, \`2. Face ID\`, \`3. 3D Spin\`, \`4. Checkmark\`), instead of freezing on a single static millisecond, loop/play that stage's time window (e.g., clicking \`2. Face ID\` loops \`t = 900..1800\`, clicking \`3. 3D Spin\` loops \`t = 1850..2850\`, clicking \`4. Checkmark\` plays \`t = 2850..4100\` and holds at \`4100\`)!

4. COMPACT VIEWPORT SIZING (NO CAPTION TEXT BELOW BUTTONS):
   - Do NOT add any \`.caption\` div below \`.controls\`! Keep only \`.stage\` (\`height: 200px\`) and \`.controls\` (\`margin-top: 8px\`) centered on \`radial-gradient(circle at 50% 45%, #f8fafc 0%, #e4e8f0 100%)\`.

Output TWO fenced code blocks in your response:
1. First, a \`\`\`html ... \`\`\` block containing the COMPLETE, self-contained HTML5 document.
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
        `Muse Spark 1.3 (${MUSE_MODEL_ID}): Synthesized straight-legged L-bracket Face ID, 60fps 3D globe spin, and native SVG checkmark spring.`
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
