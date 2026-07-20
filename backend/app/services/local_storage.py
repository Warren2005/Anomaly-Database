"""
Local filesystem image storage.

Replaces MinIO/S3. Images are plain files under `library_data_dir/images/`,
addressed by the same relative-path key scheme MinIO used
(e.g. "custom/DV_Data/example.png", "library/<uuid>.png") — so nothing
that constructs an image_path needs to change.

There is no separate object-storage server to generate a presigned URL
from, so get_presigned_url() doesn't exist here — every endpoint instead
returns the existing internal proxy URL (/api/v1/images/{id}/file).
"""

import asyncio
from pathlib import Path

from app.core.config import settings
from app.core.logging_config import logger


class LocalStorageService:
    def __init__(self, data_dir: str):
        self._images_dir = Path(data_dir) / "images"

    def connect(self):
        self._images_dir.mkdir(parents=True, exist_ok=True)
        logger.info("Local image storage ready", extra={"dir": str(self._images_dir)})

    def health_check(self) -> bool:
        return self._images_dir.is_dir()

    def _resolve(self, object_name: str) -> Path:
        return self._images_dir / object_name

    def _upload_image_sync(
        self, object_name: str, data: bytes, content_type: str = "image/jpeg"
    ) -> str:
        path = self._resolve(object_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return object_name

    async def upload_image(
        self, object_name: str, data: bytes, content_type: str = "image/jpeg"
    ) -> str:
        return await asyncio.to_thread(
            self._upload_image_sync, object_name, data, content_type
        )

    def _get_image_sync(self, object_name: str) -> bytes:
        return self._resolve(object_name).read_bytes()

    async def get_image(self, object_name: str) -> bytes:
        return await asyncio.to_thread(self._get_image_sync, object_name)


local_storage_service = LocalStorageService(data_dir=settings.library_data_dir)
