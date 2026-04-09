from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Auth / crypto
    cv_api_key: str = ""
    encryption_key: str = ""

    # Paths
    model_dir: str = "./ml_models"

    # MinIO
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "harvestpredictor"
    minio_secure: bool = False

    # Nuxt webhook target
    nuxt_internal_url: str = "http://nuxt:3000"

    # Streaming
    max_concurrent_streams: int = 5
    stream_throttle_seconds: float = 0.5
    stream_dedup_window_seconds: int = 60

    # Detection
    min_detection_confidence: float = 0.40

    # Model cache
    max_models_cached: int = 3

    # CORS
    cors_origins: str = "http://localhost:3000"


settings = Settings()
