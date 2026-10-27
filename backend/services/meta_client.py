"""
Unified Meta Model API Client (https://api.meta.ai/v1) for MotionClone.

Integrates:
1. Meta Files API (`POST /v1/files`) for video ingestion
2. Meta Muse Spark 1.3 (`muse-spark-1.3`) for UI layer auto-discovery & grounded React/Framer Motion synthesis
3. Meta SAM 3.1 (`sam-3.1`) + `meta_sam_parser` for 60fps promptable concept segmentation & video tracking
"""

from __future__ import annotations

import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import cv2
    HAS_CV2 = True
except ImportError:
    cv2 = None  # type: ignore
    HAS_CV2 = False

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from .physics_solver import FrameBox

META_BASE_URL = os.getenv("META_BASE_URL", "https://api.meta.ai/v1")
MUSE_MODEL_ID = os.getenv("MUSE_MODEL_ID", "muse-spark-1.3")
SAM_MODEL_ID = os.getenv("SAM_MODEL_ID", "sam-3.1")


def get_api_key(override_key: Optional[str] = None) -> str:
    key = (override_key or os.getenv("MODEL_API_KEY") or "").strip()
    return key


def extract_video_keyframes_base64(video_path: str) -> Tuple[Optional[str], Optional[str], Dict[str, float]]:
    """
    Extracts the start keyframe (frame 1) and settled end keyframe (last frame)
    as base64 data URIs along with video metadata (fps, width, height, frame_count).
    """
    default_meta = {
        "fps": 60.0,
        "frameCount": 60,
        "width": 640,
        "height": 400,
        "durationMs": 1000.0,
    }
    if not HAS_CV2 or cv2 is None:
        return None, None, default_meta

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None, None, default_meta

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 60.0)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 60)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 400)

    ret_start, frame_start = cap.read()
    if not ret_start:
        cap.release()
        return None, None, default_meta

    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_count - 2))
    ret_end, frame_end = cap.read()
    if not ret_end:
        frame_end = frame_start
    cap.release()

    def to_data_uri(img: Any) -> str:
        _, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
        b64 = base64.b64encode(buf.tobytes()).decode("utf-8")
        return f"data:image/jpeg;base64,{b64}"

    meta = {
        "fps": round(fps, 2),
        "frameCount": frame_count,
        "width": width,
        "height": height,
        "durationMs": round((frame_count / max(1.0, fps)) * 1000.0, 1),
    }
    return to_data_uri(frame_start), to_data_uri(frame_end), meta


async def upload_video_to_meta_files(video_path: str, api_key: str) -> str:
    """
    Uploads an MP4/MOV video clip to `POST https://api.meta.ai/v1/files`
    with `purpose="user_data"` and returns the `file_id` for `sam-3.1` and `muse-spark-1.3`.
    """
    import httpx

    url = f"{META_BASE_URL.rstrip('/')}/files"
    headers = {"Authorization": f"Bearer {api_key}"}
    file_name = Path(video_path).name

    async with httpx.AsyncClient(timeout=60.0) as http_client:
        with open(video_path, "rb") as f:
            files = {"file": (file_name, f, "video/mp4")}
            data = {"purpose": "user_data"}
            resp = await http_client.post(url, headers=headers, data=data, files=files)
            resp.raise_for_status()
            payload = resp.json()
            return str(payload.get("id", ""))


