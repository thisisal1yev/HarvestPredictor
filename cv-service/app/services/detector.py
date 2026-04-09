"""YOLO inference + output parsing + severity mapping (spec §4, §16).

`infer()` is blocking (runs ONNX `session.run`). Callers MUST wrap in
`asyncio.to_thread` from async code.
"""
import logging
from pathlib import Path

import cv2
import numpy as np
import yaml

from app.config import settings
from app.models.schemas import DetectionBBox, DetectionResult
from app.services.model_manager import model_manager

logger = logging.getLogger(__name__)

_CATEGORY_CACHE: dict[str, str] | None = None
_CATEGORIES_FILE = Path(__file__).parent / "class_categories.yaml"


def _categories() -> dict[str, str]:
    global _CATEGORY_CACHE
    if _CATEGORY_CACHE is None:
        try:
            with open(_CATEGORIES_FILE, "r", encoding="utf-8") as f:
                loaded = yaml.safe_load(f) or {}
            _CATEGORY_CACHE = {str(k).lower(): str(v).lower() for k, v in loaded.items()}
        except Exception as e:
            logger.warning("Could not load class_categories.yaml: %s", e)
            _CATEGORY_CACHE = {}
    return _CATEGORY_CACHE


def _category_for(class_name: str) -> str:
    """Return category for a YOLO class name, default 'disease'."""
    return _categories().get(class_name.lower(), "disease")


def _severity_for(confidence: float) -> str | None:
    """Map confidence to severity tier (spec §16). None = filter out."""
    if confidence < settings.min_detection_confidence:
        return None
    if confidence >= 0.80:
        return "confirmed"
    if confidence >= 0.60:
        return "likely"
    return "possible"  # 0.40 - 0.59


def _letterbox(frame: np.ndarray, target: tuple[int, int]) -> tuple[np.ndarray, float, int, int]:
    """Resize + pad to `target` (w, h) preserving aspect ratio.

    Returns (padded_frame, scale, pad_x, pad_y).
    """
    target_w, target_h = target
    orig_h, orig_w = frame.shape[:2]
    scale = min(target_w / orig_w, target_h / orig_h)
    new_w = int(round(orig_w * scale))
    new_h = int(round(orig_h * scale))
    resized = cv2.resize(frame, (new_w, new_h))

    pad_x = (target_w - new_w) // 2
    pad_y = (target_h - new_h) // 2
    padded = np.full((target_h, target_w, 3), 114, dtype=np.uint8)
    padded[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = resized
    return padded, scale, pad_x, pad_y


def infer(
    frame: np.ndarray,
    model_id: str,
    min_confidence: float | None = None,
) -> list[DetectionResult]:
    """Run YOLO inference on a single BGR frame.

    Returns detections with normalized 0-1 top-left bboxes and severity tier.
    Detections below `min_confidence` (or settings.min_detection_confidence
    if None) are filtered out.
    """
    threshold = (
        min_confidence
        if min_confidence is not None
        else settings.min_detection_confidence
    )

    session = model_manager.load(model_id)
    inputs = session.get_inputs()
    if not inputs:
        raise RuntimeError("ONNX model has no inputs")
    input_meta = inputs[0]
    input_name = input_meta.name
    input_shape = input_meta.shape

    # Expected NCHW input, e.g. [1, 3, 640, 640]. Fallback to 640x640.
    target_h = int(input_shape[2]) if len(input_shape) > 2 and isinstance(input_shape[2], int) else 640
    target_w = int(input_shape[3]) if len(input_shape) > 3 and isinstance(input_shape[3], int) else 640

    orig_h, orig_w = frame.shape[:2]
    padded, scale, pad_x, pad_y = _letterbox(frame, (target_w, target_h))

    # BGR -> RGB, HWC -> CHW, normalize, add batch dim.
    blob = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB)
    blob = blob.astype(np.float32) / 255.0
    blob = blob.transpose(2, 0, 1)[np.newaxis, ...]

    outputs = session.run(None, {input_name: blob})
    raw = outputs[0]

    # YOLOv8 ONNX output: (1, 4+nc, num_boxes) or (1, num_boxes, 4+nc).
    if raw.ndim != 3:
        return []
    data = raw[0]
    if data.shape[0] < data.shape[1]:
        data = data.T  # -> (num_boxes, 4+nc)

    results: list[DetectionResult] = []
    for row in data:
        if row.shape[0] < 5:
            continue
        cx, cy, bw, bh = row[:4]
        class_scores = row[4:]
        class_id = int(np.argmax(class_scores))
        conf = float(class_scores[class_id])

        severity = _severity_for(conf)
        if severity is None or conf < threshold:
            continue

        # Un-letterbox: remove padding, undo scale, normalize to original.
        x_img = (float(cx) - pad_x) / scale
        y_img = (float(cy) - pad_y) / scale
        w_img = float(bw) / scale
        h_img = float(bh) / scale

        x1 = max(0.0, x_img - w_img / 2.0)
        y1 = max(0.0, y_img - h_img / 2.0)
        x2 = min(float(orig_w), x1 + w_img)
        y2 = min(float(orig_h), y1 + h_img)

        if orig_w <= 0 or orig_h <= 0:
            continue

        nx = x1 / orig_w
        ny = y1 / orig_h
        nw = (x2 - x1) / orig_w
        nh = (y2 - y1) / orig_h

        if nw <= 0 or nh <= 0:
            continue

        class_name = f"class_{class_id}"
        results.append(
            DetectionResult(
                className=class_name,
                category=_category_for(class_name),
                confidence=round(conf, 4),
                severity=severity,  # type: ignore[arg-type]
                bbox=DetectionBBox(
                    x=round(nx, 4),
                    y=round(ny, 4),
                    w=round(nw, 4),
                    h=round(nh, 4),
                ),
            )
        )

    results.sort(key=lambda d: d.confidence, reverse=True)
    return results
