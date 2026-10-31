import { NextResponse } from "next/server";
import { MetaApiError, museChat } from "@/lib/server/metaPipeline";
import { extractHtmlDocument, extractReactCode, lintGeneratedHtml, sanitizeGeneratedHtml } from "@/lib/generatedHtml";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  const body = await request.json();
  const userPrompt = String(body.userPrompt || "").slice(0, 2000);
  const currentReactCode = String(body.currentReactCode || "");
  const currentPreviewHtml = String(body.currentPreviewHtml || "");
  const runtimeError = body.runtimeError ? String(body.runtimeError).slice(0, 600) : "";
  const apiKey = String(body.apiKey || process.env.MODEL_API_KEY || "").trim();

  if (!apiKey || apiKey === "your_meta_model_api_key_here") {
    return NextResponse.json(
      { status: "missing_key", notice: 'Click "Set Meta API Key" so Muse Spark 1.3 can edit the clone live.' },
      { status: 400 }
    );
  }

  const prompt = `You are Meta Muse Spark 1.3 inside MotionClone. ${
    runtimeError
      ? `The live preview threw this runtime error: "${runtimeError}". Fix it without changing the animation.`
      : `Update the cloned UI animation according to the user's request: "${userPrompt}".`
  }
Keep the window.MC_SPRING live-physics contract and the measured timings intact. Every <svg> and open stroke <path>
has fill="none" unless intentionally filled. Keep the stage scaled to fit a ~520x325 viewport.
Reply with exactly two fenced blocks: \`\`\`html (complete document) then \`\`\`tsx (React + Framer Motion component).

Current HTML preview:
\`\`\`html
${currentPreviewHtml}
\`\`\`

Current React code:
\`\`\`tsx
${currentReactCode}
\`\`\``;

  try {
    const text = await museChat(apiKey, prompt, [], 150_000, 0.15);
    const html = extractHtmlDocument(text);
    const react = extractReactCode(text);
    const issues = html ? lintGeneratedHtml(html) : [];
    if (!html && !react) {
      return NextResponse.json(
        { status: "no_change", notice: "Muse Spark 1.3 replied without code blocks — nothing changed." },
        { status: 502 }
      );
    }
    return NextResponse.json({
      status: "refined_via_muse_spark",
      notice: runtimeError
        ? "Muse Spark 1.3 repaired the runtime error."
        : `Muse Spark 1.3 applied: "${userPrompt}"${issues.length ? ` (lint: ${issues[0]})` : ""}`,
      livePreviewHtml: html ? sanitizeGeneratedHtml(html) : currentPreviewHtml,
      reactCode: react || currentReactCode,
    });
  } catch (err) {
    const status = err instanceof MetaApiError ? err.status : 500;
    return NextResponse.json({ status: "error", notice: (err as Error).message }, { status });
  }
}
