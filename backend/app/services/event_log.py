"""
Lightweight, dependency-free observability.

Appends one JSON line per meaningful action (search, feedback, upload,
error) to <library_data_dir>/logs/events.jsonl. Deliberately not a new
service to run: the log lives under the same directory as metadata.json,
so because that directory is a synced cloud folder — currently the team's
shared Dropbox, see file_store.py's module docstring and
RUNNING_INSTRUCTIONS.md's "Backups" section — the log history is versioned
right along with the data, for free.

Read by scripts/show_stats.py, which prints p50/p95 latency, error rate,
and cache hit rate over a chosen window — a dependency-free alternative to
standing up Prometheus/Grafana. (The existing Prometheus /metrics endpoint
and counters in middleware/metrics.py stay as-is, but this JSONL log is
the mechanism actually meant to be read day-to-day.)

Concurrency: appends go through the same cross-platform advisory lock
(portalocker) pattern as file_store.py, since multiple worker processes
may log events at the same time.
"""

import asyncio
import json
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import portalocker

from app.core.config import settings
from app.core.logging_config import logger


class EventLogService:
    def __init__(self, data_dir: str):
        self._log_dir = Path(data_dir) / "logs"
        self._log_file = self._log_dir / "events.jsonl"
        self._lock_file = self._log_dir / ".events.lock"

    def connect(self):
        self._log_dir.mkdir(parents=True, exist_ok=True)
        self._lock_file.touch(exist_ok=True)

    @contextmanager
    def _locked(self):
        with open(self._lock_file, "w") as fh:
            portalocker.lock(fh, portalocker.LOCK_EX)
            try:
                yield
            finally:
                portalocker.unlock(fh)

    def _log_event_sync(self, event: str, **fields) -> None:
        self._log_dir.mkdir(parents=True, exist_ok=True)
        if not self._lock_file.exists():
            self._lock_file.touch()
        record = {"ts": datetime.now(timezone.utc).isoformat(), "event": event, **fields}
        with self._locked():
            with open(self._log_file, "a") as fh:
                fh.write(json.dumps(record) + "\n")

    async def log_event(self, event: str, **fields) -> None:
        """Fire-and-forget structured logging. A logging failure must never
        break the request being logged — swallow it (after a warning)
        rather than propagate."""
        try:
            await asyncio.to_thread(self._log_event_sync, event, **fields)
        except Exception as e:
            logger.warning(
                "Failed to write event log", extra={"error": str(e), "event": event}
            )


event_log_service = EventLogService(data_dir=settings.library_data_dir)
