"""
Persisted catalog of reusable anomaly tags.

Stored as tags.json under library_data_dir so admin-added tags survive
restarts. Merged with tags already present on library entries when listed.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from app.core.config import settings


class TagCatalogService:
    def __init__(self) -> None:
        self._path = Path(settings.library_data_dir) / "tags.json"

    def _ensure_file(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._path.write_text(
                json.dumps({"tags": []}, indent=2),
                encoding="utf-8",
            )

    def _read_sync(self) -> list[str]:
        self._ensure_file()
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        tags = data.get("tags") if isinstance(data, dict) else None
        if not isinstance(tags, list):
            return []
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in tags:
            tag = str(item or "").strip()
            key = tag.lower()
            if not tag or key in seen:
                continue
            seen.add(key)
            cleaned.append(tag)
        return sorted(cleaned, key=lambda t: t.lower())

    def _write_sync(self, tags: list[str]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"tags": sorted(tags, key=lambda t: t.lower())}
        self._path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    async def list_tags(self) -> list[str]:
        return await asyncio.to_thread(self._read_sync)

    async def add_tag(self, tag: str) -> str:
        tag = tag.strip()
        if not tag:
            raise ValueError("Tag is required.")

        def _add() -> str:
            tags = self._read_sync()
            for existing in tags:
                if existing.lower() == tag.lower():
                    raise ValueError(f"Tag '{existing}' already exists.")
            tags.append(tag)
            self._write_sync(tags)
            return tag

        return await asyncio.to_thread(_add)


tag_catalog_service = TagCatalogService()
