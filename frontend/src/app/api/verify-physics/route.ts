import { NextResponse } from "next/server";
import { buildPresetAnalysisLocal, verifyTrajectoryLocal } from "@/lib/localPhysicsEngine";
import { TrackedLayer } from "@/types/motion";

/** Verifies a candidate spring against a layer's measured track (body.layer) or a built-in example. */
export async function POST(request: Request) {
  const body = await request.json();
  const provided = body.layer as TrackedLayer | undefined;
  const layer =
    provided && Array.isArray(provided.physics?.telemetry_series)
      ? provided
      : (() => {
          const preset = buildPresetAnalysisLocal(body.presetId || "dynamic-island");
          return preset.layers.find((l) => l.id === body.layerId) || preset.layers[0];
        })();

  return NextResponse.json(
    verifyTrajectoryLocal(
      layer,
      Number(body.candidateStiffness ?? layer.physics.stiffness),
      Number(body.candidateDamping ?? layer.physics.damping),
      Number(body.candidateMass ?? 1.0)
    )
  );
}
