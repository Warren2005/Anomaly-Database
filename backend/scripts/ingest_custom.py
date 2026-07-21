"""
Custom image ingestion script.

Ingests images from a local folder into the local file store (metadata +
embeddings) and local image storage.

Usage:
    cd backend
    python -m scripts.ingest_custom --image-dir ./data/DV_Data
    python -m scripts.ingest_custom --image-dir ./data/DV_Data --limit 10
"""

import argparse
import asyncio
import logging
import sqlite3
import time
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from app.core.config import settings
from app.services.embedding import embedding_service, rerank_embedding_service
from app.services.file_store import file_store_service
from app.services.local_storage import local_storage_service
from app.models.image import Image

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


class IngestionCheckpoint:
    def __init__(self, checkpoint_path: Path):
        self._conn = sqlite3.connect(str(checkpoint_path))
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS processed (image_name TEXT PRIMARY KEY)"
        )
        self._conn.commit()

    def is_processed(self, image_name: str) -> bool:
        return self._conn.execute(
            "SELECT 1 FROM processed WHERE image_name=?", (image_name,)
        ).fetchone() is not None

    def mark_processed(self, image_name: str):
        self._conn.execute(
            "INSERT OR IGNORE INTO processed (image_name) VALUES (?)", (image_name,)
        )
        self._conn.commit()

    def count_processed(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM processed").fetchone()[0]

    def close(self):
        self._conn.close()


async def ingest_single_image(
    image_path: Path,
    dataset_label: str,
    checkpoint: IngestionCheckpoint,
) -> bool:
    image_name = image_path.stem

    if checkpoint.is_processed(image_name):
        return False

    image_bytes = image_path.read_bytes()
    # Deterministic (not random) ID: re-running ingestion for the same
    # dataset_label + filename must overwrite the existing record via
    # upsert_image, not create a duplicate with a fresh random ID — this is
    # what makes deleting the checkpoint and re-embedding (e.g. after a
    # model change) safe to do repeatedly.
    image_id = uuid5(NAMESPACE_URL, f"custom/{dataset_label}/{image_name}")
    suffix = image_path.suffix.lower()
    object_name = f"custom/{dataset_label}/{image_name}{image_path.suffix}"
    content_type = "image/png" if suffix == ".png" else "image/jpeg"

    await local_storage_service.upload_image(object_name, image_bytes, content_type)

    embedding = await embedding_service.get_embedding(image_bytes)
    rerank_embedding = (
        await rerank_embedding_service.get_embedding(image_bytes)
        if settings.rerank_enabled
        else None
    )

    image_record = Image(
        id=image_id,
        dataset_source=f"custom_{dataset_label}",
        image_path=object_name,
        diagnosis=dataset_label,
        tissue_type=None,
        benign_malignant=None,
        age=None,
        sex=None,
    )
    await file_store_service.upsert_image(image_record, embedding, rerank_embedding)

    checkpoint.mark_processed(image_name)
    return True


async def main():
    parser = argparse.ArgumentParser(description="Ingest custom images")
    parser.add_argument(
        "--image-dir",
        required=True,
        help="Path to folder containing images to ingest",
    )
    parser.add_argument(
        "--label",
        default=None,
        help="Diagnosis label to tag images with (defaults to folder name)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process only first N images (for testing)",
    )
    args = parser.parse_args()

    image_dir = Path(args.image_dir).resolve()
    if not image_dir.exists():
        logger.error(f"Image directory does not exist: {image_dir}")
        return

    dataset_label = args.label or image_dir.name

    logger.info("Initializing services...")
    file_store_service.connect()
    local_storage_service.connect()
    await embedding_service.load_model()
    if settings.rerank_enabled:
        await rerank_embedding_service.load_model()

    checkpoint_path = image_dir / ".ingest_checkpoint.db"
    checkpoint = IngestionCheckpoint(checkpoint_path)
    already_done = checkpoint.count_processed()
    if already_done > 0:
        logger.info(f"Resuming: {already_done} images already processed")

    images = sorted(image_dir.glob("*.jpg")) + sorted(image_dir.glob("*.jpeg")) + sorted(image_dir.glob("*.png"))
    if args.limit:
        images = images[: args.limit]

    logger.info(f"Found {len(images)} images to process (label='{dataset_label}')")
    start_time = time.time()
    processed = 0
    skipped = 0

    for i, image_path in enumerate(images):
        try:
            was_processed = await ingest_single_image(image_path, dataset_label, checkpoint)
            if was_processed:
                processed += 1
            else:
                skipped += 1
        except Exception as e:
            logger.error(f"Failed to process {image_path.name}: {e}")
            continue

        if (i + 1) % 100 == 0:
            elapsed = time.time() - start_time
            rate = (processed + skipped) / elapsed if elapsed > 0 else 0
            logger.info(
                f"Progress: {i + 1}/{len(images)} "
                f"(processed={processed}, skipped={skipped}, rate={rate:.1f} img/s)"
            )

    elapsed = time.time() - start_time
    logger.info(f"Done: processed={processed}, skipped={skipped}, total_time={elapsed:.1f}s")

    checkpoint.close()


if __name__ == "__main__":
    asyncio.run(main())
