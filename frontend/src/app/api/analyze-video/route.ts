import { NextResponse } from "next/server";
import { MetaApiError, PipelineInput, runMotionClonePipeline } from "@/lib/server/metaPipeline";
import { AnalysisPayload, TrackSample } from "@/types/motion";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Streams the closed-loop pipeline as NDJSON:
 *   {"type":"stage",...}  progress for each of the 5 stages
 *   {"type":"result","data":AnalysisPayload}  or  {"type":"error","error":code,"message":...}
 */
function parseGlobalFit(raw: unknown): PipelineInput["globalFit"] {
  const g = raw as { fit?: Record<string, unknown>; samples?: unknown[] } | null;
  if (!g?.fit || !Array.isArray(g.samples)) return null;
  const nums = ["omega0", "zeta", "onsetMs", "stiffness", "damping", "rSquared", "rmse"].map((k) => Number(g.fit?.[k]));
  if (!nums.every(Number.isFinite)) return null;
  const [omega0, zeta, onsetMs, stiffness, damping, rSquared, rmse] = nums;
  const samples = g.samples
    .slice(0, 200)
    .map((s) => ({ tMs: Number((s as { tMs: unknown }).tMs), u: Number((s as { u: unknown }).u) }))
    .filter((s) => Number.isFinite(s.tMs) && Number.isFinite(s.u));
  return { fit: { omega0, zeta, onsetMs, stiffness, damping, rSquared, rmse, iterations: 0, samples: samples.length }, samples };
}

/** Lets the UI know a server-side MODEL_API_KEY is configured (never returns the key). */
export async function GET() {
  const key = (process.env.MODEL_API_KEY || "").trim();
  return NextResponse.json({ serverKeyConfigured: !!key && key !== "your_meta_model_api_key_here" });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST", message: "Expected a JSON body." }, { status: 400 });
  }

  const apiKey = String(body.apiKey || process.env.MODEL_API_KEY || "").trim();
  if (!apiKey || apiKey === "your_meta_model_api_key_here") {
    return NextResponse.json(
      {
        error: "MISSING_API_KEY",
        message: "Click 'Set Meta API Key' and paste your Meta Model API key so Muse Spark 1.3 and SAM 3.1 can analyze the video.",
      },
      { status: 400 }
    );
  }

  const keyframes = (Array.isArray(body.keyframes) ? body.keyframes : [])
    .filter((k): k is string => typeof k === "string" && k.startsWith("data:image/"))
    .slice(0, 12);
  if (keyframes.length < 2) {
    return NextResponse.json({ error: "NO_FRAMES", message: "No decodable keyframes were extracted from the video." }, { status: 400 });
  }

  const input: PipelineInput = {
    apiKey,
    fileName: String(body.fileName || "uploaded-ui.mp4").slice(0, 120),
    durationMs: Math.max(300, Math.min(20000, Number(body.durationMs) || 2000)),
    keyframes,
    keyframeTimesMs: Array.isArray(body.keyframeTimesMs) ? body.keyframeTimesMs.map(Number).slice(0, keyframes.length) : [],
    motionTrack: Array.isArray(body.motionTrack) ? (body.motionTrack as TrackSample[]).slice(0, 120) : [],
    globalFit: parseGlobalFit(body.globalFit),
    customPrompts: String(body.customPrompts || ""),
    continueFrom:
      body.continueFrom && typeof body.continueFrom === "object" && Array.isArray((body.continueFrom as AnalysisPayload).layers)
        ? (body.continueFrom as AnalysisPayload)
        : null,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // client disconnected
        }
      };
      try {
        const data = await runMotionClonePipeline(input, (e) => {
          if (e.status === "warn") console.warn(`[motionclone] ${e.stage}: ${e.message}`);
          send(e);
        });
        send({ type: "result", data });
      } catch (err) {
        const status = err instanceof MetaApiError ? err.status : 500;
        send({
          type: "error",
          error: status === 401 || status === 403 ? "INVALID_API_KEY" : "META_API_ERROR",
          status,
          message: (err as Error).message || String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
