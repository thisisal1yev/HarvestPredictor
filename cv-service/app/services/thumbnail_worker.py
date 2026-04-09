"""Bounded single-thread thumbnail worker.

Backpressure strategy: if the queue is full (200 pending), drop the oldest
job and log a warning. The Detection row just stays with `thumbReady=false`.
"""
import collections
import logging
import threading
from typing import Any

import httpx
import numpy as np
import pyvips

from app.config import settings
from app.services.image_processor import encode_jpeg
from app.services.minio_client import minio_wrapper

logger = logging.getLogger(__name__)

MAX_QUEUE_SIZE = 200
THUMB_MAX_DIM = 320
THUMB_QUALITY = 78


class _BoundedDropOldestQueue:
    """Thread-safe queue that drops oldest entries when full."""

    def __init__(self, maxsize: int) -> None:
        self._maxsize = maxsize
        self._deque: collections.deque = collections.deque()
        self._lock = threading.Lock()
        self._not_empty = threading.Condition(self._lock)
        self._stopped = False

    def put(self, item: Any) -> bool:
        """Return True if enqueued, False if oldest was dropped to make room."""
        with self._not_empty:
            dropped = False
            if len(self._deque) >= self._maxsize:
                self._deque.popleft()
                dropped = True
            self._deque.append(item)
            self._not_empty.notify()
            return not dropped

    def get(self) -> Any:
        with self._not_empty:
            while not self._deque and not self._stopped:
                self._not_empty.wait()
            if self._stopped and not self._deque:
                return None
            return self._deque.popleft()

    def stop(self) -> None:
        with self._not_empty:
            self._stopped = True
            self._not_empty.notify_all()


_queue = _BoundedDropOldestQueue(MAX_QUEUE_SIZE)
_worker_thread: threading.Thread | None = None
_started = False
_lock = threading.Lock()


def _resize_with_pyvips(frame: np.ndarray) -> bytes:
    """Use pyvips to resize a BGR numpy frame to max 320px, return progressive JPEG bytes."""
    try:
        # Reorder BGR -> RGB for pyvips.
        rgb = frame[:, :, ::-1].copy()
        h, w = rgb.shape[:2]
        vimg = pyvips.Image.new_from_memory(rgb.tobytes(), w, h, 3, "uchar")
        scale = THUMB_MAX_DIM / max(w, h)
        if scale < 1.0:
            vimg = vimg.resize(scale)
        return vimg.jpegsave_buffer(Q=THUMB_QUALITY, interlace=True)
    except Exception as e:
        logger.warning("pyvips resize failed, falling back to cv2: %s", e)
        h, w = frame.shape[:2]
        scale = THUMB_MAX_DIM / max(w, h)
        if scale < 1.0:
            import cv2
            new_w = max(1, int(w * scale))
            new_h = max(1, int(h * scale))
            frame = cv2.resize(frame, (new_w, new_h))
        return encode_jpeg(frame, quality=THUMB_QUALITY, progressive=True)


def _notify_nuxt(detection_id: str) -> None:
    url = f"{settings.nuxt_internal_url.rstrip('/')}/api/cv/_internal/thumb-ready"
    headers = {"X-API-Key": settings.cv_api_key}
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.post(url, json={"id": detection_id}, headers=headers)
            if resp.status_code >= 400:
                logger.warning(
                    "thumb-ready webhook non-2xx for %s: %s",
                    detection_id, resp.status_code,
                )
    except Exception as e:
        logger.warning("thumb-ready webhook failed for %s: %s", detection_id, e)


def _process_one(job: dict) -> None:
    frame: np.ndarray = job["frame"]
    snapshot_key: str = job["snapshot_key"]
    detection_id: str = job["detection_id"]

    try:
        thumb_bytes = _resize_with_pyvips(frame)
        minio_wrapper.upload_bytes(
            f"{snapshot_key}/thumb.jpg",
            thumb_bytes,
            content_type="image/jpeg",
        )
        _notify_nuxt(detection_id)
    except Exception as e:
        logger.error("thumbnail job failed for %s: %s", detection_id, e)


def _worker_loop() -> None:
    logger.info("thumbnail worker started")
    while True:
        job = _queue.get()
        if job is None:
            break
        _process_one(job)
    logger.info("thumbnail worker stopped")


def start_worker() -> None:
    """Start the background worker thread if not already running."""
    global _worker_thread, _started
    with _lock:
        if _started:
            return
        _worker_thread = threading.Thread(
            target=_worker_loop,
            name="thumbnail-worker",
            daemon=True,
        )
        _worker_thread.start()
        _started = True


def stop_worker() -> None:
    global _started
    with _lock:
        if not _started:
            return
        _queue.stop()
        _started = False


def enqueue_thumbnail(
    frame: np.ndarray,
    snapshot_key: str,
    detection_id: str,
) -> None:
    """Schedule a thumbnail job. Non-blocking. May drop the oldest pending job."""
    start_worker()
    job = {
        "frame": frame,
        "snapshot_key": snapshot_key,
        "detection_id": detection_id,
    }
    enqueued = _queue.put(job)
    if not enqueued:
        logger.warning(
            "thumbnail queue full (%d) — dropped oldest job; latest=%s",
            MAX_QUEUE_SIZE, detection_id,
        )
