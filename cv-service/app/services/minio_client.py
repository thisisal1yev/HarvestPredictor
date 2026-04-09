"""MinIO client wrapper.

All methods are synchronous (the underlying minio SDK is blocking);
callers must wrap in `asyncio.to_thread` when called from async code.
"""
import io
import logging

from minio import Minio
from minio.error import S3Error

from app.config import settings

logger = logging.getLogger(__name__)


class MinioWrapper:
    def __init__(self) -> None:
        self._client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )
        self._bucket = settings.minio_bucket

    @property
    def client(self) -> Minio:
        return self._client

    @property
    def bucket(self) -> str:
        return self._bucket

    def ensure_bucket_exists(self) -> None:
        try:
            if not self._client.bucket_exists(self._bucket):
                self._client.make_bucket(self._bucket)
                logger.info("Created MinIO bucket: %s", self._bucket)
        except S3Error as e:
            logger.error("ensure_bucket_exists failed: %s", e)
            raise

    def upload_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        stream = io.BytesIO(data)
        self._client.put_object(
            self._bucket,
            key,
            stream,
            length=len(data),
            content_type=content_type,
        )


minio_wrapper = MinioWrapper()
