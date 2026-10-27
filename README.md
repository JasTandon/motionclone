# MotionClone — Video-to-Spring-Physics UI Compiler

**Built for the Meta Global AI Developer Hackathon (Push the Frontier — Software)**

MotionClone bridges the gap between static "screenshot-to-code" tools and real-world interactive software engineering. By combining **Meta SAM 3.1 (`sam-3.1`)** video concept segmentation with **Inverse Kinematics Spring Curve Fitting (`SciPy`)** and **Meta Muse Spark 1.3 (`muse-spark-1.3`)**, MotionClone takes any short screen recording of a complex UI interaction and compiles it into a pixel-and-physics-accurate **React + Tailwind + Framer Motion** component—complete with closed-loop trajectory verification.

## Architecture

1. **Stage 1 — Auto-Concept Discovery (`muse-spark-1.3`):** Inspects the uploaded `.mp4` clip via `https://api.meta.ai/v1/responses` and identifies every moving UI layer using concrete noun phrases (`"expanding pill container"`, `"album art thumbnail"`, `"waveform visualizer"`, `"action button"`), plus initial styling tokens.
2. **Stage 2 — 60fps Sub-Pixel Video Tracking (`sam-3.1` + `meta-sam-parser`):** Streams frame-by-frame segmentation masks and bounding boxes for each UI layer, decoding SVG paths (`decode_mask_to_svg_path`) for real-time neon HUD overlays and extracting $(x(t), y(t), w(t), h(t))$ trajectories.
3. **Stage 3 — Inverse Kinematics & Spring Solver (`SciPy`):** Fits damped harmonic oscillator differential equations ($\ddot{u} + 2\zeta\omega_0\dot{u} + \omega_0^2(u - 1) = 0$) to each layer's trajectory to recover exact Framer Motion/SwiftUI spring parameters (`stiffness`, `damping`, `mass`, `overshoot %`, and `staggerDelayMs`).
4. **Stage 4 — Grounded Code Synthesis (`muse-spark-1.3`):** Synthesizes interactive React + Tailwind + Framer Motion code grounded in the start/end visual keyframes and exact mathematical spring telemetry.
5. **Stage 5 — Closed-Loop Self-Verification (`sam-3.1`):** Records the generated component, re-tracks its motion via `sam-3.1`, computes the **Physics Fidelity Score (`% Trajectory Match`)**, and self-corrects spring constants if needed.

## Quick Start

### 1. Environment Setup
Copy `.env.example` to `.env` inside `backend/` and add your Meta Model API key:
```bash
cp .env.example backend/.env
```

### 2. Run Backend (FastAPI + SciPy Physics Engine)
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 3. Run Frontend (Next.js Studio)
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:3000` in your browser.
