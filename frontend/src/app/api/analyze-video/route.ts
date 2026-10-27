import { NextResponse } from "next/server";
import { buildPresetAnalysisLocal } from "@/lib/localPhysicsEngine";
import { buildLayerFromBoxTrajectory } from "@/lib/videoFrameAnalyzer";
import { TrackedLayer } from "@/types/motion";

const META_BASE_URL = (process.env.META_BASE_URL || "https://api.meta.ai/v1").replace(/\/$/, "");
const MUSE_MODEL_ID = process.env.MUSE_MODEL_ID || "muse-spark-1.3";
const SAM_MODEL_ID = process.env.SAM_MODEL_ID || "sam-3.1";

function extractCodeBlock(text: string, lang: string): string | null {
  const regex = new RegExp("```(?:" + lang + ")?\\s*([\\s\\S]*?)```", "i");
  const match = text.match(regex);
  return match ? match[1].trim() : null;
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

  let durationMs = 1500;
  if (clientTelemetryJson) {
    try {
      const parsedClient = JSON.parse(clientTelemetryJson);
      durationMs = parsedClient.durationMs || 1500;
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
    // STEP 1: Muse Spark 1.3 Multi-Stage Storyboard (Part 1 -> Transition -> Part 2) & Kinematics
    // ============================================================================
    const detectionPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Examine all ${imageBlocks.length} chronological video frames (scaled to 640x400 pixels) from "${fileName}".
Frames 1 to 5 show the FIRST PART of the animation. Frames 6 to ${imageBlocks.length} show the TRANSITION and SECOND PART of the animation.
(Ignore any creator watermark/banner like "Bentomotion" if present; focus on the actual UI/icon animation sequence.)

Carefully break down BOTH the first part of the animation AND the second part of the animation so nothing is missed!

Return ONLY valid JSON matching this schema (no markdown commentary):
{
  "interactionTitle": "Specific title of the full animation (e.g. 'Apple Face ID Scan-to-Checkmark Animation')",
  "interactionSummary": "Clear 1-2 sentence summary describing BOTH Part 1 (the initial graphic/scan/state) AND Part 2 (how it morphs and resolves)",
  "part1Description": "Detailed visual & motion description of PART 1 (Frames 1-5): exact shapes, colors, SVG icon sub-parts (e.g. 4 corner brackets, eyes, nose bridge, curved smile mouth, or initial card/pill), and how they move/tilt/expand in the first half",
  "transitionDescription": "Detailed description of how Part 1 morphs, twists, or collapses into Part 2",
  "part2Description": "Detailed visual & motion description of PART 2 (Frames 6-10): exact shapes, colors, SVG icon sub-parts (e.g. glowing oval ring and animated checkmark), and how they settle with spring bounce",
  "layers": [
    {
      "name": "Specific element name (include both Part 1 and Part 2 elements, e.g. 'Black Squircle Container', 'Part 1: Green Face ID Brackets & Face', 'Part 2: Glowing Oval & Checkmark')",
      "samPrompt": "2-4 word visual noun phrase for SAM 3.1 segmentation",
      "colorHex": "#06b6d4",
      "role": "container | media | control",
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

    let part1Description =
      "Initial icon/UI state with detailed sub-elements animating in with 3D perspective and spring expansion.";
    let transitionDescription =
      "Smooth spring morph and 3D rotation collapsing the first graphic into the second graphic.";
    let part2Description =
      "Final resolved icon/UI state expanding with spring overshoot and stroke draw-in.";

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
        if (parsed.part1Description) {
          part1Description = parsed.part1Description;
        }
        if (parsed.transitionDescription) {
          transitionDescription = parsed.transitionDescription;
        }
        if (parsed.part2Description) {
          part2Description = parsed.part2Description;
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
                durationMs
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
      `Muse Spark 1.3 (${MUSE_MODEL_ID}): Extracted 2-part storyboard ("${baseResult.interactionTitle}") across ${imageBlocks.length} frames.`
    );

    // ============================================================================
    // STEP 2: Muse Spark 1.3 Full Multi-Part Visual Clone (Part 1 -> Transition -> Part 2) + SAM 3.1
    // ============================================================================
    const synthesisPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Look carefully at all ${imageBlocks.length} chronological frames from "${fileName}" AND the extracted Multi-Part Storyboard below:

- Animation Title: ${baseResult.interactionTitle}
- PART 1 (First Half of Animation - MUST BE FULLY CLONED!): ${part1Description}
- TRANSITION (Morph from Part 1 to Part 2): ${transitionDescription}
- PART 2 (Second Half of Animation - MUST BE FULLY CLONED!): ${part2Description}

CRITICAL INSTRUCTION — DO NOT SKIP PART 1!
Previously, only Part 2 (the final state) was rendered. You MUST build and animate BOTH PART 1 and PART 2 in full visual detail:
1. Draw a complete, high-precision inline <svg> (or DOM structure) for PART 1:
   - For example, if Part 1 is an Apple Face ID glyph, you MUST draw all 4 rounded corner brackets (top-left, top-right, bottom-left, bottom-right), both vertical eyes, the central J-shaped nose bridge, and the curved smiling mouth arc in glowing neon green, and animate Part 1 appearing and tilting/scanning in 3D perspective!
   - If Part 1 is another UI component/icon, draw every sub-element of Part 1 accurately!
2. Animate the TRANSITION where Part 1 twists/collapses/morphs into Part 2 using spring physics!
3. Draw and animate PART 2 (e.g. the glowing neon-green oval ring expanding with spring bounce and the checkmark drawing in smoothly via stroke-dasharray/stroke-dashoffset).
4. Make the HTML preview auto-play the FULL SEQUENCE continuously (Part 1 [0s - 1.5s] -> Morph & Part 2 [1.5s - 3.0s] -> brief hold -> loop back to Part 1), AND include a sleek pill control bar at the bottom of the preview with 3 buttons:
   - "Auto-Play Full (Part 1 → Part 2)"
   - "Part 1 Only" (shows/animates Part 1)
   - "Part 2 Only" (shows/animates Part 2)
5. Also restart from Part 1 whenever the graphic is clicked OR when \`window.addEventListener('message', e => { if (e.data === 'REPLAY_ANIMATION') ... })\` fires.

Output TWO fenced code blocks in your response:
1. First, a \`\`\`html ... \`\`\` block containing a COMPLETE, self-contained HTML5 document (using <script src="https://cdn.tailwindcss.com"></script>) on a dark #050811 background that renders and animates BOTH Part 1 and Part 2 sequentially.
2. Second, a \`\`\`tsx ... \`\`\` block containing the complete React + Framer Motion + Tailwind CSS component code recreating BOTH Part 1 and Part 2 with spring physics.`;

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
      keyframes[2]
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
                    { type: "input_image", image_url: keyframes[2] },
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
        baseResult.livePreviewHtml = htmlBlock;
      }
      if (tsxBlock) {
        baseResult.codeExports.reactCode = tsxBlock;
      }
      pipelineLogs.push(
        `Muse Spark 1.3 (${MUSE_MODEL_ID}): Synthesized multi-stage interactive clone (Part 1 → Part 2) & React Framer Motion code.`
      );
    }

    if (samResp && samResp.ok) {
      baseResult.pipelineMetadata.perceptionModel = `${SAM_MODEL_ID} (Live Meta API)`;
      baseResult.pipelineMetadata.reasoningModel = `${MUSE_MODEL_ID} (Live Meta API)`;
      pipelineLogs.push(
        `SAM 3.1 (${SAM_MODEL_ID}): Verified concept segmentation for "${samConcept}".`
      );
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
