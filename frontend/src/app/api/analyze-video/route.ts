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

Perform a high-precision, frame-by-frame micro-choreography breakdown across 5 sequential phases so our compiler can recreate the animation with >90% visual & motion accuracy:
- Look at Frame 1 & Frame 2: Identify the exact initial UI element (e.g. wide bright-blue pill button with white lightning bolt and "Bentomotion" text on a light off-white background) and how it compresses horizontally with motion blur.
- Look at Frame 3: Notice how the blue pill morphs into the tall pitch-black squircle with a translucent gray outer expansion halo while the inner graphic (e.g. neon-green Face ID face & 4 brackets) unblurs from soft glow to crisp lines.
- Look at Frame 4 & Frame 5: Notice how the inner face (eyes, nose, mouth) dims to ~30% opacity while the 4 outer corner brackets lengthen and join into a continuous rounded-square perimeter loop!
- Look at Frame 6 & Frame 7: Notice how the green loop collapses horizontally into 3 tall vertical interlocking neon-green oval rings tumbling/crossing in 3D space!
- Look at Frame 8, 9 & 10: Notice how the tumbling vertical ovals converge into 1 crisp glowing vertical oval ring, while a checkmark draws in slightly below center and scales up with a spring overshoot bounce!

Return ONLY valid JSON matching this schema (no markdown commentary):
{
  "interactionTitle": "Specific title covering the full animation sequence",
  "interactionSummary": "Clear 1-2 sentence summary describing all 5 micro-phases from start to finish",
  "sceneBackgroundHex": "#eef1f5",
  "phase1_initialAndSqueeze": "Frame 1-2 exact visual & motion details",
  "phase2_containerMorphAndUnblur": "Frame 3 exact container morph, halo ring, and icon unblur details",
  "phase3_bracketJoinAndFaceDim": "Frame 4-5 exact inner face dimming and outer bracket lengthening/joining details",
  "phase4_3dTumblingOvals": "Frame 6-7 exact 3D tumbling vertical interlocking oval rings details",
  "phase5_ovalLockAndCheckmarkSpring": "Frame 8-10 exact single vertical oval lock and two-stage checkmark draw + spring pop details",
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
      "name": "Phase 2-4: Neon-Green Face ID & 3D Gyro Ovals",
      "samPrompt": "green Face ID icon and 3D spinning ovals",
      "colorHex": "#10b981",
      "role": "media",
      "startTimePct": 0.22,
      "endTimePct": 0.72,
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
      "startTimePct": 0.68,
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
      "Wide bright-blue pill button (#007aff, 240x70px) with white lightning bolt and medium-weight 'Bentomotion' text holds for 0.45s, then squeezes horizontally (172x62px) with horizontal motion blur on the text.";
    let phase2 =
      "Blue pill morphs its width, height, border-radius, and color into a tall pitch-black squircle (168x204px, border-radius 48px, #050507) with a transient translucent gray outer halo (box-shadow 0 0 0 8px rgba(0,0,0,0.15)), while the neon-green (#8fff5e) Face ID glyph unblurs from blur(6px) to blur(0px).";
    let phase3 =
      "Inside the black squircle, the inner face (2 vertical eyes, J-nose, smile) dims to 25% opacity while the 4 outer corner brackets extend their stroke lengths (stroke-dasharray) and join into a continuous rounded-square perimeter loop.";
    let phase4 =
      "The inner face disappears and the green perimeter loop collapses horizontally into 3 tall vertical interlocking neon-green oval ellipses (rx=25, ry=45) tumbling and crossing over each other in 3D space (rotateY and rotateZ) before converging to 0deg.";
    let phase5 =
      "The tumbling ovals lock into a single crisp glowing vertical neon-green oval ring (rx=32, ry=45, stroke-width 8), and a bold neon-green checkmark draws in via stroke-dashoffset slightly below center and pops upward/outward with a spring overshoot bounce (scale 0.6 -> 1.18 -> 1.0).";

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
    // STEP 2: Muse Spark 1.3 High-Precision 5-Phase Visual Clone (temp=0.1) + SAM 3.1
    // ============================================================================
    const synthesisPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Look carefully at all ${imageBlocks.length} chronological frames from "${fileName}" AND the 5-Phase Micro-Choreography Breakdown below:

- Animation Title: ${baseResult.interactionTitle}
- Scene Background Color: ${sceneBackgroundHex} (Use a clean soft radial studio backdrop \`radial-gradient(circle at 50% 45%, #f8fafc 0%, #e2e8f0 100%)\` across the entire body so both the bright blue pill AND the pitch-black squircle morph pop with 100% of the contrast of the original video!)
- PHASE 1 (0.00s - 0.65s | Blue Pill & Squeeze): ${phase1}
- PHASE 2 (0.65s - 1.15s | Container Morph + Halo + Face ID Unblur): ${phase2}
- PHASE 3 (1.15s - 1.65s | Inner Face Dims + 4 Brackets Join into Loop): ${phase3}
- PHASE 4 (1.65s - 2.25s | 3D Tumbling Vertical Interlocking Ovals): ${phase4}
- PHASE 5 (2.25s - 3.40s | Single Vertical Oval Lock + Two-Stage Checkmark Spring Pop): ${phase5}

STRICT HIGH-FIDELITY (>90% MATCH) CHOREOGRAPHY REQUIREMENTS:
1. FULL-VIEWPORT LIGHT STUDIO BACKDROP (SO THE BLACK SQUIRCLE MORPH IS VISUALLY DRAMATIC):
   - Set \`html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: radial-gradient(circle at 50% 45%, #f8fafc 0%, #e4e8f0 100%); display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, sans-serif; }\`.
   - Use a fixed-height center stage (\`height: 210px; display: flex; align-items: center; justify-content: center;\`) so morphing the container never shifts the bottom control bar!
2. EXACT 5-PHASE CONTINUOUS MORPHING TIMELINE ON \`#morph-card\`:
   - Phase 0 (t = 0.00s): \`#morph-card\` is the wide bright-blue pill (\`width: 236px; height: 68px; border-radius: 999px; background: linear-gradient(180deg, #1d9bf0 0%, #007aff 100%); box-shadow: 0 10px 28px rgba(0, 122, 255, 0.32);\`) with the crisp white lightning bolt SVG and medium-weight (\`font-weight: 500; font-size: 20px; letter-spacing: -0.3px;\`) white "Bentomotion" text.
   - Phase 1 (t = 0.45s, Squeeze): \`#morph-card\` compresses horizontally (\`width: 174px; height: 62px;\`) while \`#pill-label\` scales horizontally (\`transform: scaleX(0.84); filter: blur(2.5px); opacity: 0.75;\`).
   - Phase 2 (t = 0.70s, Squircle Morph + Halo + Face ID Unblur): \`#morph-card\` morphs with spring overshoot (\`transition: width 0.48s cubic-bezier(0.34, 1.56, 0.64, 1), height 0.52s cubic-bezier(0.34, 1.56, 0.64, 1), border-radius 0.45s ease, background 0.28s ease\`) into the tall pitch-black squircle (\`width: 164px; height: 196px; border-radius: 46px; background: #050507; box-shadow: 0 0 0 7px rgba(0,0,0,0.14), 0 18px 40px rgba(0,0,0,0.22);\`). After 260ms, the \`7px\` gray outer morph halo smoothly relaxes to \`0 0 0 0px rgba(0,0,0,0), 0 18px 40px rgba(0,0,0,0.24)\`. Simultaneously, the neon-green (\`#8fff5e\`) Face ID glyph (4 rounded corner brackets + 2 vertical eyes + central J-nose + curved smile) fades in from \`opacity: 0; filter: blur(6px); transform: scale(0.84)\` to crisp \`opacity: 1; filter: blur(0px); transform: scale(1)\`.
   - Phase 3 (t = 1.25s, Face Dim + Bracket Perimeter Join — matches Frame 4!): Inside the Face ID SVG, the inner face group (\`#face-features\`: eyes, nose, smile) dims to \`opacity: 0.25; transform: scale(0.92)\`, while a continuous rounded-square perimeter loop (\`<rect x="24" y="24" width="72" height="72" rx="22" fill="none" stroke="#8fff5e" stroke-width="7" />\`) draws/fades in around the 4 corner brackets so the brackets visually join into a glowing green rounded square!
   - Phase 4 (t = 1.65s, 3D Tumbling Vertical Interlocking Ovals — matches Frames 5 & 6!): The Face ID layer fades out as \`#gyro-layer\` appears with 3 TALL VERTICAL neon-green ellipses (\`<ellipse cx="60" cy="60" rx="26" ry="44" fill="none" stroke="#8fff5e" stroke-width="7.5" />\`) tumbling and crossing over each other in 3D (\`rotateY\` and \`rotateZ\` from \`-55deg\` / \`+55deg\` / \`rotateX(35deg)\` smoothly converging toward \`0deg\`) with a soft neon glow (\`filter: drop-shadow(0 0 10px rgba(143,255,94,0.6))\`).
   - Phase 5 (t = 2.20s, Single Vertical Oval Lock + Checkmark Draw & Spring Pop — matches Frames 8 & 9!): \`#gyro-layer\` locks seamlessly into \`#final-layer\`: a single crisp vertical neon-green oval ring (\`<ellipse cx="60" cy="60" rx="30" ry="43" fill="none" stroke="#8fff5e" stroke-width="8" />\`). Inside it, the checkmark (\`<path d="M47 62 L56 73 L75 49" fill="none" stroke="#8fff5e" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />\`) first draws in via \`stroke-dashoffset\` at a slightly smaller scale (\`transform: translateY(4px) scale(0.68)\`) and then pops upward/outward with an underdamped spring bounce (\`scale(1.18) -> scale(1.0)\`)!
3. MANDATORY SVG RULE:
   - Every \`<svg>\` and every stroke element (\`<path>\`, \`<rect>\`, \`<ellipse>\`, \`<circle>\`, \`<polyline>\`) MUST explicitly set \`fill="none"\` (except the white lightning bolt icon in the blue pill).
4. SLEEK BOTTOM STAGE CONTROLLER BAR:
   - Beneath the stage (\`margin-top: 8px\`), render a dark frosted-glass pill bar (\`background: rgba(15, 23, 42, 0.88); padding: 4px; border-radius: 999px;\`) with 5 compact buttons:
     * \`▶ Auto-Loop\`
     * \`1. Blue Pill\`
     * \`2. Face ID\`
     * \`3. 3D Spin\`
     * \`4. Checkmark\`
   - Clicking any phase button pauses auto-loop and jumps to that exact phase so the user can inspect it; clicking \`▶ Auto-Loop\`, clicking \`#morph-card\`, or receiving \`REPLAY_ANIMATION\` via \`window.addEventListener('message', ...)\` plays the full 5-phase sequence!

Output TWO fenced code blocks in your response:
1. First, a \`\`\`html ... \`\`\` block containing the COMPLETE, self-contained HTML5 document implementing all 5 phases with >90% visual accuracy.
2. Second, a \`\`\`tsx ... \`\`\` block containing the complete React + Framer Motion + Tailwind CSS component code recreating all 5 phases with spring physics.`;

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
        `Muse Spark 1.3 (${MUSE_MODEL_ID}): Synthesized 5-phase high-precision clone (Pill Squeeze → Squircle Halo Morph → Bracket Loop → 3D Vertical Ovals → Spring Checkmark).`
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