async def discover_ui_layers_with_spark(
    video_path: str,
    file_id: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Stage 1: Uses Meta Muse Spark 1.3 (`muse-spark-1.3`) to inspect the UI video clip
    and automatically discover distinct moving/interactive UI concepts for SAM 3.1 segmentation.
    """
    from openai import AsyncOpenAI

    key = get_api_key(api_key)
    start_uri, end_uri, video_meta = extract_video_keyframes_base64(video_path)

    if not key:
        raise RuntimeError("MODEL_API_KEY is not configured.")

    client = AsyncOpenAI(base_url=META_BASE_URL, api_key=key)

    prompt = (
        "You are the perception planner for MotionClone, a video-to-spring-physics UI compiler. "
        "Examine this UI animation and identify the 3 to 4 most important moving or morphing UI layers "
        "so our SAM 3.1 (`sam-3.1`) video segmentation model can track each layer frame-by-frame.\n\n"
        "Return ONLY valid JSON matching this schema:\n"
        "{\n"
        '  "interactionTitle": "Short descriptive title of the UI interaction",\n'
        '  "interactionSummary": "1-sentence description of the state transition and physics",\n'
        '  "layers": [\n'
        "    {\n"
        '      "id": "layer-1",\n'
        '      "name": "Human-readable layer name",\n'
        '      "samPrompt": "2-4 word concrete visual noun phrase for SAM 3.1 (e.g., black pill container, album cover icon, action button)",\n'
        '      "colorHex": "#06b6d4",\n'
        '      "role": "container | media | control | typography"\n'
        "  ]\n"
        "}"
    )

    content_blocks: List[Dict[str, Any]] = [{"type": "input_text", "text": prompt}]
    if file_id:
        content_blocks.append({"type": "input_video", "file_id": file_id})
    elif start_uri and end_uri:
        content_blocks.append({"type": "input_image", "image_url": start_uri})
        content_blocks.append({"type": "input_image", "image_url": end_uri})

    response = await client.responses.create(
        model=MUSE_MODEL_ID,
        input=[{"type": "message", "role": "user", "content": content_blocks}],
    )

    raw_text = getattr(response, "output_text", "") or str(response)
    json_match = re.search(r"\{[\s\S]*\}", raw_text)
    if not json_match:
        raise ValueError(f"Muse Spark 1.3 did not return valid JSON: {raw_text[:300]}")

    parsed = json.loads(json_match.group(0))
    parsed["videoMeta"] = video_meta
    return parsed


async def track_concept_with_sam3(
    video_path: str,
    concept_prompt: str,
    file_id: Optional[str] = None,
    api_key: Optional[str] = None,
) -> List[FrameBox]:
    """
    Stage 2: Streams frame-by-frame Promptable Concept Segmentation from Meta SAM 3.1 (`sam-3.1`)
    via `POST https://api.meta.ai/v1/responses` and decodes masks + SVG vector paths using
    Meta's official `meta_sam_parser` library.
    """
    from openai import AsyncOpenAI

    key = get_api_key(api_key)
    if not key:
        raise RuntimeError("MODEL_API_KEY is required for live SAM 3.1 video segmentation.")

    _, _, video_meta = extract_video_keyframes_base64(video_path)
    fps = float(video_meta["fps"] or 60.0)

    if not file_id:
        file_id = await upload_video_to_meta_files(video_path, key)

    client = AsyncOpenAI(base_url=META_BASE_URL, api_key=key)

    stream = await client.responses.create(
        model=SAM_MODEL_ID,
        stream=True,
        input=[
            {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": concept_prompt},
                    {"type": "input_video", "file_id": file_id},
                ],
            }
        ],
    )

    from meta_sam_parser import (
        parse_video_stream,
        decode_mask_to_svg_path,
    )

    video_snapshot = await parse_video_stream(stream)
    frames_out: List[FrameBox] = []

    frames_iter = getattr(video_snapshot, "frames", []) or getattr(video_snapshot, "records", [])
    for idx, frame_rec in enumerate(frames_iter):
        frame_idx = int(getattr(frame_rec, "frame_index", idx))
        timestamp_ms = round((frame_idx / max(1.0, fps)) * 1000.0, 2)

        records = getattr(frame_rec, "records", [frame_rec])
        best_box: Optional[Tuple[float, float, float, float]] = None
        svg_path_str = ""

        for rec in records:
            kind = getattr(rec, "kind", getattr(rec, "type", ""))
            if kind == "box" and hasattr(rec, "bbox"):
                bx, by, bw, bh = rec.bbox
                best_box = (float(bx), float(by), float(bw), float(bh))
            elif kind == "mask":
                try:
                    svg_path_str = decode_mask_to_svg_path(rec)
                except Exception:
                    svg_path_str = ""

        if best_box is not None:
            bx, by, bw, bh = best_box
            if not svg_path_str:
                svg_path_str = (
                    f"M {bx:.1f} {by:.1f} "
                    f"L {bx + bw:.1f} {by:.1f} "
                    f"L {bx + bw:.1f} {by + bh:.1f} "
                    f"L {bx:.1f} {by + bh:.1f} Z"
                )
            frames_out.append(
                FrameBox(
                    frame_index=frame_idx,
                    timestamp_ms=timestamp_ms,
                    x=bx,
                    y=by,
                    width=bw,
                    height=bh,
                    svg_path=svg_path_str,
                )
            )

    return frames_out


async def synthesize_react_component_with_spark(
    interaction_title: str,
    layers_telemetry: List[Dict[str, Any]],
    video_path: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Dict[str, str]:
    """
    Stage 4: Uses Meta Muse Spark 1.3 (`muse-spark-1.3`) to compile a self-contained
    React + Tailwind CSS + Framer Motion component grounded in the exact mathematical
    spring parameters (`stiffness`, `damping`, `mass`, `staggerDelayMs`) solved from SAM 3.1.
    """
    from openai import AsyncOpenAI

    key = get_api_key(api_key)
    if not key:
        raise RuntimeError("MODEL_API_KEY is required for live Muse Spark 1.3 code synthesis.")

    client = AsyncOpenAI(base_url=META_BASE_URL, api_key=key)

    physics_spec_json = json.dumps(
        [
            {
                "layerName": l["name"],
                "samPrompt": l["samPrompt"],
                "role": l.get("role", "container"),
                "startBoundingBox": l["physics"]["start_state"],
                "endBoundingBox": l["physics"]["end_state"],
                "springTransition": {
                    "type": "spring",
                    "stiffness": l["physics"]["stiffness"],
                    "damping": l["physics"]["damping"],
                    "mass": l["physics"]["mass"],
                    "delay": round(l["physics"]["stagger_delay_ms"] / 1000.0, 3),
                },
                "overshootPct": l["physics"]["overshoot_pct"],
                "rSquaredFit": l["physics"]["r_squared"],
            }
            for l in layers_telemetry
        ],
        indent=2,
    )

    prompt = (
        f"You are the code synthesis engine for MotionClone. Compile a pixel-and-physics-accurate "
        f"interactive React + Tailwind CSS + Framer Motion component for '{interaction_title}'.\n\n"
        f"CRITICAL REQUIREMENT: You MUST use the exact mathematical spring parameters (`stiffness`, `damping`, "
        f"`mass`, `delay`) measured by our SAM 3.1 + Inverse Kinematics pipeline below:\n\n"
        f"{physics_spec_json}\n\n"
        "Return ONLY valid JSON with three keys:\n"
        "1. `reactCode`: Complete, production-ready React + Framer Motion component code using exact spring transitions.\n"
        "2. `swiftuiCode`: Equivalent SwiftUI view using `.spring(response:dampingFraction:)` derived from our telemetry.\n"
        "3. `cssCode`: Equivalent modern CSS `linear()` spring easing & `@keyframes` rules."
    )

    content_blocks: List[Dict[str, Any]] = [{"type": "input_text", "text": prompt}]
    if video_path and os.path.exists(video_path):
        start_uri, end_uri, _ = extract_video_keyframes_base64(video_path)
        if start_uri and end_uri:
            content_blocks.append({"type": "input_image", "image_url": start_uri})
            content_blocks.append({"type": "input_image", "image_url": end_uri})

    response = await client.responses.create(
        model=MUSE_MODEL_ID,
        input=[{"type": "message", "role": "user", "content": content_blocks}],
    )

    raw_text = getattr(response, "output_text", "") or str(response)
    json_match = re.search(r"\{[\s\S]*\}", raw_text)
    if json_match:
        return json.loads(json_match.group(0))
    return {
        "reactCode": raw_text,
        "swiftuiCode": "// SwiftUI export generated",
        "cssCode": "/* CSS linear() spring export generated */",
    }
