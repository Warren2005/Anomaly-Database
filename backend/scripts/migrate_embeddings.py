"""
Re-embed every library entry's media under the currently configured
primary embedding model.

Needed whenever the primary model changes: file_store.py's search()
filters out any stored embedding whose model_tag doesn't match the
currently active model (see app/services/embedding.py's model_tag docs),
specifically so a model swap can never silently compare incompatible
vector spaces. Without running this after a swap, every existing entry
would simply stop being returned by search — not wrong results, just an
empty library.

For every entry, re-embeds the primary image AND every additional panel
image (Image.additional_image_paths), since panel-scoped search compares
against each panel's own embedding, not just the primary's. Leaves every
other field untouched, including rerank_embedding/rerank_model_tag (inert
while Settings.rerank_enabled is False, harmless to leave as historical
data — see Settings.rerank_enabled's docstring).

Safety: backs up metadata.json (the only place embeddings live) before
writing anything, so this is a straightforward, single-file rollback if
anything looks wrong afterward.

Usage:
    python -m scripts.migrate_embeddings           # do it
    python -m scripts.migrate_embeddings --dry-run  # report only
"""

import argparse
import asyncio
import shutil
from datetime import datetime, timezone
from pathlib import Path

# Writing metadata.json repeatedly in quick succession can transiently race
# Dropbox's own sync client, which briefly locks the file right after each
# write — not our own portalocker (that only coordinates between our own
# processes), a separate, external lock. A short retry clears it reliably.
UPSERT_RETRIES = 5
UPSERT_RETRY_DELAY_S = 2

from app.core.config import settings
from app.services.embedding import embedding_service
from app.services.file_store import file_store_service
from app.services.local_storage import local_storage_service


async def main():
    parser = argparse.ArgumentParser(description="Re-embed the library corpus under the current primary model")
    parser.add_argument("--dry-run", action="store_true", help="Report what would change without writing anything")
    args = parser.parse_args()

    data_dir = Path(settings.library_data_dir)
    metadata_path = data_dir / "metadata.json"

    file_store_service.connect()
    local_storage_service.connect()
    print(f"Loading primary embedding model ({settings.primary_backbone_name})...")
    await embedding_service.load_model()
    print(f"Active model_tag: {embedding_service.model_tag}\n")

    images = await file_store_service.get_all_images()
    print(f"{len(images)} entries in {metadata_path}")

    tag_counts = await file_store_service.get_model_tag_counts()
    already_current = tag_counts.get("embedding_model", {}).get(embedding_service.model_tag, 0)
    print(f"Currently tagged with the active model: {already_current}/{len(images)}\n")

    if args.dry_run:
        print("--dry-run: would re-embed every entry above, no writes performed.")
        return

    if not metadata_path.exists():
        print(f"ERROR: {metadata_path} not found — nothing to back up or migrate.")
        return

    backup_path = metadata_path.with_name(
        f"metadata.json.bak-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    )
    shutil.copy2(metadata_path, backup_path)
    print(f"Backed up metadata.json -> {backup_path.name}\n")

    migrated = 0
    failed = []
    for i, image in enumerate(images):
        try:
            media_paths = [image.image_path, *(image.additional_image_paths or [])]
            media_embeddings = []
            for path in media_paths:
                media_bytes = await local_storage_service.get_image(path)
                media_embeddings.append(await embedding_service.get_embedding(media_bytes))

            raw = await file_store_service.get_raw_record(image.id)
            for attempt in range(1, UPSERT_RETRIES + 1):
                try:
                    await file_store_service.upsert_image(
                        image,
                        embedding=media_embeddings[0],
                        rerank_embedding=(raw or {}).get("rerank_embedding"),
                        embedding_model=embedding_service.model_tag,
                        rerank_embedding_model=(raw or {}).get("rerank_embedding_model"),
                        media_embeddings=media_embeddings,
                    )
                    break
                except OSError:
                    if attempt == UPSERT_RETRIES:
                        raise
                    await asyncio.sleep(UPSERT_RETRY_DELAY_S)
            migrated += 1
            if (i + 1) % 10 == 0 or (i + 1) == len(images):
                print(f"  {i + 1}/{len(images)} re-embedded")
        except Exception as exc:
            failed.append((image.id, image.anomaly_id, str(exc)))

    print(f"\nDone: {migrated}/{len(images)} entries re-embedded under {embedding_service.model_tag}")
    if failed:
        print(f"\n{len(failed)} FAILED (left untouched, still tagged with their old model):")
        for image_id, anomaly_id, err in failed:
            print(f"  {anomaly_id or image_id}: {err}")
        print(f"\nBackup available at {backup_path.name} if a rollback is needed.")


if __name__ == "__main__":
    asyncio.run(main())
