"""
Reads events.jsonl (app/services/event_log.py) and prints a lightweight,
dependency-free "dashboard": p50/p95 search latency, error rate, and
embedding cache hit rate over a chosen time window.

This is the intended way to notice "search got slower" or "errors are
spiking" — without standing up Prometheus/Grafana as a new service. The
existing /metrics Prometheus endpoint still works but isn't the thing
meant to be checked day-to-day; this is.

Usage:
    cd backend
    python -m scripts.show_stats
    python -m scripts.show_stats --hours 1
"""

import argparse
import json
import statistics
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.core.config import settings


def load_events(log_file: Path, since: datetime) -> list[dict]:
    events = []
    if not log_file.exists():
        return events
    with open(log_file) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue  # a torn/partial line — skip rather than crash the whole report
            try:
                ts = datetime.fromisoformat(record["ts"])
            except (KeyError, ValueError):
                continue
            if ts >= since:
                events.append(record)
    return events


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    idx = min(int(len(values) * p), len(values) - 1)
    return values[idx]


def main():
    parser = argparse.ArgumentParser(description="Summarize events.jsonl")
    parser.add_argument("--hours", type=float, default=24, help="Look-back window in hours")
    args = parser.parse_args()

    log_file = Path(settings.library_data_dir) / "logs" / "events.jsonl"
    since = datetime.now(timezone.utc) - timedelta(hours=args.hours)
    events = load_events(log_file, since)

    print(f"Log file: {log_file}")
    print(f"Window: last {args.hours}h ({len(events)} events)\n")

    if not events:
        print("No events in this window.")
        return

    by_type: dict[str, list[dict]] = {}
    for e in events:
        by_type.setdefault(e.get("event", "unknown"), []).append(e)

    for event_type, records in sorted(by_type.items()):
        print(f"{event_type}: {len(records)}")
    print()

    searches = by_type.get("search", [])
    if searches:
        total_ms = [r["total_ms"] for r in searches if r.get("total_ms") is not None]
        print("=== search latency (total_ms) ===")
        print(f"  p50={percentile(total_ms, 0.50):.1f}ms  p95={percentile(total_ms, 0.95):.1f}ms  max={max(total_ms):.1f}ms")

        cache_flags = [r["cache_hit"] for r in searches if r.get("cache_hit") is not None]
        if cache_flags:
            hit_rate = sum(1 for c in cache_flags if c) / len(cache_flags)
            print(f"  embedding cache hit rate: {hit_rate:.1%} (n={len(cache_flags)})")
        print()

    errors = by_type.get("error", [])
    request_events = sum(
        len(by_type.get(t, [])) for t in ("search", "batch_search", "upload")
    )
    total_requests = request_events + len(errors)
    if total_requests:
        error_rate = len(errors) / total_requests
        print("=== errors ===")
        print(f"  {len(errors)}/{total_requests} requests ({error_rate:.1%} error rate)")
        by_code: dict[str, int] = {}
        for e in errors:
            code = e.get("error_code", "UNKNOWN")
            by_code[code] = by_code.get(code, 0) + 1
        for code, count in sorted(by_code.items(), key=lambda kv: -kv[1]):
            print(f"    {code}: {count}")


if __name__ == "__main__":
    main()
