"""Image decode / encode helpers.

All operations use blocking cv2 or Pillow calls — callers MUST wrap in
`asyncio.to_thread` when invoked from async contexts.
"""
import io

import cv2
import numpy as np
from PIL import Image


def decode_image(data: bytes) -> np.ndarray:
    """Decode image bytes to a BGR numpy array via cv2."""
    arr = np.frombuffer(data, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Could not decode image")
    return frame


def encode_jpeg(frame: np.ndarray, quality: int = 82, progressive: bool = True) -> bytes:
    """Encode a BGR frame to progressive JPEG bytes."""
    params = [
        int(cv2.IMWRITE_JPEG_QUALITY), int(quality),
        int(cv2.IMWRITE_JPEG_PROGRESSIVE), 1 if progressive else 0,
    ]
    ok, buf = cv2.imencode(".jpg", frame, params)
    if not ok:
        raise RuntimeError("cv2.imencode failed")
    return buf.tobytes()


def strip_exif(data: bytes) -> bytes:
    """Strip EXIF metadata from an image's bytes using Pillow."""
    try:
        img = Image.open(io.BytesIO(data))
        img_format = img.format or "JPEG"
        pixels = list(img.getdata())
        clean = Image.new(img.mode, img.size)
        clean.putdata(pixels)
        buf = io.BytesIO()
        save_format = "JPEG" if img_format.upper() == "JPEG" else img_format
        clean.save(buf, format=save_format, quality=90)
        return buf.getvalue()
    except Exception:
        # On failure, return the original bytes untouched.
        return data
