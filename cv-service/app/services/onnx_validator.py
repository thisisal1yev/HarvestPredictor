"""Safe ONNX validation — onnx.checker only, no InferenceSession at validation time."""
import hashlib
from pathlib import Path

import onnx

MAX_FILE_SIZE_MB = 100


def validate(file_path: str) -> dict:
    """Validate an ONNX model file safely.

    Checks file size, loads with `onnx.load` + `onnx.checker.check_model`,
    computes SHA256. Does NOT create an InferenceSession.

    Raises ValueError on any failure.
    """
    path = Path(file_path)
    if not path.exists():
        raise ValueError(f"File not found: {file_path}")
    if path.suffix.lower() != ".onnx":
        raise ValueError(f"Invalid extension: {path.suffix}. Only .onnx accepted.")

    file_size = path.stat().st_size
    size_mb = file_size / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise ValueError(f"File too large: {size_mb:.1f}MB (max {MAX_FILE_SIZE_MB}MB)")

    try:
        model = onnx.load(str(path))
        onnx.checker.check_model(model)
    except Exception as e:
        raise ValueError(f"Invalid ONNX model: {e}")

    sha256 = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(64 * 1024), b""):
            sha256.update(chunk)

    return {
        "valid": True,
        "file_size": file_size,
        "sha256": sha256.hexdigest(),
    }
