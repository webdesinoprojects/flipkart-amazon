from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol
from uuid import uuid4

import httpx

from ..config import Settings


class StorageUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class StoredObject:
    key: str
    size_bytes: int
    provider: str


class StorageProvider(Protocol):
    id: str

    def put(
        self,
        data: bytes,
        safe_name: str,
        *,
        category: Literal["temporary", "saved-output"] = "temporary",
    ) -> StoredObject: ...

    def get(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...


class LocalTempStorage:
    id = "local"

    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def _path(self, key: str) -> Path:
        candidate = (self.root / key).resolve()
        if self.root not in candidate.parents:
            raise StorageUnavailable("Invalid storage key")
        return candidate

    def put(
        self,
        data: bytes,
        safe_name: str,
        *,
        category: Literal["temporary", "saved-output"] = "temporary",
    ) -> StoredObject:
        suffix = ".pdf" if safe_name.lower().endswith(".pdf") else ".bin"
        key = f"objects/{uuid4().hex}{suffix}"
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with target.open("xb") as handle:
            os.chmod(target, 0o600)
            handle.write(data)
        return StoredObject(key=key, size_bytes=len(data), provider=self.id)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class ImageKitStorage:
    """Private ImageKit write-through storage with a local worker-readable mirror."""

    id = "imagekit"

    def __init__(self, settings: Settings, local_mirror: LocalTempStorage):
        if not settings.imagekit_enabled:
            raise StorageUnavailable("ImageKit credentials are incomplete")
        self.private_key = settings.imagekit_private_key
        self.local_mirror = local_mirror

    def put(
        self,
        data: bytes,
        safe_name: str,
        *,
        category: Literal["temporary", "saved-output"] = "temporary",
    ) -> StoredObject:
        mirror = self.local_mirror.put(data, safe_name, category=category)
        folder = (
            "/label-normalizer-saved-outputs"
            if category == "saved-output"
            else "/label-normalizer-temporary"
        )
        tags = f"{category},label-normalizer"
        response = httpx.post(
            "https://upload.imagekit.io/api/v1/files/upload",
            auth=(self.private_key, ""),
            data={
                "fileName": safe_name,
                "folder": folder,
                "isPrivateFile": "true",
                "useUniqueFileName": "true",
                "tags": tags,
            },
            files={"file": (safe_name, data, "application/pdf")},
            timeout=30.0,
        )
        try:
            response.raise_for_status()
            file_id = str(response.json()["fileId"])
        except Exception:
            self.local_mirror.delete(mirror.key)
            raise
        return StoredObject(key=f"{file_id}:{mirror.key}", size_bytes=len(data), provider=self.id)

    def get(self, key: str) -> bytes:
        _, mirror_key = self._split_key(key)
        return self.local_mirror.get(mirror_key)

    def delete(self, key: str) -> None:
        file_id, mirror_key = self._split_key(key)
        try:
            response = httpx.delete(
                f"https://api.imagekit.io/v1/files/{file_id}",
                auth=(self.private_key, ""),
                timeout=15.0,
            )
            response.raise_for_status()
        finally:
            self.local_mirror.delete(mirror_key)

    @staticmethod
    def _split_key(key: str) -> tuple[str, str]:
        file_id, separator, mirror_key = key.partition(":")
        if not separator or not file_id or not mirror_key:
            raise StorageUnavailable("Invalid ImageKit storage key")
        return file_id, mirror_key


def build_storage(settings: Settings) -> StorageProvider:
    local = LocalTempStorage(settings.local_storage_root)
    if settings.effective_storage_provider == "imagekit":
        return ImageKitStorage(settings, local)
    return local
