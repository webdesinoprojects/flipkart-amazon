from celery import Celery

from .config import get_settings

settings = get_settings()
celery_app = Celery(
    "label_normalizer",
    broker=settings.valkey_url,
    backend=settings.valkey_url,
    include=["app.tasks"],
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=max(5, settings.processing_timeout_seconds - 5),
    task_time_limit=settings.processing_timeout_seconds,
    result_expires=settings.temp_file_ttl_seconds,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "cleanup-temporary-files": {
            "task": "storage.cleanup_expired",
            "schedule": 600.0,
        },
        # Expired sessions and one-time tokens are already unusable; this job
        # only reclaims rows, so an hourly cadence is sufficient and a missed
        # run has no security consequence.
        "cleanup-expired-auth-rows": {
            "task": "auth.cleanup_expired",
            "schedule": 3600.0,
        },
        "billing-process-events": {"task": "billing.process_events", "schedule": 20.0},
        "billing-reconcile": {"task": "billing.reconcile", "schedule": 300.0},
        "billing-cleanup-events": {"task": "billing.cleanup_events", "schedule": 86400.0},
    },
)
