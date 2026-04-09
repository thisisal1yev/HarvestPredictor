# IMPORTANT: Set OPENCV env vars BEFORE any module imports cv2 transitively.
import os  # noqa: I001

os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|stimeout;5000000",
)

import asyncio  # noqa: E402
import logging  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402

import httpx  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from app.config import settings  # noqa: E402
from app.routers import (  # noqa: E402
    connections,
    credentials,
    detect,
    health,
    models,
)
from app.services import stream_manager  # noqa: E402
from app.services.minio_client import minio_wrapper  # noqa: E402
from app.services.thumbnail_worker import start_worker, stop_worker  # noqa: E402

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


async def _reconcile_with_nuxt() -> None:
    """Cold-start notify Nuxt that no streams are currently active. Retry 3 times."""
    url = f"{settings.nuxt_internal_url.rstrip('/')}/api/cv/_internal/reconcile"
    headers = {"X-API-Key": settings.cv_api_key}
    payload = {"activeConnectionIds": []}
    for attempt in range(1, 4):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code < 400:
                    logger.info("Reconciled with Nuxt on attempt %d", attempt)
                    return
                logger.warning(
                    "reconcile attempt %d got status %d",
                    attempt, resp.status_code,
                )
        except Exception as e:
            logger.warning("reconcile attempt %d failed: %s", attempt, e)
        await asyncio.sleep(1.0 * attempt)
    logger.warning("Reconcile with Nuxt failed after 3 attempts (non-fatal at cold start)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.model_dir, exist_ok=True)

    try:
        await asyncio.to_thread(minio_wrapper.ensure_bucket_exists)
    except Exception as e:
        logger.error("ensure_bucket_exists failed at startup: %s", e)

    start_worker()
    await _reconcile_with_nuxt()
    try:
        yield
    finally:
        logger.info("Shutting down: cancelling active streams")
        try:
            await stream_manager.stop_all()
        except Exception as e:
            logger.warning("stop_all failed: %s", e)
        stop_worker()


app = FastAPI(
    title="HarvestPredictor CV Service",
    description="ONNX-based crop disease detection service",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(models.router, prefix="/models", tags=["models"])
app.include_router(detect.router, prefix="/detect", tags=["detection"])
app.include_router(credentials.router, prefix="/credentials", tags=["credentials"])
app.include_router(connections.router, prefix="/connections", tags=["connections"])
