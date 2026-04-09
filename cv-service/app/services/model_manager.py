"""LRU cache of loaded ONNX InferenceSession objects.

Thread-safe via threading.RLock. CPUExecutionProvider only.
Keyed by model file path.
"""
import threading
from collections import OrderedDict
from pathlib import Path

import onnxruntime as ort

from app.config import settings


class ModelManager:
    def __init__(self, max_size: int = 3):
        self._sessions: OrderedDict[str, ort.InferenceSession] = OrderedDict()
        self._lock = threading.RLock()
        self._max_size = max_size

    def load(self, model_path: str) -> ort.InferenceSession:
        with self._lock:
            if model_path in self._sessions:
                self._sessions.move_to_end(model_path)
                return self._sessions[model_path]

            path = Path(model_path)
            if not path.is_absolute():
                path = Path(settings.model_dir) / path
            if not path.exists():
                raise FileNotFoundError(f"Model not found: {path}")

            while len(self._sessions) >= self._max_size:
                _, evicted = self._sessions.popitem(last=False)
                del evicted

            session = ort.InferenceSession(
                str(path), providers=["CPUExecutionProvider"]
            )
            self._sessions[model_path] = session
            return session

    def evict(self, model_path: str) -> bool:
        with self._lock:
            if model_path in self._sessions:
                del self._sessions[model_path]
                return True
            return False

    def evict_all(self) -> None:
        with self._lock:
            self._sessions.clear()

    def list_loaded(self) -> list[str]:
        with self._lock:
            return list(self._sessions.keys())


model_manager = ModelManager(max_size=settings.max_models_cached)
