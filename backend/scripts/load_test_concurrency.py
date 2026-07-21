"""
Concurrency load test — fires ~20 simultaneous requests at a running
backend, mixing reads (search) and writes (feedback, library upload) to
exercise the file-store locking fix and the new shared cache under real
concurrent load. Not part of the app or the pytest suite — a manual tool.

Usage (backend must already be running):
    python -m scripts.load_test_concurrency --base-url http://localhost:8001
"""

import argparse
import asyncio
import io
import json
import time
from pathlib import Path

import httpx
from PIL import Image

DATA_DIR = Path("./data/DV_Data")


def make_test_image(seed: int) -> bytes:
    """A small distinct image per seed, so not every request hits the same
    cache key — we want a realistic mix of cache hits and misses."""
    img = Image.new("RGB", (64, 64), color=(seed % 256, (seed * 7) % 256, (seed * 13) % 256))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


async def search_task(client: httpx.AsyncClient, base_url: str, seed: int) -> dict:
    files = {"file": (f"test_{seed}.jpg", make_test_image(seed), "image/jpeg")}
    start = time.time()
    try:
        r = await client.post(f"{base_url}/api/v1/search/similar", files=files, timeout=30)
        return {"kind": "search", "status": r.status_code, "ms": (time.time() - start) * 1000}
    except Exception as e:
        return {"kind": "search", "status": "error", "error": str(e), "ms": (time.time() - start) * 1000}


async def repeat_search_task(client: httpx.AsyncClient, base_url: str, seed: int) -> dict:
    """Same seed as another task — should be a cache hit if run after it."""
    return await search_task(client, base_url, seed)


async def feedback_task(client: httpx.AsyncClient, base_url: str, image_id: str, vote: int) -> dict:
    start = time.time()
    try:
        r = await client.post(
            f"{base_url}/api/v1/feedback",
            json={"result_image_id": image_id, "vote": vote},
            timeout=30,
        )
        return {"kind": "feedback", "status": r.status_code, "ms": (time.time() - start) * 1000}
    except Exception as e:
        return {"kind": "feedback", "status": "error", "error": str(e), "ms": (time.time() - start) * 1000}


async def upload_task(client: httpx.AsyncClient, base_url: str, seed: int) -> dict:
    files = {"file": (f"upload_{seed}.jpg", make_test_image(seed + 1000), "image/jpeg")}
    data = {"anomaly_type": "Weld", "analyst": f"load-test-{seed}"}
    start = time.time()
    try:
        r = await client.post(f"{base_url}/api/v1/library/upload", files=files, data=data, timeout=30)
        return {"kind": "upload", "status": r.status_code, "ms": (time.time() - start) * 1000}
    except Exception as e:
        return {"kind": "upload", "status": "error", "error": str(e), "ms": (time.time() - start) * 1000}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8001")
    parser.add_argument("--data-dir", default="./data/library")
    args = parser.parse_args()

    async with httpx.AsyncClient() as client:
        # Get a real image ID to vote on
        r = await client.get(f"{args.base_url}/api/v1/images/filters")
        r.raise_for_status()

        r = await client.post(
            f"{args.base_url}/api/v1/search/similar",
            files={"file": ("probe.png", (DATA_DIR / "GirthweldBF.png").read_bytes(), "image/png")},
        )
        r.raise_for_status()
        probe_results = r.json()["results"]
        if not probe_results:
            print("No images in the corpus to vote on — ingest some data first.")
            return
        target_image_id = probe_results[0]["image"]["id"]

        # Build 20 concurrent tasks: 8 distinct-image searches, 4 repeated
        # (same seed as one of the first 8, to exercise cache hits across
        # "different users"), 4 feedback votes on the same image (the real
        # concurrency risk — simultaneous writes to feedback.json), 4 library
        # uploads (simultaneous writes to metadata.json).
        tasks = []
        for seed in range(8):
            tasks.append(search_task(client, args.base_url, seed))
        for seed in range(4):
            tasks.append(repeat_search_task(client, args.base_url, seed))  # cache-hit candidates
        for i in range(4):
            tasks.append(feedback_task(client, args.base_url, target_image_id, 1 if i % 2 == 0 else -1))
        for seed in range(4):
            tasks.append(upload_task(client, args.base_url, seed))

        print(f"Firing {len(tasks)} concurrent requests...")
        start = time.time()
        results = await asyncio.gather(*tasks)
        elapsed = time.time() - start

        print(f"\nCompleted in {elapsed:.2f}s\n")
        errors = [r for r in results if r["status"] not in (200,)]
        by_kind = {}
        for r in results:
            by_kind.setdefault(r["kind"], []).append(r)

        for kind, rs in by_kind.items():
            ok = sum(1 for r in rs if r["status"] == 200)
            avg_ms = sum(r["ms"] for r in rs) / len(rs)
            print(f"  {kind}: {ok}/{len(rs)} succeeded, avg {avg_ms:.0f}ms")

        if errors:
            print(f"\n{len(errors)} FAILURES:")
            for e in errors:
                print(f"  {e}")
        else:
            print("\nNo failures.")

        # Validate the JSON files are intact (not corrupted by concurrent writes)
        print("\n=== Post-storm file integrity check ===")
        data_dir = Path(args.data_dir)
        for fname in ("metadata.json", "feedback.json", "embedding_cache.json"):
            path = data_dir / fname
            try:
                data = json.loads(path.read_text())
                count = len(data)
                print(f"  {fname}: valid JSON, {count} entries")
            except Exception as e:
                print(f"  {fname}: CORRUPTED — {e}")


if __name__ == "__main__":
    asyncio.run(main())
