# Inspection Image Search

A content-based image retrieval system: search a library of industrial inspection images (weld defects, corrosion, pipeline anomalies, etc.) by uploading a reference image or typing a text description, and get back the most visually similar cases with their metadata.

## How it works

A FastAPI backend embeds images and text into a shared 512-dimensional vector space using OpenAI's CLIP (ViT-B/32), stores those vectors in Qdrant for fast similarity search, keeps structured metadata in PostgreSQL, and serves image files from MinIO. A React (Vite) frontend — servable in the browser or wrapped in Electron as a desktop app — handles search, results browsing, and adding new images to the library with inspection metadata (anomaly type, wall location, signed revision history, etc.).

```
React (Vite) SPA ──HTTP/WS──> Nginx :3000 ──proxy──> FastAPI (Gunicorn+Uvicorn) :8000
                                                              │
                                                ┌─────────────┼──────────────┐
                                          PostgreSQL       Qdrant         MinIO + Redis
                                         (metadata)   (512-d vectors)  (image files / embedding cache)
```

See `LEARNING.md` for a from-scratch explanation of every technology and concept used here.

## Quickstart

```bash
docker compose up -d --build
```

Then open **http://localhost:3000**. See `RUNNING_INSTRUCTIONS.md` for ingesting data, local frontend development with hot-reload, and troubleshooting.

## Project layout

- `backend/` — FastAPI application (`app/api`, `app/services`, `app/models`), Alembic migrations, ingestion scripts, tests
- `frontend/` — React app (`src/components`, `src/api`), Vite build config, optional Electron wrapper
- `docker-compose.yml` — orchestrates all six services (Postgres, Qdrant, MinIO, Redis, backend, frontend)
