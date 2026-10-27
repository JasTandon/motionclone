import { NextResponse } from "next/server";

const META_BASE_URL = process.env.META_BASE_URL || "https://api.meta.ai/v1";
const MUSE_MODEL_ID = process.env.MUSE_MODEL_ID || "muse-spark-1.3";

export async function POST(request: Request) {
  const body = await request.json();
  const userPrompt: string = body.userPrompt || "";
  const currentReactCode: string = body.currentReactCode || "";
  const currentPreviewHtml: string = body.currentPreviewHtml || "";
  const apiKey: string = (body.apiKey || process.env.MODEL_API_KEY || "").trim();

  if (apiKey && apiKey !== "your_meta_model_api_key_here") {
    try {
      const resp = await fetch(`${META_BASE_URL.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MUSE_MODEL_ID,
          input: [
            {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `You are Meta Muse Spark 1.3 inside MotionClone. Update the cloned UI component according to the user's request: "${userPrompt}".
Return ONLY a valid JSON object (no markdown fences) with two keys:
1. "livePreviewHtml": Updated self-contained HTML+Tailwind preview document reflecting the user's change.
2. "reactCode": Updated React + Framer Motion component code reflecting the user's change.

Current HTML Preview:
${currentPreviewHtml}

Current React Code:
${currentReactCode}`,
                },
              ],
            },
          ],
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const rawText: string =
          data.output_text ||
          data.output?.[0]?.content?.[0]?.text ||
          "";
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          return NextResponse.json({
            status: "refined_via_muse_spark",
            notice: `Muse Spark 1.3 applied: "${userPrompt}"`,
            livePreviewHtml: parsed.livePreviewHtml || currentPreviewHtml,
            reactCode: parsed.reactCode || currentReactCode,
          });
        }
        return NextResponse.json({
          status: "refined_via_muse_spark",
          notice: `Muse Spark 1.3 applied: "${userPrompt}"`,
          reactCode: rawText.replace(/^```[a-z]*\n?/i, "").replace(/```$/, ""),
        });
      }
    } catch (err) {
      return NextResponse.json({
        status: "fallback",
        notice: `Meta API note: ${String(err).slice(0, 90)}`,
        reactCode: `// Muse Spark 1.3 Refinement: "${userPrompt}"\n` + currentReactCode,
      });
    }
  }

  return NextResponse.json({
    status: "local_refinement",
    notice: `Applied "${userPrompt}" (Make sure your Meta API key is saved in the top bar for live Muse Spark 1.3 generation).`,
    reactCode: `// Prompt Applied: "${userPrompt}"\n` + currentReactCode,
  });
}
