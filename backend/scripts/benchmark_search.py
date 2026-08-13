"""
Empirical brute-force search benchmark.

file_store_service.search() re-reads and re-parses metadata.json on every
call (by design — every worker always sees the latest committed state, see
file_store.py's module docstring), then does a numpy dot-product ranking.
At small corpus sizes (our current 30 real records) this is effectively
free. This script measures where it stops being free, so the pgvector
upgrade trigger in the architecture plan (§3) is a number backed by a
measurement on this machine, not a guess.

Usage:
    cd backend
    python -m scripts.benchmark_search
"""

import json
import statistics
import tempfile
import time
from pathlib import Path
from uuid import uuid4

import numpy as np

from app.services.file_store import FileStoreService

EMBEDDING_DIM = 768  # ViT-L/14
CORPUS_SIZES = [100, 500, 1000, 5000, 10000, 50000, 100000]
RUNS_PER_SIZE = 15


def build_synthetic_corpus(data_dir: Path, n: int) -> None:
    rng = np.random.default_rng(42)
    records = []
    for _ in range(n):
        vec = rng.normal(size=EMBEDDING_DIM).astype(np.float32)
        vec /= np.linalg.norm(vec)
        records.append({
            "id": str(uuid4()),
            "image_path": "synthetic.jpg",
            "dataset_source": "benchmark",
            "diagnosis": None,
            "tissue_type": None,
            "benign_malignant": None,
            "age": None,
            "sex": None,
            "anomaly_description": None,
            "anomaly_status": None,
            "anomaly_type": None,
            "identification": None,
            "wall_location": None,
            "run_number": None,
            "analysis_comment": None,
            "revision_history": [],
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
            "embedding": vec.tolist(),
            "rerank_embedding": None,
            "embedding_model": "ViT-L-14/openai",
            "rerank_embedding_model": None,
        })
    (data_dir / "metadata.json").write_text(json.dumps(records))
    (data_dir / "embedding_cache.json").write_text("{}")


def main():
    rng = np.random.default_rng(0)
    query = rng.normal(size=EMBEDDING_DIM).astype(np.float32)
    query /= np.linalg.norm(query)

    print(f"{'corpus_size':>12} | {'p50_ms':>8} | {'p95_ms':>8} | {'max_ms':>8}")
    print("-" * 48)

    for n in CORPUS_SIZES:
        with tempfile.TemporaryDirectory() as tmpdir:
            data_dir = Path(tmpdir)
            build_synthetic_corpus(data_dir, n)
            store = FileStoreService(str(data_dir))
            store.connect()

            timings = []
            for _ in range(RUNS_PER_SIZE):
                start = time.perf_counter()
                store._search_sync(
                    vector=query.tolist(),
                    limit=30,
                    diagnosis=None,
                    tissue_type=None,
                    benign_malignant=None,
                    embedding_model="ViT-L-14/openai",
                )
                timings.append((time.perf_counter() - start) * 1000)

            timings.sort()
            p50 = statistics.median(timings)
            p95 = timings[int(len(timings) * 0.95) - 1]
            print(f"{n:>12} | {p50:>8.1f} | {p95:>8.1f} | {timings[-1]:>8.1f}")


if __name__ == "__main__":
    main()
