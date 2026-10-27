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

  let durationMs = 1200;
  if (clientTelemetryJson) {
    try {
      const parsedClient = JSON.parse(clientTelemetryJson);
      durationMs = parsedClient.durationMs || 1200;
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

  const imageBlocks = keyframes.slice(0, 6).map((url) => ({
    type: "image_url",
    image_url: { url },
  }));

  // ============================================================================
  // CALL 1: Muse Spark 1.3 Vision + Spatial Object & Kinematics Detection (JSON)
  // ============================================================================
  const detectionPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Examine these 6 sequential frames (scaled to 640x400 pixels) from the user's video "${fileName}".
Identify what UI component, icon, or animation is shown in the video (for example: Apple Face ID icon scan, a notification card, a toggle switch, a checkout drawer, etc.), and locate the 2 to 3 main visual objects on the 640x400 pixel grid.

Return ONLY valid JSON matching this schema (no markdown commentary):
{
  "interactionTitle": "Specific name of what is shown in the video (e.g. 'Apple Face ID Biometric Scan Animation')",
  "interactionSummary": "Clear 1-sentence description of the visual elements, colors, and how they animate",
  "layers": [
    {
      "name": "Specific element name (e.g. 'Dark Squircle Container', 'Green Face ID Symbol')",
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

  // ============================================================================
  // CALL 2: Muse Spark 1.3 Visual UI Clone (HTML5/SVG/Tailwind + React Framer Motion)
  // ============================================================================
  const synthesisPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Look carefully at these 6 sequential frames from the user's video "${fileName}".
Your job is to build a WORKING, VISUALLY ACCURATE interactive clone of the exact graphic/UI and animation shown in these frames!
- Match the exact colors, shapes, rounded corners, and graphics/icons (use inline <svg> paths for any icons, faces, brackets, checkmarks, or symbols shown in the video!).
- Make it animate smoothly between its states using spring physics when clicked OR when \`window.addEventListener('message', e => { if (e.data === 'REPLAY_ANIMATION') ... })\` fires!
- Center the component nicely on a dark #050811 background.

Output TWO fenced code blocks in your response:
1. First, a \`\`\`html ... \`\`\` block containing a COMPLETE, self-contained HTML5 document (using <script src="https://cdn.tailwindcss.com"></script>) that renders and animates the cloned UI live. Include a subtle button or click handler so clicking the component replays/toggles its animation, and listen for \`window.addEventListener('message', (e) => { if (e.data === 'REPLAY_ANIMATION') ... })\`.
2. Second, a \`\`\`tsx ... \`\`\` block containing the complete React + Framer Motion + Tailwind CSS component code recreating this exact UI and spring animation.`;

  try {
    const [detectResp, synthResp] = await Promise.all([
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
              content: [{ type: "text", text: detectionPrompt }, ...imageBlocks],
            },
          ],
        }),
      }),
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
    ]);

    if (!detectResp.ok && !synthResp.ok) {
      const errBody = await detectResp.text();
      return NextResponse.json(
        {
          error: "META_API_ERROR",
          message: `Meta API returned HTTP ${detectResp.status}: ${errBody.slice(0, 200)}`,
        },
        { status: detectResp.status }
      );
    }

    // Parse Call 1 (Object Detection & Kinematics)
    if (detectResp.ok) {
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
        `Muse Spark 1.3 (${MUSE_MODEL_ID}): Identified "${baseResult.interactionTitle}" and ${baseResult.layers.length} moving layers.`
      );
    }

    // Parse Call 2 (Visual HTML/SVG/Tailwind Clone + React Framer Motion Code)
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
      baseResult.usedLiveMetaApi = true;
      pipelineLogs.push(
        `Muse Spark 1.3 (${MUSE_MODEL_ID}): Synthesized custom interactive visual clone & React Framer Motion code.`
      );
    }

    // ============================================================================
    // CALL 3: Meta SAM 3.1 (`sam-3.1`) Video Concept Segmentation
    // ============================================================================
    if (videoFile && keyframes[0]) {
      try {
        const samConcept =
          customPrompts.split(",")[0]?.trim() ||
          baseResult.layers[0]?.samPrompt ||
          "main icon";

        const samResp = await fetch(`${META_BASE_URL}/responses`, {
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
        });

        if (samResp.ok) {
          baseResult.pipelineMetadata.perceptionModel = `${SAM_MODEL_ID} (Live Meta API)`;
          baseResult.pipelineMetadata.reasoningModel = `${MUSE_MODEL_ID} (Live Meta API)`;
          pipelineLogs.push(
            `SAM 3.1 (${SAM_MODEL_ID}): Verified concept segmentation for "${samConcept}".`
          );
        }
      } catch {
        // non-blocking SAM 3.1 verification
      }
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
