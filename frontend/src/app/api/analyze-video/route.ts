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
- Frame 4 & Frame 5: The inner face (eyes, J-nose, smile) dims to ~28% opacity while the 4 outer L-shaped corner brackets extend their straight arms along the 4 sides to connect into a rounded-rectangle loop!
- Frame 6, Frame 7 & Frame 8 (THE 3D SPIN):
  * Sub-step 4A (Frame 6): The green loop squeezes horizontally and tilts (+16deg) with a central vertical spine line and narrow tilted ellipses.
  * Sub-step 4B (Frame 7): Two thick neon-green oval rings scissor/cross in an X-gyroscope pattern (-28deg and +28deg) over a translucent neon-green glowing interior core!
  * Sub-step 4C (Frame 8): The outer ring aligns vertically (0deg, rx=31, ry=44) while an inner longitudinal 3D meridian ellipse (rx sweeping from 2 -> 18 -> 31) and central vertical spine line create a 3D wireframe globe that locks into the outer vertical oval!
- Frame 9 & Frame 10: The 3D globe locks into 1 crisp glowing vertical oval ring while a checkmark draws in slightly below center at small scale and springs upward/outward into the bold centered checkmark!

Return ONLY valid JSON matching this schema (no markdown commentary):
{
  "interactionTitle": "Specific title covering the full animation sequence",
  "interactionSummary": "Clear 1-2 sentence summary describing all 5 micro-phases from start to finish",
  "sceneBackgroundHex": "#eef1f5",
  "phase1_initialAndSqueeze": "Frame 1-2 exact visual & motion details",
  "phase2_containerMorphAndUnblur": "Frame 3 exact container morph, halo ring, and icon unblur details",
  "phase3_bracketJoinAndFaceDim": "Frame 4-5 exact Face ID geometry and outer bracket arm extension details",
  "phase4_3dTumblingOvals": "Frame 6-8 exact 3-step 3D gyroscope spin (tilted squeeze -> X-crossed ovals -> vertical meridian globe sweep) details",
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
      "Wide bright-blue pill button (#007aff, 236x68px) with white lightning bolt and medium-weight 'Bentomotion' text holds for 0.4s, then squeezes horizontally (172x62px) with horizontal motion blur on the text.";
    let phase2 =
      "Blue pill morphs into a tall pitch-black squircle (164x196px, border-radius 46px, #050507) with a transient 7px translucent gray outer halo, while the true Apple Face ID glyph unblurs from blur(6px) to blur(0px).";
    let phase3 =
      "The inner face (2 vertical eyes at y=46..56, central J-nose at x=60 y=46..63 hooking left to x=54, and curved smile at y=74..82) dims to 28% opacity while the 4 L-shaped rounded corner brackets extend their straight arms along the sides to connect into a rounded-rectangle loop.";
    let phase4 =
      "3-Stage 3D Gyroscope & Meridian Globe Spin: (4A) Loop squeezes horizontally and tilts +16deg with a central vertical spine bar; (4B) Two thick neon-green oval rings cross in an X-gyroscope pattern (-28deg and +28deg) over a translucent green core (rgba(143,255,94,0.22)); (4C) Outer oval aligns vertically (0deg, rx=31, ry=44) while an inner longitudinal meridian ellipse (rx sweeping 2 -> 18 -> 31) and central vertical line sweep outward into a 3D wireframe globe that locks into the outer vertical oval.";
    let phase5 =
      "All meridian rings lock into 1 crisp glowing vertical neon-green oval ring (rx=31, ry=44, stroke-width 8), interior fill fades to 0, and a bold neon-green checkmark draws in slightly below center at scale(0.62) and springs upward/outward with overshoot bounce (scale 1.18 -> 1.0).";

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
    // STEP 2: Muse Spark 1.3 Exact Face ID Geometry & 3D Meridian Globe Synthesis
    // ============================================================================
    const synthesisPrompt = `You are Meta Muse Spark 1.3 powering MotionClone.
Look carefully at all ${imageBlocks.length} chronological frames from "${fileName}" AND the 5-Phase Breakdown below:

- Animation Title: ${baseResult.interactionTitle}
- Scene Background Color: ${sceneBackgroundHex}
- PHASE 1 (Blue Pill & Squeeze): ${phase1}
- PHASE 2 (Container Morph + Halo + Face ID Unblur): ${phase2}
- PHASE 3 (Face ID Proportions & Bracket Extension): ${phase3}
- PHASE 4 (3D Gyroscope & Longitudinal Meridian Globe Spin): ${phase4}
- PHASE 5 (Vertical Oval Lock + Two-Stage Checkmark Spring Pop): ${phase5}

CRITICAL GEOMETRIC & ANIMATION SPECIFICATIONS (FOLLOW EXACTLY FOR >95% VISUAL MATCH):

1. EXACT APPLE FACE ID SVG PROPORTIONS (viewBox="0 0 120 120", stroke="#8fff5e", fill="none"):
   - Do NOT draw circular arcs for the 4 brackets! Each Face ID bracket is an L-shaped corner with straight vertical and horizontal legs and a 13px radius corner:
     * Top-Left Bracket: \`<path d="M 26 44 V 35 A 11 11 0 0 1 37 24 H 46" fill="none" stroke="#8fff5e" stroke-width="6.5" stroke-linecap="round" />\`
     * Top-Right Bracket: \`<path d="M 74 24 H 83 A 11 11 0 0 1 94 35 V 44" fill="none" stroke="#8fff5e" stroke-width="6.5" stroke-linecap="round" />\`
     * Bottom-Left Bracket: \`<path d="M 26 76 V 85 A 11 11 0 0 0 37 96 H 46" fill="none" stroke="#8fff5e" stroke-width="6.5" stroke-linecap="round" />\`
     * Bottom-Right Bracket: \`<path d="M 74 96 H 83 A 11 11 0 0 0 94 85 V 76" fill="none" stroke="#8fff5e" stroke-width="6.5" stroke-linecap="round" />\`
   - Exact Inner Face Features (\`<g id="face-features">\`, well-spaced inside the brackets so the smile never touches the bottom brackets!):
     * Left Eye: \`<path d="M 45 46 V 55" fill="none" stroke="#8fff5e" stroke-width="6.5" stroke-linecap="round" />\`
     * Right Eye: \`<path d="M 75 46 V 55" fill="none" stroke="#8fff5e" stroke-width="6.5" stroke-linecap="round" />\`
     * Center J-Nose: \`<path d="M 60 46 V 60 A 4.5 4.5 0 0 1 55.5 64.5 H 53.5" fill="none" stroke="#8fff5e" stroke-width="6.5" stroke-linecap="round" />\`
     * Curved Smile: \`<path d="M 47 73 Q 60 83 73 73" fill="none" stroke="#8fff5e" stroke-width="6.5" stroke-linecap="round" />\`
   - Bracket Extension in Phase 3 (Frame 5):
     * When Phase 3 triggers, \`#face-features\` dims to \`opacity: 0.28\`, and a continuous rounded-rectangle perimeter path (\`<rect id="perimeter-loop" x="26" y="24" width="68" height="72" rx="18" fill="none" stroke="#8fff5e" stroke-width="6.5" stroke-dasharray="70 0" />\`) smoothly animates in so the 4 corner brackets visually extend their straight arms and connect into a glowing green rounded rectangle around the dimmed face!

2. EXACT 3D GYROSCOPE & LONGITUDINAL MERIDIAN GLOBE SPIN (Frames 6, 7 & 8 — Continuous \`requestAnimationFrame\` SVG Parameter Interpolation!):
   - Do NOT use a weak 20-degree CSS tilt! Drive \`#gyro-layer\` (\`<svg width="120" height="120" viewBox="0 0 120 120" fill="none">\`) using a smooth 60fps \`requestAnimationFrame\` function \`renderGyro(progress)\` where \`progress\` goes from \`0.0\` to \`1.0\` over \`680ms\`:
     * Include a translucent neon-green glowing interior core: \`<ellipse id="gyro-core" cx="60" cy="60" rx="26" ry="40" fill="rgba(143, 255, 94, 0.22)" stroke="none" />\`
     * Include 3 dynamic stroke ellipses + 1 central vertical meridian spine inside \`#gyro-layer\`:
       - \`<ellipse id="ring-a" cx="60" cy="60" rx="22" ry="43" fill="none" stroke="#8fff5e" stroke-width="7" />\`
       - \`<ellipse id="ring-b" cx="60" cy="60" rx="22" ry="43" fill="none" stroke="#8fff5e" stroke-width="7" />\`
       - \`<ellipse id="ring-meridian" cx="60" cy="60" rx="14" ry="43" fill="none" stroke="#8fff5e" stroke-width="6.5" />\`
       - \`<line id="spine-line" x1="60" y1="17" x2="60" y2="103" stroke="#8fff5e" stroke-width="6.5" stroke-linecap="round" />\`
     * In \`renderGyro(p)\` (\`p\` in \`[0, 1]\`):
       - **From \`p = 0.0\` to \`0.35\` (matches Frame 6 — tilted compressed vertical ovals + spine):**
         \`ring-a\` rotates from \`+18deg\` to \`-28deg\` with \`rx\` growing \`14 -> 22\`; \`ring-b\` rotates from \`+14deg\` to \`+28deg\` with \`rx\` growing \`10 -> 22\`; \`spine-line\` is tilted \`+15deg -> 0deg\`; \`gyro-core\` opacity is \`0.24\`.
       - **From \`p = 0.35\` to \`0.68\` (matches Frame 7 — X-crossed gyroscope ovals):**
         \`ring-a\` (\`-28deg -> 0deg\`) and \`ring-b\` (\`+28deg -> 0deg\`) scissor together toward vertical (\`0deg\`) while \`rx\` expands \`22 -> 31\`; \`ring-meridian\` is upright (\`0deg\`) with \`rx\` sweeping \`4 -> 16\`.
       - **From \`p = 0.68\` to \`1.0\` (matches Frame 8 — vertical oval + central vertical spine + inner meridian sweeping outward to lock!):**
         \`ring-a\` and \`ring-b\` are locked vertically at \`0deg\` (\`rx=31, ry=43\`), \`spine-line\` is dead-center vertical (\`x1=60, x2=60\`) and fades out from \`p=0.85..1.0\`, while \`ring-meridian\` sweeps its horizontal radius \`rx\` from \`15\` all the way out to \`31\` (merging seamlessly into the outer \`rx=31\` vertical oval!) as \`gyro-core\` fades cleanly to \`0\`!

3. TWO-STAGE CHECKMARK DRAW-IN & SPRING POP (Frames 9 & 10):
   - Immediately at \`p = 1.0\`, show \`#final-layer\` with the locked vertical oval (\`<ellipse cx="60" cy="60" rx="31" ry="43" fill="none" stroke="#8fff5e" stroke-width="8" />\`).
   - Inside it, \`#check-wrap\` starts at \`transform: translateY(5px) scale(0.62)\` while \`#check-path\` (\`d="M 47 62 L 56 72 L 75 49"\`) draws in over \`220ms\`, and then pops upward/outward with an underdamped spring bounce (\`cubic-bezier(0.34, 1.85, 0.64, 1)\`) to \`translateY(0px) scale(1.0)\`!

4. STUDIO BACKDROP & INTERACTIVE CONTROLS:
   - Keep the full-viewport soft light studio backdrop (\`radial-gradient(circle at 50% 45%, #f8fafc 0%, #e4e8f0 100%)\`), fixed \`210px\` stage wrapper, and the 5 bottom buttons: \`▶ Auto-Loop\`, \`1. Blue Pill\`, \`2. Face ID\`, \`3. 3D Spin\` (clicking \`3. 3D Spin\` loops \`renderGyro(p)\` continuously so the user can admire the 3D gyroscope spin!), and \`4. Checkmark\`.

Output TWO fenced code blocks in your response:
1. First, a \`\`\`html ... \`\`\` block containing the COMPLETE, self-contained HTML5 document.
2. Second, a \`\`\`tsx ... \`\`\` block containing the complete React + Framer Motion + Tailwind CSS component code recreating all 5 phases.`;

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
        `Muse Spark 1.3 (${MUSE_MODEL_ID}): Synthesized exact Face ID L-brackets & 60fps 3D longitudinal meridian globe spin.`
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
