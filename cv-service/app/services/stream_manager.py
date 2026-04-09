"""Background stream worker registry + lifecycle (spec §4.4, §4.6).

Every cv2 / ONNX call is wrapped in `asyncio.to_thread` so the FastAPI
event loop never blocks on native C code.
"""
import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote, urlsplit, urlunsplit

import cv2
import httpx
import numpy as np
from ulid import ULID

from app.config import settings
from app.models.schemas import (
    ConnectionStartRequest,
    ConnectionTestRequest,
    DetectionResult,
)
from app.services import crypto
from app.services import detector
from app.services.image_processor import encode_jpeg
from app.services.minio_client import minio_wrapper
from app.services.reconnect import MAX_RECONNECT_ATTEMPTS, backoff_delay
from app.services.thumbnail_worker import enqueue_thumbnail

logger = logging.getLogger(__name__)


# ---------- Helpers ----------

def _build_url_with_creds(
    stream_url: str,
    username: Optional[str],
    password: Optional[str],
) -> str:
    """Embed credentials into a URL's authority section."""
    if not username and not password:
        return stream_url
    parts = urlsplit(stream_url)
    host = parts.hostname or ""
    port = f":{parts.port}" if parts.port else ""
    userinfo = ""
    if username:
        userinfo = quote(username, safe="")
        if password:
            userinfo += ":" + quote(password, safe="")
        userinfo += "@"
    netloc = f"{userinfo}{host}{port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def _round_bbox_key(bbox_x: float, bbox_y: float, bbox_w: float, bbox_h: float) -> tuple[int, int, int, int]:
    """Quantize a normalized bbox into an integer tuple for dedup keys."""
    return (
        int(round(bbox_x * 20)),
        int(round(bbox_y * 20)),
        int(round(bbox_w * 20)),
        int(round(bbox_h * 20)),
    )


async def _open_capture(url: str) -> cv2.VideoCapture:
    def _open() -> cv2.VideoCapture:
        cap = cv2.VideoCapture()
        cap.open(url, cv2.CAP_FFMPEG, [
            int(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC), 5000,
            int(cv2.CAP_PROP_READ_TIMEOUT_MSEC), 5000,
        ])
        return cap
    return await asyncio.to_thread(_open)


async def _read_frame(cap: cv2.VideoCapture) -> tuple[bool, Optional[np.ndarray]]:
    return await asyncio.to_thread(cap.read)


async def _release_capture(cap: cv2.VideoCapture) -> None:
    await asyncio.to_thread(cap.release)


# ---------- Public capture helpers (used by connections router test) ----------

async def open_capture(url: str) -> cv2.VideoCapture:
    return await _open_capture(url)


async def read_frame(cap: cv2.VideoCapture) -> tuple[bool, Optional[np.ndarray]]:
    return await _read_frame(cap)


async def release_capture(cap: cv2.VideoCapture) -> None:
    await _release_capture(cap)


# ---------- Worker state ----------

@dataclass
class StreamWorker:
    connection_id: str
    user_id: str
    cancel_event: asyncio.Event
    task: Optional[asyncio.Task[Any]] = None
    recent_cache: dict[tuple[str, tuple[int, int, int, int]], float] = field(default_factory=dict)


active_streams: dict[str, StreamWorker] = {}
_registry_lock = asyncio.Lock()


# ---------- Nuxt webhook calls ----------

async def _notify_detection(payload: dict) -> None:
    url = f"{settings.nuxt_internal_url.rstrip('/')}/api/cv/_internal/detection"
    headers = {"X-API-Key": settings.cv_api_key}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code >= 400:
                logger.warning(
                    "detection webhook non-2xx for %s: %s",
                    payload.get("id"), resp.status_code,
                )
    except Exception as e:
        logger.error("detection webhook failed: %s", e)


async def _notify_status(connection_id: str, status: str, message: str = "") -> None:
    url = f"{settings.nuxt_internal_url.rstrip('/')}/api/cv/_internal/status"
    headers = {"X-API-Key": settings.cv_api_key}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                url,
                json={"connectionId": connection_id, "status": status, "message": message},
                headers=headers,
            )
    except Exception as e:
        logger.warning("status webhook failed: %s", e)


# ---------- Snapshot + persistence ----------

def _dedup_detections(
    detections: list[DetectionResult],
    cache: dict[tuple[str, tuple[int, int, int, int]], float],
) -> list[DetectionResult]:
    window = settings.stream_dedup_window_seconds
    now = time.monotonic()

    # Expire old entries.
    stale = [k for k, ts in cache.items() if now - ts > window]
    for k in stale:
        cache.pop(k, None)

    kept: list[DetectionResult] = []
    for det in detections:
        key = (
            det.className,
            _round_bbox_key(det.bbox.x, det.bbox.y, det.bbox.w, det.bbox.h),
        )
        last = cache.get(key)
        if last is None or (now - last) > window:
            kept.append(det)
        cache[key] = now
    return kept


