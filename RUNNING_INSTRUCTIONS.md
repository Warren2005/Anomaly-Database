# Running Instructions

## Prerequisites

- Docker Desktop (for the full stack)
- Node.js (only needed if you want frontend hot-reload during development)

---

## Quickstart — everything in one command

```bash
docker compose up -d --build
```

This builds and starts all six services: PostgreSQL, Qdrant, MinIO, Redis, the FastAPI backend, and the Nginx-served frontend. The backend's `entrypoint.sh` runs `alembic upgrade head` automatically before starting, so the schema is always current.

Check everything is healthy:

```bash
curl http://localhost:8000/api/v1/health
```

You should see:

```json
{
  "status": "healthy",
  "services": {
    "api": "up",
    "postgres": "up",
    "qdrant": "up",
    "minio": "up",
    "clip": "up",
    "redis": "up"
  }
}
```

Open the app at **http://localhost:3000**. Interactive API docs are at **http://localhost:8000/docs**.

Stop everything with:

```bash
docker compose down
```

---

## Ingesting images

Place image folders under `backend/data/` (gitignored — not part of version control) and run the ingestion script inside the backend container:

```bash
docker compose exec backend python -m scripts.ingest_custom --image-dir ./data/DV_Data
```

- `--label` sets the dataset label tag (defaults to the folder name)
- `--limit N` processes only the first N images, useful for a quick test
- The script is resumable via a per-folder `.ingest_checkpoint.db` checkpoint file — if interrupted, re-running the same command skips already-processed images. If you point it at a **different** Postgres/Qdrant instance (e.g. after resetting containers), delete the checkpoint file first so it doesn't skip images that were never actually ingested into the new instance.

Verify the data landed:

```bash
docker compose exec postgres psql -U postgres -d medical_microscopy -c "SELECT dataset_source, COUNT(*) FROM images GROUP BY dataset_source;"
curl http://localhost:6333/collections/medical_images
```

---

## Backups

The current backend (see `backend/app/services/file_store.py`) stores everything — image metadata, embeddings, feedback votes, the embedding cache, and the `events.jsonl` observability log — as files under `LIBRARY_DATA_DIR` (`backend/.env`, default `./data/library`), simulating the eventual SharePoint migration. That means the backup story doesn't need any new backup service or scheduled job — it needs `LIBRARY_DATA_DIR` to actually live inside a location that already versions files:

- **Once the real SharePoint migration happens**: point `LIBRARY_DATA_DIR` at a folder inside a SharePoint-synced document library. Every write already lands via an atomic replace (see `file_store.py`), so each save looks like a clean version to SharePoint's built-in version history, and accidental deletes are covered by its Recycle Bin — both with zero custom backup code.
- **Right now, before that migration**: point `LIBRARY_DATA_DIR` at a folder that's already OneDrive/SharePoint-synced on a team machine (most Microsoft 365 accounts have this available immediately) instead of a plain local folder. If that's not set up yet on this machine, a scheduled local copy into such a synced folder achieves the same effect as an interim step.

Either way: no new backup infrastructure — just making sure the data directory lives somewhere already versioned.

## Observability

Every search, feedback vote, library upload, and handled/unhandled error appends one JSON line to `LIBRARY_DATA_DIR/logs/events.jsonl` (see `app/services/event_log.py`) — e.g. `{"ts": "...", "event": "search", "embed_ms": 43.2, "rerank_ms": 79.1, "result_count": 30, "cache_hit": false}`. Because it lives under `LIBRARY_DATA_DIR`, it inherits the same backup story above for free.

To see a summary (p50/p95 search latency, error rate, embedding cache hit rate) over a time window:

```bash
cd backend
python -m scripts.show_stats            # last 24h
python -m scripts.show_stats --hours 1  # last hour
```

This is deliberately dependency-free — no Prometheus/Grafana to stand up or maintain. (The existing `/metrics` Prometheus endpoint and counters still work if you want them, but `events.jsonl` + `show_stats.py` is the log actually meant to be checked day-to-day.)

## Local development (frontend hot-reload)

If you're actively editing frontend code, the production Nginx build won't hot-reload. Instead, keep the backend and infra running via Docker Compose, and run the frontend dev server locally against it:

```bash
cd frontend
npm install
npm run dev
```

This starts Vite on **http://localhost:5173**, proxying `/api` requests to the backend on port 8000 (see `vite.config.js`'s `server.proxy`). Backend port 8000 stays exposed to the host either way, so this works alongside the containerized stack without any extra configuration.

After editing frontend code for real, rebuild the production image with:

```bash
docker compose up -d --build frontend
```

---

## Troubleshooting

- **`docker compose up` can't build (network errors during `apt-get`/`npm install` inside the build)**: this is a Docker Desktop networking issue, not the project. Check Docker Desktop → Settings → Resources → Proxies, and check whether a VPN client is intercepting the Docker VM's traffic. A full restart of the Mac often clears stuck VPN-related network state; if that doesn't help, try Docker Desktop's Troubleshoot → "Clean / Purge data" (this wipes all local images/containers/volumes).
- **Frontend shows "backend offline" in `npm run dev` mode**: confirm `vite.config.js` has a `server.proxy` entry for `/api` pointing at `http://localhost:8000`. Without it, relative `/api/v1/...` calls fall through to Vite's SPA catch-all and return HTML instead of JSON.
- **Ports already in use**: if you previously ran Postgres/Redis/Qdrant/MinIO locally (via Homebrew or a standalone binary) instead of through Docker Compose, stop those first — Compose needs to bind the same host ports (5432, 6379, 6333/6334, 9000/9001, 8000, 3000).
