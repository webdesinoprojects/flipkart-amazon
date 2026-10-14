from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEVELOPMENT_AUTH_SECRET = "dev-only-insecure-auth-secret-change-me"  # noqa: S105
"""Well-known placeholder. Production boot refuses it so it can never ship."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "SellerLabel API"
    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+psycopg://labels:labels@postgres:5432/labels"
    valkey_url: str = "redis://valkey:6379/0"
    storage_provider: Literal["local", "imagekit"] = "local"
    local_storage_root: Path = Path("/var/lib/label-normalizer")
    max_file_bytes: int = Field(default=25 * 1024 * 1024, ge=1024)
    max_batch_documents: int = Field(default=20, ge=1, le=100)
    max_pdf_pages: int = Field(default=200, ge=1, le=1000)
    processing_timeout_seconds: int = Field(default=120, ge=10, le=900)
    temp_file_ttl_seconds: int = Field(default=3600, ge=60)
    saved_output_retention_days: int = Field(default=30, ge=1, le=365)
    max_saved_output_bytes: int = Field(default=50 * 1024 * 1024, ge=1024)
    early_access_daily_credits: int = Field(default=100, ge=1, le=100_000)
    worker_concurrency: int = Field(default=2, ge=1, le=16)
    imagekit_private_key: str = ""
    imagekit_public_key: str = ""
    imagekit_url_endpoint: str = ""
    ai_enabled: bool = False
    local_vision_enabled: bool = False
    gemini_api_key: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-5.4"
    gemini_model: str = "gemini-3.6-flash"
    vision_max_image_bytes: int = Field(default=5 * 1024 * 1024, ge=1024)
    vision_auto_approve_confidence: float = Field(default=0.85, ge=0, le=1)

    # --- Application origins and proxy trust -------------------------------
    app_public_origins: str = (
        "http://localhost:8080,http://127.0.0.1:8080,http://localhost:3000,http://127.0.0.1:3000"
    )
    trusted_proxy_count: int = Field(default=0, ge=0, le=4)

    # --- Session and cookie policy -----------------------------------------
    auth_secret: str = DEVELOPMENT_AUTH_SECRET
    auth_cookie_prefix: str = Field(default="ln", pattern=r"^[A-Za-z0-9_-]{1,16}$")
    auth_cookie_secure: bool = False
    auth_session_idle_seconds: int = Field(default=12 * 3600, ge=300)
    auth_session_absolute_seconds: int = Field(default=30 * 86400, ge=3600)
    auth_session_touch_seconds: int = Field(default=60, ge=1)
    auth_max_sessions_per_user: int = Field(default=20, ge=1, le=200)

    # --- Password policy ----------------------------------------------------
    auth_password_min_length: int = Field(default=10, ge=8, le=64)
    auth_password_max_bytes: int = Field(default=1024, ge=72, le=4096)
    auth_argon2_time_cost: int = Field(default=3, ge=1, le=10)
    auth_argon2_memory_kib: int = Field(default=65536, ge=8192, le=1048576)
    auth_argon2_parallelism: int = Field(default=2, ge=1, le=16)

    # --- Account lifecycle --------------------------------------------------
    auth_require_verified_email: bool = False
    auth_verification_token_ttl_seconds: int = Field(default=86400, ge=300)
    auth_reset_token_ttl_seconds: int = Field(default=1800, ge=300)
    auth_audit_store_ip_prefix: bool = False

    # --- Abuse control ------------------------------------------------------
    rate_limit_enabled: bool = True
    rate_limit_timeout_seconds: float = Field(default=0.25, gt=0, le=5)
    rate_limit_login_ip_max: int = Field(default=30, ge=1)
    rate_limit_login_account_max: int = Field(default=10, ge=1)
    rate_limit_login_window_seconds: int = Field(default=900, ge=10)
    rate_limit_register_ip_max: int = Field(default=10, ge=1)
    rate_limit_register_window_seconds: int = Field(default=3600, ge=10)
    rate_limit_email_ip_max: int = Field(default=10, ge=1)
    rate_limit_email_account_max: int = Field(default=5, ge=1)
    rate_limit_email_window_seconds: int = Field(default=3600, ge=10)
    rate_limit_reset_ip_max: int = Field(default=20, ge=1)
    rate_limit_reset_window_seconds: int = Field(default=3600, ge=10)

    # --- Transactional email ------------------------------------------------
    email_provider: Literal["auto", "smtp", "disabled"] = "auto"
    smtp_host: str = ""
    smtp_port: int = Field(default=1025, ge=1, le=65535)
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = False
    smtp_timeout_seconds: float = Field(default=10, gt=0, le=60)
    email_from_address: str = "accounts@sellerlabel.in"
    email_from_name: str = "SellerLabel"
    email_reply_to: str = "sellerlabels@gmail.com"

    # --- Request bounds -----------------------------------------------------
    max_json_body_bytes: int = Field(default=16 * 1024, ge=1024, le=1024 * 1024)

    @property
    def imagekit_enabled(self) -> bool:
        return bool(
            self.imagekit_private_key and self.imagekit_public_key and self.imagekit_url_endpoint
        )

    @property
    def database_provider(self) -> Literal["local_postgres", "neon"]:
        return "neon" if "neon.tech" in self.database_url.lower() else "local_postgres"

    @property
    def effective_storage_provider(self) -> Literal["local", "imagekit"]:
        if self.storage_provider == "imagekit" and self.imagekit_enabled:
            return "imagekit"
        return "local"

    @property
    def cloud_ai_enabled(self) -> bool:
        return self.ai_enabled and bool(self.gemini_api_key or self.openai_api_key)

    @property
    def allowed_origins(self) -> tuple[str, ...]:
        """Allowlisted application origins used for CSRF and link building."""
        seen: list[str] = []
        for candidate in self.app_public_origins.split(","):
            origin = candidate.strip().rstrip("/")
            if origin and origin not in seen:
                seen.append(origin)
        return tuple(seen)

    @property
    def primary_origin(self) -> str:
        """Canonical origin for verification/reset links. Never a request Host."""
        origins = self.allowed_origins
        return origins[0] if origins else "http://localhost:8080"

    @property
    def session_cookie_name(self) -> str:
        return self._cookie_name("session")

    @property
    def csrf_cookie_name(self) -> str:
        return self._cookie_name("csrf")

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host)

    @property
    def uses_development_auth_secret(self) -> bool:
        return self.auth_secret == DEVELOPMENT_AUTH_SECRET

    def _cookie_name(self, suffix: str) -> str:
        base = f"{self.auth_cookie_prefix}_{suffix}"
        # The __Host- prefix is only legal with Secure, Path=/ and no Domain.
        return f"__Host-{base}" if self.auth_cookie_secure else base

    @model_validator(mode="after")
    def _enforce_production_safety(self) -> "Settings":
        if self.environment != "production":
            return self
        problems: list[str] = []
        if self.uses_development_auth_secret:
            problems.append("AUTH_SECRET is still the development placeholder")
        if len(self.auth_secret) < 32:
            problems.append("AUTH_SECRET must be at least 32 characters")
        if not self.auth_cookie_secure:
            problems.append("AUTH_COOKIE_SECURE must be true")
        insecure = [origin for origin in self.allowed_origins if not origin.startswith("https://")]
        if insecure or not self.allowed_origins:
            problems.append("APP_PUBLIC_ORIGINS must list https:// origins only")
        if self.auth_session_absolute_seconds < self.auth_session_idle_seconds:
            problems.append("absolute session lifetime must not be shorter than idle lifetime")
        if problems:
            raise ValueError("Unsafe production configuration: " + "; ".join(problems))
        return self


def origin_of(url: str) -> str:
    """Return the scheme://host[:port] form of a URL, or an empty string."""
    parts = urlsplit(url)
    if not parts.scheme or not parts.netloc:
        return ""
    return f"{parts.scheme}://{parts.netloc}".rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()
