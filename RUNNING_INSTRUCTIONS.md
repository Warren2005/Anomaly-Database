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
