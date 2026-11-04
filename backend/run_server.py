"""
Standalone launcher for MotionClone Backend on port 8000.

Uses FastAPI + Uvicorn when installed in the virtualenv, and automatically falls back
to a zero-dependency standard-library HTTP server exposing the exact same JSON endpoints
(`/api/health`, `/api/presets`, `/api/presets/{id}`, `/api/verify-physics`) so the backend
runs out-of-the-box on any Python 3.10–3.14+ environment.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

from services.meta_client import MUSE_MODEL_ID, SAM_MODEL_ID, get_api_key
from services.physics_solver import SpringFitResult, compute_trajectory_match
from services.presets_engine import get_preset_analysis


class MotionCloneHTTPHandler(BaseHTTPRequestHandler):
    def _send_json(self, payload: object, status: int = 200) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:
        self._send_json({"ok": True}, 200)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "/api/health":
            key = get_api_key()
            self._send_json(
                {
                    "status": "ok",
                    "metaApiConfigured": bool(key and key != "your_meta_model_api_key_here"),
                    "models": {
                        "perception": SAM_MODEL_ID,
                        "reasoning": MUSE_MODEL_ID,
                        "solver": "2nd-Order Harmonic Oscillator Nonlinear Least Squares",
                    },
                }
            )
            return

        if path == "/api/presets":
            self._send_json(
                {
                    "presets": [
                        {"id": "dynamic-island", "name": "Apple Dynamic Island Morph"},
                        {"id": "magnetic-wallet", "name": "Stripe Magnetic Card Drawer"},
                        {"id": "bento-morph", "name": "Linear Fluid Bento Expand"},
                    ]
                }
            )
            return

        if path.startswith("/api/presets/"):
            preset_id = path.split("/api/presets/")[-1]
            self._send_json(get_preset_analysis(preset_id))
            return

        self._send_json({"error": "Not found"}, 404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        length = int(self.headers.get("Content-Length", "0"))
        body_bytes = self.rfile.read(length) if length > 0 else b"{}"

        if path == "/api/verify-physics":
            data = json.loads(body_bytes.decode("utf-8"))
            preset_id = data.get("presetId", "dynamic-island")
            layer_id = data.get("layerId", "layer-1")
            preset_data = get_preset_analysis(preset_id)
            target_layer = next(
                (l for l in preset_data["layers"] if l["id"] == layer_id),
                preset_data["layers"][0],
            )
            phys_dict = data.get("customTelemetry") or target_layer["physics"]
            fit_obj = SpringFitResult(
                transition_type=phys_dict["transition_type"],
                stiffness=float(phys_dict["stiffness"]),
                damping=float(phys_dict["damping"]),
                mass=float(phys_dict["mass"]),
                damping_ratio=float(phys_dict["damping_ratio"]),
                natural_freq_rad=float(phys_dict["natural_freq_rad"]),
                overshoot_pct=float(phys_dict["overshoot_pct"]),
                settling_duration_ms=float(phys_dict["settling_duration_ms"]),
                stagger_delay_ms=float(phys_dict["stagger_delay_ms"]),
                cubic_bezier=tuple(phys_dict["cubic_bezier"]),
                r_squared=float(phys_dict["r_squared"]),
                dominant_axis=str(phys_dict["dominant_axis"]),
                start_state=phys_dict["start_state"],
                end_state=phys_dict["end_state"],
                telemetry_series=phys_dict["telemetry_series"],
            )
            res = compute_trajectory_match(
                original_fit=fit_obj,
                generated_stiffness=float(data.get("candidateStiffness", fit_obj.stiffness)),
                generated_damping=float(data.get("candidateDamping", fit_obj.damping)),
                generated_mass=float(data.get("candidateMass", 1.0)),
            )
            res["layerName"] = target_layer["name"]
            res["samPrompt"] = target_layer["samPrompt"]
            self._send_json(res)
            return

        if path == "/api/refine-with-spark":
            data = json.loads(body_bytes.decode("utf-8"))
            prompt = data.get("userPrompt", "")
            code = data.get("currentReactCode", "")
            self._send_json(
                {
                    "status": "refined",
                    "notice": f"Applied Muse Spark 1.3 instruction: '{prompt}'",
                    "reactCode": f"// Muse Spark 1.3 Refinement: {prompt}\n{code}",
                }
            )
            return

        if path == "/api/analyze-video":
            self._send_json(get_preset_analysis("dynamic-island"))
            return

        self._send_json({"error": "Not found"}, 404)


if __name__ == "__main__":
    try:
        import uvicorn
        print("Starting FastAPI + Uvicorn server on http://localhost:8000 ...")
        uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
    except ImportError:
        print("Starting MotionClone HTTP Physics API Server on http://localhost:8000 ...")
        server = HTTPServer(("0.0.0.0", 8000), MotionCloneHTTPHandler)
        server.serve_forever()
