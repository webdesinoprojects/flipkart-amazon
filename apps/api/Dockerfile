FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /srv/api

RUN groupadd --system --gid 1001 labels && useradd --system --uid 1001 --gid labels labels
COPY apps/api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt
COPY --chown=labels:labels apps/api/alembic.ini ./alembic.ini
COPY --chown=labels:labels apps/api/pyproject.toml ./pyproject.toml
COPY --chown=labels:labels apps/api/app ./app
COPY --chown=labels:labels apps/api/tests ./tests
USER labels
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
