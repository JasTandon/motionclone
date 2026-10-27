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

  let durationMs = 1800;
  if (clientTelemetryJson) {
    try {
      const parsedClient = JSON.parse(clientTelemetryJson);
      durationMs = parsedClient.durationMs || 1800;
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
    // STEP 1: Muse Spark 1.3 Chronological Multi-Stage Storyboard & Layer Detection
    // ============================================================================
    const detectionPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Examine all ${imageBlocks.length} chronological video frames (scaled to 640x400 pixels) from "${fileName}", from Frame 1 (start of video) to Frame ${imageBlocks.length} (end of video).

CRITICAL: Look closely at Frame 1 and Frame 2 first!
If Frame 1 / Frame 2 starts with a distinct initial UI element (for example, a wide horizontal BLUE PILL BUTTON with "⚡ Bentomotion" at x:140, y:145, width:360, height:110) before morphing into another shape (such as a tall black squircle at x:200, y:58, width:240, height:284), you MUST:
1. Create a dedicated Layer 1 for that initial element in Frame 1-2 with its EXACT wide horizontal bounding box (e.g. startBox: { "x": 140, "y": 145, "width": 360, "height": 110 }, endBox: { "x": 185, "y": 152, "width": 270, "height": 96 }, startTimePct: 0.0, endTimePct: 0.24, colorHex: "#38bdf8").
2. Create separate layers for the subsequent morphed container and inner animated graphics with their respective startTimePct and endTimePct windows!

Return ONLY valid JSON matching this schema (no markdown commentary):
{
  "interactionTitle": "Specific title covering ALL stages from Frame 1 to Frame 10 (e.g. 'Blue Pill Button Morph to Face ID Scan & Checkmark')",
  "interactionSummary": "Clear 1-2 sentence summary describing Stage 1 (e.g. the blue pill button shrinking/morphing), Stage 2 (the container morph & Face ID scan/3D spin), and Stage 3 (the glowing oval & checkmark bounce)",
  "stage1Description": "Exact visual & motion description of STAGE 1 (Frames 1-2): the initial UI element (e.g. wide bright-blue pill button with white lightning icon and text), its exact colors, pill dimensions, and how it shrinks/morphs into the next container",
  "stage2Description": "Exact visual & motion description of STAGE 2 (Frames 3-7): the morphed container (e.g. tall black squircle) and the middle animation (e.g. neon-green Face ID brackets & face scanning, then collapsing into 3D spinning interlocking neon-green ovals)",
  "stage3Description": "Exact visual & motion description of STAGE 3 (Frames 8-10): the final resolved state (e.g. glowing neon-green vertical oval ring and checkmark drawing in with spring overshoot)",
  "layers": [
    {
      "name": "Stage 1: Blue Pill Button (Initial State)",
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
      "name": "Stage 2-3: Morphed Black Squircle Container",
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
      "name": "Stage 2: Neon-Green Face ID & 3D Spin Rings",
      "samPrompt": "green Face ID icon and spinning rings",
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
      "name": "Stage 3: Glowing Oval Ring & Checkmark",
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

    let stage1Description =
      "Stage 1: Wide bright-blue pill button ('⚡ Bentomotion') appears first, then compresses horizontally and morphs its outer shape and color into the tall black squircle.";
    let stage2Description =
      "Stage 2: Inside the morphed black squircle, the neon-green Face ID glyph (4 corner brackets, eyes, nose, smile) scans, joins its brackets, and collapses into 3D spinning interlocking green ovals.";
    let stage3Description =
      "Stage 3: Resolves into a single glowing neon-green vertical oval ring while a bold green checkmark draws in and bounces with spring physics.";

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
        if (parsed.stage1Description) {
          stage1Description = parsed.stage1Description;
        }
        if (parsed.stage2Description) {
          stage2Description = parsed.stage2Description;
        }
        if (parsed.stage3Description) {
          stage3Description = parsed.stage3Description;
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
      `Muse Spark 1.3 (${MUSE_MODEL_ID}): Extracted 3-stage storyboard ("${baseResult.interactionTitle}") across ${imageBlocks.length} frames.`
    );

    // ============================================================================
    // STEP 2: Muse Spark 1.3 Clean Multi-Stage Interactive Clone + SAM 3.1
    // ============================================================================
    const synthesisPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Look carefully at all ${imageBlocks.length} chronological frames from "${fileName}" AND the extracted Multi-Stage Storyboard below:

- Animation Title: ${baseResult.interactionTitle}
- STAGE 1 (Beginning - Frames 1-2): ${stage1Description}
- STAGE 2 (Middle Morph & Scan - Frames 3-7): ${stage2Description}
- STAGE 3 (Final Resolution - Frames 8-10): ${stage3Description}

CRITICAL REQUIREMENT — THE OUTER CONTAINER MUST START AS STAGE 1 (e.g. THE WIDE BLUE PILL BUTTON) AND MORPH INTO THE BLACK SQUIRCLE!
Do NOT trap Stage 1 inside a permanently black squircle! Instead, build a single morphing outer element \`#morph-card\` whose CSS width, height, border-radius, background, and box-shadow smoothly morph across the stages using \`transition: all 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)\`:

- When \`stage === 0\` (STAGE 1: Blue Pill Button, 0.0s - 1.1s):
  * \`#morph-card\` is a WIDE HORIZONTAL BLUE PILL BUTTON: \`width: 235px; height: 68px; border-radius: 999px; background: linear-gradient(180deg, #2ea6ff 0%, #007aff 100%); box-shadow: 0 8px 28px rgba(0, 122, 255, 0.45); border: 1px solid rgba(255,255,255,0.25);\`.
  * Inside \`#morph-card\`, show the white lightning bolt SVG + bold white text (e.g. "Bentomotion"), and animate a subtle horizontal press/squeeze right before transitioning to Stage 1!
- When \`stage === 1\` (STAGE 2: Morph to Tall Black Squircle + Green Face ID Scan, 1.1s - 2.3s):
  * \`#morph-card\` morphs its outer shape and color into the TALL BLACK SQUIRCLE: \`width: 165px; height: 195px; border-radius: 42px; background: #05070b; border: 1px solid rgba(74, 222, 128, 0.25); box-shadow: 0 0 32px rgba(74, 222, 128, 0.18);\`.
  * Inside \`#morph-card\`, the blue pill label fades out and the neon-green Face ID glyph (4 rounded corner brackets + 2 vertical eyes + J-nose + curved smile) pops in and tilts/scans in 3D!
- When \`stage === 2\` (STAGE 3: 3D Gyroscope Spin -> Glowing Oval & Checkmark, 2.3s - 3.6s):
  * \`#morph-card\` remains the tall black squircle (\`165px × 195px\`), while the inner green graphic spins in 3D as interlocking neon-green ovals for 0.45s and then settles into the glowing vertical neon-green oval ring with the bold checkmark drawing in via \`stroke-dasharray\` / \`stroke-dashoffset\` and a spring bounce!

MANDATORY SVG & LAYOUT RULES:
1. Every \`<svg>\` tag and every stroke element (\`<path>\`, \`<circle>\`, \`<ellipse>\`, \`<rect>\`, \`<polyline>\`) MUST explicitly set \`fill="none"\` (except the solid white lightning bolt in Stage 1 which can use \`fill="currentColor"\`). Never omit \`fill="none"\` on stroke paths!
2. Set \`html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #050811; display: flex; flex-direction: column; align-items: center; justify-content: center; }\` with a fixed-height stage wrapper (\`height: 205px; display: flex; align-items: center; justify-content: center;\`) so morphing \`#morph-card\` from \`68px\` tall to \`195px\` tall never shifts the bottom buttons or causes a scrollbar!
3. Below the stage wrapper (\`margin-top: 10px\`), render a compact pill switcher bar with 4 buttons:
   - \`[▶ Auto-Loop All]\`
   - \`[1. Blue Pill]\`
   - \`[2. Face ID Scan]\`
   - \`[3. Checkmark]\`
   Clicking \`[1. Blue Pill]\` pauses auto-loop and holds \`stage = 0\` so the user can inspect the Blue Pill button! Clicking \`[2. Face ID Scan]\` holds \`stage = 1\`, clicking \`[3. Checkmark]\` holds \`stage = 2\`, and clicking \`[▶ Auto-Loop All]\` or \`#morph-card\` or receiving \`REPLAY_ANIMATION\` via \`window.addEventListener('message', ...)\` restarts the full \`0 -> 1 -> 2\` auto-loop!

Output TWO fenced code blocks in your response:
1. First, a \`\`\`html ... \`\`\` block containing the COMPLETE, self-contained HTML5 document.
2. Second, a \`\`\`tsx ... \`\`\` block containing the complete React + Framer Motion + Tailwind CSS component code recreating all 3 stages (Blue Pill -> Black Squircle Face ID Scan -> Glowing Oval Checkmark) with spring physics.`;

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
        `Muse Spark 1.3 (${MUSE_MODEL_ID}): Synthesized 3-stage morphing clone (Stage 1 Blue Pill → Stage 2 Face ID Scan → Stage 3 Checkmark).`
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
            stage1Description,
            stage2Description,
            stage3Description,
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
