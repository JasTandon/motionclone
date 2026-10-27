import { NextResponse } from "next/server";

const META_BASE_URL = (process.env.META_BASE_URL || "https://api.meta.ai/v1").replace(/\/$/, "");
const MUSE_MODEL_ID = process.env.MUSE_MODEL_ID || "muse-spark-1.3";

function extractCodeBlock(text: string, lang: string): string | null {
  const regex = new RegExp("```(?:" + lang + ")?\\s*([\\s\\S]*?)```", "i");
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

export async function POST(request: Request) {
  const body = await request.json();
  const userPrompt: string = body.userPrompt || "";
  const currentReactCode: string = body.currentReactCode || "";
  const currentPreviewHtml: string = body.currentPreviewHtml || "";
  const apiKey: string = (body.apiKey || process.env.MODEL_API_KEY || "").trim();

  if (apiKey && apiKey !== "your_meta_model_api_key_here") {
    try {
      const resp = await fetch(`${META_BASE_URL}/chat/completions`, {
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
              content: `You are Meta Muse Spark 1.3 inside MotionClone. Update the cloned UI animation according to the user's request: "${userPrompt}".
Output TWO fenced code blocks:
1. First, a \`\`\`html ... \`\`\` block with the updated self-contained HTML5 + Tailwind + SVG/JS interactive preview.
2. Second, a \`\`\`tsx ... \`\`\` block with the updated React + Framer Motion component code.

Current HTML Preview:
${currentPreviewHtml}

Current React Code:
${currentReactCode}`,
            },
          ],
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const rawText: string = data.choices?.[0]?.message?.content || "";
        const htmlBlock = extractCodeBlock(rawText, "html");
        const tsxBlock =
          extractCodeBlock(rawText, "tsx") || extractCodeBlock(rawText, "jsx");

        return NextResponse.json({
          status: "refined_via_muse_spark",
          notice: `Muse Spark 1.3 applied: "${userPrompt}"`,
          livePreviewHtml: htmlBlock || currentPreviewHtml,
          reactCode: tsxBlock || currentReactCode,
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
    notice: `Please click "Set Meta API Key" in the top bar so Muse Spark 1.3 can edit your UI live.`,
    reactCode: currentReactCode,
  });
}
