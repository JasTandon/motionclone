import { NextResponse } from "next/server";
import { buildPresetAnalysisLocal, verifyTrajectoryLocal } from "@/lib/localPhysicsEngine";

export async function POST(request: Request) {
  const body = await request.json();
  const presetId = body.presetId || "dynamic-island";
  const layerId = body.layerId || "layer-1";
  const preset = buildPresetAnalysisLocal(presetId);
  const layer =
    preset.layers.find((l) => l.id === layerId) || preset.layers[0];

  const result = verifyTrajectoryLocal(
    layer,
    Number(body.candidateStiffness ?? layer.physics.stiffness),
    Number(body.candidateDamping ?? layer.physics.damping),
    Number(body.candidateMass ?? 1.0)
  );
  return NextResponse.json(result);
}
