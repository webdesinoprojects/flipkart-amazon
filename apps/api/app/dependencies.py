from collections.abc import Generator
from functools import lru_cache
from typing import Annotated

from fastapi import Depends

from .capabilities.email.provider import EmailProvider
from .celery_app import celery_app
from .config import Settings, get_settings
from .modules.auth.passwords import (
    PasswordHashingService,
    password_service_from_parameters,
)
from .platform.rate_limit.limiter import RateLimiter, build_redis_client
from .providers.email import build_email_provider
from .providers.queue import CeleryTaskQueue, TaskQueue
from .providers.storage import StorageProvider, build_storage


def get_storage() -> Generator[StorageProvider]:
    yield build_storage(get_settings())


def get_queue() -> Generator[TaskQueue]:
    yield CeleryTaskQueue(celery_app)


def settings_dependency() -> Settings:
    return get_settings()


@lru_cache(maxsize=4)
def _password_service(parameters: tuple[int, int, int, int, int]) -> PasswordHashingService:
    """Cached per parameter set so the login decoy hash stays warm."""
    time_cost, memory_kib, parallelism, min_length, max_bytes = parameters
    return password_service_from_parameters(
        time_cost=time_cost,
        memory_kib=memory_kib,
        parallelism=parallelism,
        min_length=min_length,
        max_bytes=max_bytes,
    )


def get_password_service(
    settings: Annotated[Settings, Depends(settings_dependency)],
) -> PasswordHashingService:
    return _password_service(
        (
            settings.auth_argon2_time_cost,
            settings.auth_argon2_memory_kib,
            settings.auth_argon2_parallelism,
            settings.auth_password_min_length,
            settings.auth_password_max_bytes,
        )
    )


def get_email_provider(
    settings: Annotated[Settings, Depends(settings_dependency)],
) -> EmailProvider:
    # Construction is intentionally cheap. Avoid a process-global provider so
    # dependency overrides and settings reloads cannot accidentally use a
    # transport selected from different configuration.
    return build_email_provider(settings)


@lru_cache(maxsize=2)
def _rate_limiter(fingerprint: tuple[str, str, bool, float]) -> RateLimiter:
    url, secret, enabled, timeout_seconds = fingerprint
    client = build_redis_client(url, timeout_seconds=timeout_seconds) if enabled else None
    return RateLimiter(client=client, secret=secret, enabled=enabled)


def get_rate_limiter(
    settings: Annotated[Settings, Depends(settings_dependency)],
) -> RateLimiter:
    return _rate_limiter(
        (
            settings.valkey_url,
            settings.auth_secret,
            settings.rate_limit_enabled,
            settings.rate_limit_timeout_seconds,
        )
    )
