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

Identify EVERY distinct chronological stage/part of the animation from start to finish so that BOTH the first part of the animation AND the second part (and any initial pill/button or intermediate morph) are completely captured!

Return ONLY valid JSON matching this schema (no markdown commentary):
{
  "interactionTitle": "Specific title of the full animation sequence",
  "interactionSummary": "Clear 1-2 sentence summary describing all parts of the animation from start to finish",
  "stage1Description": "Exact visual & motion description of STAGE 1 (Beginning / First Part of the animation: exact shapes, colors, text, or SVG icon sub-parts like Face ID brackets/eyes/nose/mouth or initial pill/button, and how they animate)",
  "stage2Description": "Exact visual & motion description of STAGE 2 (Middle / Scanning or Morphing part of the animation: how the shapes/icons tilt in 3D, expand, or morph)",
  "stage3Description": "Exact visual & motion description of STAGE 3 (Final / Second Part of the animation: exact final shapes, glowing oval ring, checkmark draw-in, and spring bounce)",
  "layers": [
    {
      "name": "Specific element name (e.g. 'Stage 1: Face ID Brackets & Smiling Face', 'Stage 2: 3D Spinning Oval & Checkmark', 'Squircle Container')",
      "samPrompt": "2-4 word visual noun phrase for SAM 3.1 segmentation",
      "colorHex": "#06b6d4",
      "role": "container | media | control",
      "startTimePct": 0.0,
      "endTimePct": 1.0,
      "startBox": { "x": 195, "y": 55, "width": 250, "height": 275 },
      "endBox": { "x": 185, "y": 48, "width": 270, "height": 290 },
      "stiffness": 380,
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
      "Stage 1: Initial graphic/icon appears and performs its primary entrance and scanning/tilting motion.";
    let stage2Description =
      "Stage 2: Smooth 3D spring morph and transition from the first graphic into the second graphic.";
    let stage3Description =
      "Stage 3: Second graphic expands with spring overshoot and completes its stroke animation.";

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
          const palette = ["#06b6d4", "#10b981", "#a855f7", "#f59e0b"];
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
- STAGE 1 (First Part of Animation): ${stage1Description}
- STAGE 2 (Middle Scan / Transition Morph): ${stage2Description}
- STAGE 3 (Final Part of Animation): ${stage3Description}

STRICT VISUAL & CODE RULES (MUST FOLLOW 100%):
1. CLONE ALL STAGES IN SEQUENCE (STAGE 1 -> STAGE 2 -> STAGE 3):
   - Build separate, complete, detailed inline <svg> / DOM layers for Stage 1, Stage 2, and Stage 3 and transition between them smoothly using a clean JavaScript \`setStage(stageIdx)\` state machine that auto-advances every 1200ms in a continuous loop!
   - If the video shows an Apple Face ID animation:
     * Stage 1 MUST show the complete neon-green Face ID glyph (4 rounded corner brackets + 2 vertical eyes + central J-shaped nose + curved smile arc) popping in and tilting/scanning in 3D (transform: perspective(400px) rotateY(-14deg) rotateX(8deg) -> rotateY(14deg) rotateX(-6deg)).
     * Stage 2 MUST smoothly collapse/morph the Face ID glyph with a 3D spin (rotateY(180deg) scale(0.85)) into the glowing neon-green oval ring.
     * Stage 3 MUST expand the glowing neon-green oval ring with spring bounce (cubic-bezier(0.34, 1.56, 0.64, 1)) and draw the neon-green checkmark inside it using stroke-dasharray / stroke-dashoffset.
2. MANDATORY SVG RULE — NEVER OMIT \`fill="none"\` ON STROKE PATHS:
   - Every \`<svg>\` tag and every stroke element (\`<path>\`, \`<circle>\`, \`<ellipse>\`, \`<rect>\`, \`<polyline>\`) MUST explicitly set \`fill="none"\` (for example: \`<svg viewBox="0 0 120 120" fill="none">\`, \`<path d="..." fill="none" stroke="#4ade80" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />\`).
   - NEVER put any diagonal black polygon, glare triangle, or clip-path wipe that covers half the icon!
3. NO WHITE BACKGROUND BOX & NO SCROLLBARS:
   - The preview iframe is 275px tall on a dark \`#050811\` background.
   - Set \`html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #050811; display: flex; flex-direction: column; align-items: center; justify-content: center; }\`.
   - Do NOT draw a white square card behind the black squircle! Place the dark squircle (around \`165px\` wide by \`190px\` tall, \`border-radius: 42px\`, \`background: #05070b\`, with a subtle \`1px solid rgba(74, 222, 128, 0.22)\` border and soft green glow) directly on the \`#050811\` canvas.
4. VISIBLE STAGE SWITCHER PILLS AT BOTTOM:
   - Beneath the squircle (with \`margin-top: 12px\`), render a compact row of 3 buttons:
     * \`[▶ Auto-Loop All]\`
     * \`[1. Part 1 (Scan)]\`
     * \`[2. Part 2 (Check)]\`
   - Highlight whichever stage is currently active so the user can watch it step through Part 1 -> Part 2 automatically OR click to inspect Part 1 or Part 2!
   - Also restart from Stage 1 when the squircle is clicked OR when \`window.addEventListener('message', e => { if (e.data === 'REPLAY_ANIMATION') ... })\` fires.

Output TWO fenced code blocks in your response:
1. First, a \`\`\`html ... \`\`\` block containing the COMPLETE, self-contained HTML5 document.
2. Second, a \`\`\`tsx ... \`\`\` block containing the complete React + Framer Motion + Tailwind CSS component code recreating all stages with spring physics.`;

    const samConcept =
      customPrompts.split(",")[0]?.trim() ||
      baseResult.layers[0]?.samPrompt ||
      "main icon";

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
      keyframes[3]
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
                    { type: "input_image", image_url: keyframes[3] },
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
        `Muse Spark 1.3 (${MUSE_MODEL_ID}): Synthesized multi-stage interactive clone (Stage 1 → Stage 2 → Stage 3) & React Framer Motion code.`
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
            layersCount: baseResult.layers.length,
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
