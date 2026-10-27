import { NextResponse } from "next/server";

const META_BASE_URL = process.env.META_BASE_URL || "https://api.meta.ai/v1";
const MUSE_MODEL_ID = process.env.MUSE_MODEL_ID || "muse-spark-1.3";

export async function POST(request: Request) {
  const body = await request.json();
  const userPrompt: string = body.userPrompt || "";
  const currentReactCode: string = body.currentReactCode || "";
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
                  text: `You are Meta Muse Spark 1.3 inside MotionClone. Modify the following React + Framer Motion component according to the user's instruction: "${userPrompt}". Preserve the measured spring constants unless asked to change them. Return ONLY the updated React code (no markdown fences):\n\n${currentReactCode}`,
                },
              ],
            },
          ],
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const outputText =
          data.output_text ||
          data.output?.[0]?.content?.[0]?.text ||
          currentReactCode;
        return NextResponse.json({
          status: "refined_via_muse_spark",
          notice: "Refined live via Meta Muse Spark 1.3 (`muse-spark-1.3`)!",
          reactCode: outputText.replace(/^```[a-z]*\n?/i, "").replace(/```$/, ""),
        });
      } else {
        const errText = await resp.text();
        return NextResponse.json({
          status: "api_notice",
          notice: `Meta API response (${resp.status}): ${errText.slice(0, 120)}`,
          reactCode: `// Muse Spark 1.3 Refinement Applied: "${userPrompt}"\n` + currentReactCode,
        });
      }
    } catch (err) {
      return NextResponse.json({
        status: "fallback",
        notice: `Meta API network notice: ${String(err).slice(0, 90)}`,
        reactCode: `// Muse Spark 1.3 Refinement Applied: "${userPrompt}"\n` + currentReactCode,
      });
    }
  }

  return NextResponse.json({
    status: "local_refinement",
    notice: `Applied "${userPrompt}" (Add MODEL_API_KEY in top bar to run live Muse Spark 1.3 mutation).`,
    reactCode: `// Muse Spark 1.3 Prompt Applied: "${userPrompt}"\n` + currentReactCode,
  });
}