async def _save_snapshot_and_notify(
    frame: np.ndarray,
    det: DetectionResult,
    req: ConnectionStartRequest,
) -> None:
    """Race-free snapshot persistence order (spec §4.6)."""
    detection_id = str(ULID())
    now = datetime.now(timezone.utc)
    snapshot_key = f"detections/{now.year:04d}/{now.month:02d}/{now.day:02d}/{detection_id}"

    try:
        jpeg_bytes = await asyncio.to_thread(
            encode_jpeg, frame, 82, True,
        )
    except Exception as e:
        logger.error("encode_jpeg failed for %s: %s", detection_id, e)
        return

    try:
        await asyncio.to_thread(
            minio_wrapper.upload_bytes,
            f"{snapshot_key}/full.jpg",
            jpeg_bytes,
            "image/jpeg",
        )
    except Exception as e:
        logger.error("MinIO upload failed for %s: %s", detection_id, e)
        return

    payload = {
        "id": detection_id,
        "connectionId": req.connectionId,
        "userId": req.userId,
        "className": det.className,
        "category": det.category,
        "confidence": det.confidence,
        "severity": det.severity,
        "bbox": det.bbox.model_dump(),
        "snapshotKey": snapshot_key,
        "streamToken": req.streamToken,
    }
    await _notify_detection(payload)

    # Non-blocking enqueue of thumbnail job.
    enqueue_thumbnail(frame, snapshot_key, detection_id)


# ---------- Main worker loop ----------

async def _stream_worker(req: ConnectionStartRequest, worker: StreamWorker) -> None:
    username = crypto.decrypt(req.usernameEnc) if req.usernameEnc else None
    password = crypto.decrypt(req.passwordEnc) if req.passwordEnc else None
    url = _build_url_with_creds(req.streamUrl, username, password)

    cap = await _open_capture(url)
    if not cap or not cap.isOpened():
        await _release_capture(cap) if cap else None
        await _notify_status(req.connectionId, "error", "failed to open stream")
        return

    attempt = 0
    try:
        while not worker.cancel_event.is_set():
            ok, frame = await _read_frame(cap)
            if not ok or frame is None:
                attempt += 1
                if attempt > MAX_RECONNECT_ATTEMPTS:
                    await _notify_status(
                        req.connectionId,
                        "error",
                        "stream dead after 3 attempts",
                    )
                    return
                await asyncio.sleep(backoff_delay(attempt))
                await _release_capture(cap)
                cap = await _open_capture(url)
                if not cap or not cap.isOpened():
                    continue
                continue

            attempt = 0
            try:
                detections = await asyncio.to_thread(
                    detector.infer,
                    frame,
                    req.modelId,
                    settings.min_detection_confidence,
                )
            except Exception as e:
                logger.error("detector.infer failed for %s: %s", req.connectionId, e)
                await asyncio.sleep(settings.stream_throttle_seconds)
                continue

            for det in _dedup_detections(detections, worker.recent_cache):
                await _save_snapshot_and_notify(frame, det, req)

            await asyncio.sleep(settings.stream_throttle_seconds)
    except asyncio.CancelledError:
        logger.info("stream worker %s cancelled", req.connectionId)
        raise
    except Exception as e:
        logger.exception("stream worker %s crashed: %s", req.connectionId, e)
        await _notify_status(req.connectionId, "error", f"worker crashed: {e}")
    finally:
        try:
            await _release_capture(cap)
        except Exception:
            pass


# ---------- Public API ----------

class StreamLimitReached(Exception):
    pass


async def start(req: ConnectionStartRequest) -> None:
    async with _registry_lock:
        if req.connectionId in active_streams:
            return  # idempotent
        if len(active_streams) >= settings.max_concurrent_streams:
            raise StreamLimitReached(
                f"max_concurrent_streams={settings.max_concurrent_streams} reached"
            )
        worker = StreamWorker(
            connection_id=req.connectionId,
            user_id=req.userId,
            cancel_event=asyncio.Event(),
        )
        active_streams[req.connectionId] = worker

    worker.task = asyncio.create_task(
        _stream_worker(req, worker),
        name=f"stream-{req.connectionId}",
    )


async def stop(connection_id: str) -> bool:
    async with _registry_lock:
        worker = active_streams.get(connection_id)
        if worker is None:
            return False

    worker.cancel_event.set()
    if worker.task is not None:
        worker.task.cancel()
        try:
            await worker.task
        except (asyncio.CancelledError, Exception):
            pass

    async with _registry_lock:
        active_streams.pop(connection_id, None)
    return True


async def stop_all() -> None:
    async with _registry_lock:
        ids = list(active_streams.keys())
    for cid in ids:
        await stop(cid)


def active_ids() -> list[str]:
    return list(active_streams.keys())


async def test_connection(req: ConnectionTestRequest) -> tuple[bool, str]:
    """Try to open the stream for ~5s and release it. Return (ok, message)."""
    username = crypto.decrypt(req.usernameEnc) if req.usernameEnc else None
    password = crypto.decrypt(req.passwordEnc) if req.passwordEnc else None
    url = _build_url_with_creds(req.streamUrl, username, password)
    cap = None
    try:
        cap = await _open_capture(url)
        if cap is None or not cap.isOpened():
            return False, "could not open stream"
        ok, _ = await _read_frame(cap)
        if not ok:
            return False, "stream opened but read failed"
        return True, "ok"
    except Exception as e:
        return False, f"error: {e}"
    finally:
        if cap is not None:
            try:
                await _release_capture(cap)
            except Exception:
                pass
