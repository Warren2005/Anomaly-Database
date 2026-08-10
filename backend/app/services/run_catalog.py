"""
Persisted catalog of ILI runs and their unique Run IDs.

Stored as runs.json under library_data_dir so admin-added runs survive
restarts and are shared across users. Seeded once from DEFAULT_RUNS.
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Optional

from app.core.config import settings

DEFAULT_RUNS: list[dict[str, str]] = [
    {"run": "ILIT0016", "run_id": "0AXVHCA77S1"},
    {"run": "ILIT0015", "run_id": "0B76825MIN3"},
    {"run": "ILIT0014", "run_id": "0AS0KUQOE45"},
    {"run": "ILIT0013-02", "run_id": "0AQQZFV2ALD"},
    {"run": "ILIT0013", "run_id": "0AP3OOMEPID"},
    {"run": "ILIT0012-01", "run_id": "0AK338BFJPQ"},
    {"run": "ILIT0011-02", "run_id": "0AGBXB4WEGN"},
    {"run": "ILIT0011", "run_id": "0AEKH5L7BXZ"},
    {"run": "ILIT0010", "run_id": "0A49KLT3B7Y"},
    {"run": "ILIT0009", "run_id": "0AA6Y6FBA1X"},
    {"run": "ILIT0008", "run_id": "0A49KLT3B7Y"},
]

_RUN_SORT_RE = re.compile(r"^ILIT(\d+)(?:-(\d+))?$", re.IGNORECASE)


def _sort_key(run: str) -> tuple:
    """Newest / highest first; sub-runs after their parent number group."""
    m = _RUN_SORT_RE.match(run.strip())
    if not m:
        return (-1, -1, run)
    major = int(m.group(1))
    minor = int(m.group(2)) if m.group(2) else -1
    return (-major, -minor, run)


def _sorted_runs(runs: list[dict[str, str]]) -> list[dict[str, str]]:
    return sorted(runs, key=lambda r: _sort_key(r.get("run", "")))


class RunCatalogService:
    def __init__(self) -> None:
        self._path = Path(settings.library_data_dir) / "runs.json"

    def _ensure_file(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._path.write_text(
                json.dumps({"runs": DEFAULT_RUNS}, indent=2),
                encoding="utf-8",
            )

    def _read_sync(self) -> list[dict[str, str]]:
        self._ensure_file()
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return list(DEFAULT_RUNS)
        runs = data.get("runs") if isinstance(data, dict) else None
        if not isinstance(runs, list):
            return list(DEFAULT_RUNS)
        cleaned: list[dict[str, str]] = []
        for item in runs:
            if not isinstance(item, dict):
                continue
            run = str(item.get("run") or "").strip()
            run_id = str(item.get("run_id") or "").strip()
            if run:
                cleaned.append({"run": run, "run_id": run_id})
        return _sorted_runs(cleaned) if cleaned else list(DEFAULT_RUNS)

    def _write_sync(self, runs: list[dict[str, str]]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"runs": _sorted_runs(runs)}
        self._path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    async def list_runs(self) -> list[dict[str, str]]:
        return await asyncio.to_thread(self._read_sync)

    async def add_run(self, run: str, run_id: str) -> dict[str, str]:
        run = run.strip()
        run_id = run_id.strip()

        def _add() -> dict[str, str]:
            runs = self._read_sync()
            for existing in runs:
                if existing["run"].lower() == run.lower():
                    raise ValueError(f"Run '{run}' already exists.")
            entry = {"run": run, "run_id": run_id}
            runs.append(entry)
            self._write_sync(runs)
            return entry

        return await asyncio.to_thread(_add)


run_catalog_service = RunCatalogService()
