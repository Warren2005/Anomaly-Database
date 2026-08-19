# ILI Reference Library — Technical Architecture & Maintenance Guide

**Audience:** engineers who need to modify, extend, or operate this system.
**Scope:** everything end-to-end — backend, frontend, data model, data flow, deployment, and known gaps.
**Status:** written against the codebase as of this document's creation. `README.md` and `LEARNING.md` in the repo describe an **earlier** architecture (Postgres + Qdrant + MinIO + Redis) that this system no longer uses — see [Known Limitations](#known-limitations--technical-debt) §1. This document reflects what the code actually does today; treat it, not those two files, as current.

---

## 1. Overview

The **ILI Reference Library** ("ILI-brary") is a content-based image retrieval system for industrial in-line inspection (ILI) data — pipeline anomalies such as corrosion, cracks, dents, and weld defects. An inspector uploads or picks a reference image (or types a text description) and gets back the most visually similar previously-catalogued anomalies, each with structured inspection metadata (anomaly type, identification, dimensions, wall location, run, revision history, etc.).

It also functions as a browsable, filterable **reference library**: every catalogued anomaly can be searched by structured metadata (type, identification, run, panel, wall location, status) or free text, independent of image similarity search.

**Stack:**
- **Backend:** FastAPI (Python), a frozen DINOv2 backbone (`timm`) + a small trained metric-learning head for image embeddings — see §4.3 — a **flat-file storage backend** (no database server) under a configurable data directory.
- **Frontend:** React 18 + Vite, plain `useState`/`useMemo` (no Redux/Context/state library), optionally wrapped in Electron as a desktop shell.
- **Deployment:** the backend serves the built frontend directly as static files at `/` — normally a single process, single port.

---

## 2. Architecture at a Glance

```
                     ┌────────────────────────────────────────────┐
                     │   Browser (or Electron shell)               │
                     │   React SPA — frontend/src                  │
                     └───────────────────┬──────────────────────────┘
                                          │ HTTP (relative /api/v1/*,
                                          │ or http://localhost:8000/api/v1/*
                                          │ under Electron's file:// origin)
                     ┌───────────────────▼──────────────────────────┐
                     │   FastAPI app — backend/app/main.py            │
                     │   • CORS (open), Prometheus middleware,        │
                     │     global exception handlers, rate limiting   │
                     │   • Mounts frontend/dist/ as static files at / │
                     └───────────────────┬──────────────────────────┘
                                          │
              ┌───────────────┬──────────┼───────────┬────────────────┐
              ▼               ▼          ▼           ▼                ▼
        embedding.py    file_store.py  local_storage cache.py   event_log.py
        (DINOv2+head,   (metadata.json (image files  (embedding (events.jsonl
         primary only)   + locking +    on disk)      cache)     audit trail)
                          atomic writes)
```

There is **no Postgres, Qdrant, MinIO, or Redis**. Everything that those four services would normally provide — structured metadata storage, vector search, image blob storage, and caching — is implemented as plain files on disk under `LIBRARY_DATA_DIR` (see `backend/app/core/config.py`), guarded by cross-platform advisory file locks (`portalocker`) and atomic write-then-`os.replace()` semantics. This is a deliberate design choice for a small-team, low-write-concurrency tool — see [Design Decisions §1](#1-file-based-storage-instead-of-a-database).

The **canonical current-state source for the storage design and local dev workflow is `RUNNING_INSTRUCTIONS.md`**, not `README.md`.

---

## 3. Repository Structure

```
backend/
  app/
    main.py                     — FastAPI app, lifespan, middleware, static mount
    core/
      config.py                 — Settings (env-driven)
      errors.py                 — AppException hierarchy
      logging_config.py
    models/
      image.py                  — Image dataclass (the one real "model")
      base.py
    schemas/
      image.py, search.py, health.py  — Pydantic request/response schemas
    services/
      file_store.py             — the "database": metadata.json + locking
      local_storage.py          — image file storage on disk
      embedding.py               — primary embedding (DINOv2+head) + legacy CLIP rerank class
      reranking.py               — second-pass rerank scoring (disabled by default, see §4.3)
      cache.py                   — embedding cache (file-backed)
      event_log.py               — events.jsonl append-only audit log
      run_catalog.py             — runs.json (ILI run catalog) — NOT locked, see §12.2
      tag_catalog.py             — tags.json (reusable tag catalog)
    api/v1/endpoints/
      router.py                  — mounts every endpoint router
      library.py                 — CRUD + browse for library entries (largest file)
      search.py                  — image similarity search
      text_search.py             — text-to-image search
      batch_search.py            — batch image search (API-only, no frontend UI)
      images.py                  — image detail/lookup by ID
      health.py                  — health check
      ws_search.py                — WebSocket search (KNOWN BROKEN, see §12.1)
    middleware/
      error_handler.py           — global exception → JSON response + event log
      metrics.py                 — Prometheus middleware + /metrics
  tests/                          — pytest suite, one file per concern
  scripts/
    ingest_custom.py              — bulk image ingestion CLI
    show_stats.py                 — dependency-free events.jsonl dashboard
    evaluate.py                   — Precision@K/Recall@K/mAP retrieval eval harness,
                                     against the real library corpus or NEU-DET
    train_metric_head.py          — trains/cross-validates the metric-learning head
                                     on top of a frozen backbone (see §4.3, §7.2)
    migrate_embeddings.py         — re-embeds every entry after a primary-model swap
  app/ml/
    projection_head.py            — the trainable head's architecture (shared by
                                     train_metric_head.py and embedding.py, so
                                     training and serving can never drift apart)

frontend/
  src/
    App.jsx                       — root component, top-level routing/state
    components/
      LibraryBrowser.jsx          — browse/filter/detail/edit orchestration
      LibraryUpload.jsx           — Add/Edit entry form (largest component)
      ImageDetail.jsx             — detail/zoom view, edit/delete gate
      ResultsGrid.jsx, ReferenceCard.jsx  — result card rendering
      SimilarityFilter.jsx, StatusBar.jsx, ZoomableImage.jsx
    api/client.js                 — all backend calls
    lib/iliConstants.js           — shared enums/taxonomy (anomaly types, panels, etc.)
  main.js                         — Electron main-process entry (loosely wired, see §5.9)
  nginx.conf, Dockerfile           — production static-asset build (not the primary run path — see RUNNING_INSTRUCTIONS.md)
```

---

## 4. Backend Deep Dive

### 4.1 Data Model

There is a single real domain entity: **`Image`** (`backend/app/models/image.py`), a plain dataclass (not an ORM model — there's no ORM). Every catalogued anomaly is one `Image` record. Field groups:

- **Identity/core:** `id` (UUID string), `image_path` (primary media file), `additional_image_paths` (list, other panel images), `panel_tags` (list, aligned index-for-index with `[image_path, *additional_image_paths]` — see §4.3), `orientation_image_path` (structurally separate — never embedded/searched).
- **Embeddings:** `embedding` (primary vector, produced by the DINOv2+head model — see §4.3), `rerank_embedding` (optional second-model vector; currently unused, see §4.3), `media_embeddings` (list, per-panel-image vectors, lazily backfilled), `model_tag` (e.g. `"vit_base_patch14_dinov2.lvd142m+dinov2_base_head_v1"`), `rerank_model_tag`.
- **Inspection metadata:** `anomaly_type`, `identification`, `anomaly_id`, `anomaly_description` (the "Run ID" display field, derived from the run), `signal_description`, `differential_diagnosis`, `limitations_uncertainty`, `classification_status`, `wall_location`, `crack_image_angles`, `depth`, `width`, `length`, `run_number`, `zero_angle_frame_index`, `pipe_angle`.
- **QC fields:** `is_qc_flag`, `qc_raised_by`, `qc_reviewer`, `qc_decision_rationale`.
- **Interaction fields:** `interacts_with_other_features` (bool), `interaction_related_items` (list).
- **Tagging:** `tags` (list, freeform reusable tags from `tags.json`).
- **Provenance/audit:** `contributor_name`, `contributor_comment`, `created_at`, `updated_at` (the optimistic-concurrency version token — see §7.3), `revision_history` (append-only list of `{version, name, comment, timestamp}` dicts — **no dedicated Pydantic type exists for this**; it's an untyped `Optional[list]` on both the dataclass and the Pydantic schema, and `timestamp` is stored as an ISO **string**, not a `datetime`, specifically so `json.dumps` doesn't need a custom encoder).

**Two deliberately different update semantics** on `PUT /library/{id}` (`library.py`), documented in code comments — worth knowing before touching either:
- **Always-authoritative list fields** (`tags`, `panel_tags`): whatever the request sends fully replaces the stored list.
- **Tri-state-resolved scalar fields** (most metadata fields, via `_resolved`/`_resolved_num` helpers): a field **absent** from the request keeps its current value; an **explicit blank/empty string** clears it; any other value sets it. This lets a client update one field without having to resend every other field, while still allowing intentional clears.

### 4.2 Storage Layer

**`file_store.py`** is the closest thing this system has to a database. It persists every `Image` record as JSON inside `metadata.json` under `LIBRARY_DATA_DIR`. Every write:
1. Acquires a `portalocker` cross-platform advisory **exclusive lock** on the metadata file.
2. Writes to a temp file, then **atomically replaces** the real file via `os.replace()`.

This pattern (lock + atomic replace) is used consistently in `file_store.py` and `event_log.py`. **It is not used in `run_catalog.py`** — a real, currently-unaddressed inconsistency (see §12.2).

Key `FileStoreService` methods: `search` (vector similarity over all records), `get_image`, `get_raw_record`, `find_by_anomaly_id`, `upsert_image`, `delete_image`, `get_rerank_embeddings` (batch fetch for the rerank pass — unused while `rerank_enabled=False`, see §4.3), `get_model_tag_counts` (used by `scripts/migrate_embeddings.py` to confirm a migration's coverage), `get_distinct` / `get_distinct_list_field` (powers filter dropdowns), `ensure_panel_media_embeddings` (lazy per-panel embedding backfill), `get_cached_embedding` / `set_cached_embedding`.

**`local_storage.py`** stores the actual image bytes on disk (not in the metadata file), keyed by path convention: `library/{uuid}.ext` for user-uploaded library images, `custom/{label}/{filename}` for bulk-ingested datasets.

**Feedback/voting was removed and then reintroduced.** An earlier change fully removed a vote-based feedback feature; a later change re-added it (`app/models/feedback.py`, `feedback.json`, `FileStoreService.add_feedback`/`get_net_votes`, and a small vote-weighted score adjustment in `search.py`). There is currently no frontend UI to actually cast a vote, so `feedback.json` stays empty and the adjustment is a no-op in practice — but the code path is live. Confirm with the team whether this is an intentional restart of the feature before building anything further on it.

### 4.3 Embedding & Search

**Primary model: frozen DINOv2 backbone + a trained metric-learning head** (`embedding.py`'s `Dinov2HeadEmbeddingService`, `app/ml/projection_head.py`, `core/config.py`):
- **Backbone:** `vit_base_patch14_dinov2.lvd142m` (Meta's DINOv2, loaded via `timm`) — self-supervised, trained on pure visual structure with **no text/caption alignment at all**, unlike CLIP. Always frozen; never fine-tuned.
- **Head:** a small trainable projection (`ProjectionHead`: Linear → ReLU → Dropout → Linear, ~230K parameters, L2-normalized output) sitting on top of the frozen backbone's features, trained with a triplet-margin loss on the labeled anomaly library (`anomaly_type`/`identification` as supervision). Weights are stored at `LIBRARY_DATA_DIR/models/dinov2_base_head_v1.pt` (`Settings.metric_head_path`) — data, not code, so it lives alongside `metadata.json` and gets the same Dropbox-backed versioning for free (see §7.1).
- **Why not CLIP:** measured, not assumed — `scripts/evaluate.py` and `scripts/train_metric_head.py` benchmarked this against the previous CLIP ViT-L/14 → ViT-H/14 cascade directly on the real, labeled anomaly corpus (not a public benchmark) and it won on every ranking-quality metric. The full, dated record of every evaluation run — including the numbers that justified this — is in `model_registry.json`.
- **Why not fine-tune the backbone:** with a labeled corpus in the tens-to-low-hundreds, fine-tuning a multi-hundred-million-parameter transformer would mostly memorize the training set. A small trainable head on frozen features is a much better fit for this much data — see §7.2.
- **Cost:** DINOv2 has no text encoder, so there is no shared text/image embedding space anymore. `POST /search/text` now fails cleanly with a `503 ServiceUnavailableError` (`Dinov2HeadEmbeddingService.get_text_embedding` raises explicitly, caught by the same global exception-handler middleware as every other `AppException`) rather than crashing — see §12 for whether this matters given the endpoint's frontend usage.
- Every embedding is tagged with the exact backbone+head that produced it (`model_tag`, e.g. `"vit_base_patch14_dinov2.lvd142m+dinov2_base_head_v1"`). Search **filters out any embedding whose tag doesn't match the currently-configured model** — this is what prevents a model swap from silently comparing incompatible vector spaces. After any primary-model change, `scripts/migrate_embeddings.py` must be run to re-embed every existing entry (with retry-on-`OSError` built in — Dropbox's own sync client can transiently lock `metadata.json` between rapid successive writes) or the whole library simply stops appearing in search results.

**Rerank cascade — present in code, disabled by default** (`reranking.py`, `Settings.rerank_enabled = False`): the CLIP ViT-H/14 second-stage reranker that used to sit behind the old CLIP primary is still fully implemented (`EmbeddingService`, the original CLIP-based class, unchanged) but not loaded at startup, since it was specifically the model DINOv2+head was measured against and beat — there is no evidence it still helps paired with the new primary, because that combination has never been evaluated. Re-enable only after measuring it (`scripts/evaluate.py --cascade` supports arbitrary model-key pairings for exactly this).

A **model registry log** (`model_registry.json`) records every evaluation run and every deployment event (which model went live, when, and why) — anyone can check it to see what accuracy was actually verified for the model currently in production, not just trust a config value.

**Panel-scoped search** — the ability to search *within a specific ILI Open Panel view type* (Beamforming, Raw, Plot, Image, Heatmap, Multi Section, Cross-Section, Dent Sizing, Tool Pose — the canonical list lives in `frontend/src/lib/iliConstants.js`'s `PANEL_TAG_OPTIONS`, mirrored conceptually on the backend):
- Each `Image` can have multiple media files (`image_path` + `additional_image_paths`), each tagged with which panel view it represents (`panel_tags`, index-aligned).
- `media_embeddings` holds a **separate embedding per panel image**, not just one embedding for the primary image. This means a "Beamforming Panel" search compares the query against the Beamforming screenshot specifically, not against whichever image happens to be primary.
- These per-panel embeddings are **lazily backfilled** (`ensure_panel_media_embeddings`) — older records without them get embedded on first access rather than requiring a bulk migration.
- **Panel-scoped queries always skip the rerank cascade** (`search.py`) — rerank embeddings are only computed/stored for the primary image, not per-panel, so there's nothing to rerank against for a non-primary panel query.

**Embedding cache** (`cache.py`): file-backed, keyed by image content hash + model tag, pruned by `Settings.cache_ttl_days` (default 7) on write since there's no Redis TTL. Shared across the primary-search cache-hit/cache-miss accounting reported in `events.jsonl`.

### 4.4 API Endpoint Layer

All routes are mounted under `/api/v1` (`router.py`). Endpoint-by-endpoint:

**`library.py`** (largest, most complex file) — CRUD + browse for library entries:
- `GET /library/browse` — filterable listing. Supports `q` (free text, matched against a defined haystack of fields), `anomaly_types`, `identifications`, `panel_tags`, `wall_locations` (all comma-joined multi-value), `run_number`, `classification_status`, `interacts_with_other_features`. The schema also accepts `anomaly_status`, `depth_min/max`, `width_min/max`, `length_min/max` — **none of these are wired up in the current frontend filter UI**, i.e. they're reachable only via direct API calls today.
- `GET /library/filters` — distinct-value lists to populate filter dropdowns (run numbers, etc.).
- `GET /library/runs`, `POST /library/runs` — the run catalog; `POST` is passkey-gated.
- `GET /library/tags`, `POST /library/tags` — the tag catalog; `POST` is passkey-gated.
- `POST /library/verify-passkey` — no-side-effect passkey check, used by the frontend to gate the Edit/Delete UI *before* the user fills out a form (see §5.3/§7.4).
- `POST /library/upload` — create a new entry (multipart: files + orientation image + metadata form fields).
- `PUT /library/{image_id}` — edit an existing entry. This is the most complex single endpoint in the system. Validation/side-effect order:
  1. Passkey check (`X-Delete-Passkey` header) → `ForbiddenError` (403) if wrong.
  2. Not-found check → `NotFoundError` (404), with the message *"This entry no longer exists — it may have been deleted by someone else. Please reload the library."*
  3. **Optimistic concurrency check** — if the request includes `expected_updated_at`, it's compared against the stored record's `updated_at`; mismatch → `ConflictError` (409). See §7.3 for the full story.
  4. Track/identification/anomaly_id validation.
  5. `contributor_name` requirement.
  6. **Revision-history append** — every successful edit appends a new `{version, name, comment, timestamp}` entry.
  7. Interaction-fields validation.
  8. Media reorder/removal logic — **the "can't remove the last image" guard is checked before any file I/O happens**, so a doomed request fails cleanly without touching disk.
  9. Orientation-image replace/remove logic.
  10. Embedding reuse-vs-recompute logic (unchanged media keeps its existing embedding; new/replaced media gets re-embedded).
- `DELETE /library/{image_id}` — passkey-gated hard delete.

**`search.py`** — image similarity search (`POST /search/similar` in current frontend usage). Flow: embed the uploaded image (checking the cache first) → if a `panel_tag` filter is present, ensure per-panel media embeddings exist (lazy backfill) → decide whether to run the rerank cascade (skipped for panel-scoped queries) → compute per-result URL and `media_index` → log a `search` event to `events.jsonl`. Rate-limited to **30 requests/minute per client IP** (`slowapi`, the only rate-limited endpoint in the system).

**`text_search.py`** — same shape as image search but embeds a text query instead of an image. **Currently non-functional**: the primary embedding model (DINOv2) has no text encoder, so `embedding_service.get_text_embedding()` raises a `ServiceUnavailableError` (503) — no code change needed to keep this endpoint failing cleanly, since the global exception handler already catches it. Was already unused by the frontend before this (`searchByText` in `client.js` is a dead export, no UI calls it) — see §12.

**`batch_search.py`** — accepts multiple images, runs search for each, tracked via an **in-memory job store**. Confirmed **not called from any frontend code** — it's a deliberate API-only capability, not dead code, but the in-memory job store means jobs don't survive a restart and aren't safe across multiple worker processes. Treat as single-worker/dev-tool-grade unless that's addressed.

**`images.py`** — image detail lookup by ID. Has its own URL-building logic that duplicates similar logic in `library.py` (a minor cross-cutting inconsistency, not a bug — see §12.4).

**`health.py`** — `GET /health`. Reports overall status plus an `embedding_model` sub-status (renamed from `clip` when the primary model stopped being CLIP); it's **cosmetic** — it doesn't currently affect the overall health verdict, so a broken embedding-model load wouldn't flip health to unhealthy.

**`ws_search.py`** — WebSocket search endpoint. **Confirmed broken** — see §12.1.

### 4.5 Middleware & Startup

`main.py` — app construction and lifespan:
- **Startup sequence:** connect file store → connect event log → connect local image storage → load primary embedding model (DINOv2 backbone + trained head) → (if `rerank_enabled`, off by default) load the legacy CLIP rerank model → connect cache service. Each step's failure is **logged but does not prevent startup** — the app will come up even with a broken storage/model layer, surfacing the problem via `/health` instead of a crash-on-boot. This is a deliberate degrade-gracefully choice, but means a silent misconfiguration can look "up" while actually non-functional; check `/health` after any config change.
- **Middleware order:** CORS (fully open — `allow_origins=["*"]`) → Prometheus metrics middleware → exception handlers (`AppException`, `RequestValidationError`, Starlette `HTTPException`, `RateLimitExceeded`, catch-all `Exception`).
- **Every error response of any kind is also written to `events.jsonl`** via the error-handler middleware, not just successful operations — so `show_stats.py`'s error-rate figure is trustworthy without extra instrumentation.
- **Static frontend mount:** `frontend/dist/` (if it exists) is mounted at `/`, so the backend alone serves the whole app on one port; this mount is skipped gracefully if the frontend hasn't been built (dev-backend-only or CI).
- `/api/v1/info` — moved off `/` specifically to free that path for the frontend static mount.
- `/metrics` — Prometheus endpoint, additive to the `events.jsonl` observability story (§4.7), not a replacement for it.

### 4.6 Configuration (`Settings`, `core/config.py`)

All environment-driven, loaded from `.env`, case-insensitive:

| Setting | Default | Purpose |
|---|---|---|
| `app_name` | `"Inspection Image Similarity Engine"` | FastAPI title — **stale, doesn't match current "ILI Reference Library" branding** (see §12.6) |
| `app_version` | `"1.0.0"` | |
| `environment` | `"development"` | `development \| production \| test` |
| `api_host` / `api_port` | `0.0.0.0` / `8000` | |
| `library_data_dir` | `./data/library` | **The** storage root — metadata.json, images/, tags.json, runs.json, events.jsonl, embedding cache all live under here. In production this is pointed at a synced Dropbox folder for free versioning/backup — see RUNNING_INSTRUCTIONS.md. |
| `primary_backbone_name` | `vit_base_patch14_dinov2.lvd142m` | Frozen DINOv2 backbone (`timm`) for the primary embedding model |
| `metric_head_path` | `models/dinov2_base_head_v1.pt` | Trained head weights, relative to `library_data_dir` |
| `metric_head_hidden_dim` / `metric_head_embed_dim` | `256` / `128` | Head architecture — must match the checkpoint it loads |
| `clip_model_name` / `clip_pretrained` | `ViT-L/14` / `openai` | Legacy CLIP settings — only used by the (disabled-by-default) rerank model below, not the primary |
| `clip_device` | `cpu` | `cpu` or `cuda` — used by both the primary and rerank models |
| `inference_workers` | `4` | |
| `rerank_enabled` | `False` | Off by default — the CLIP cascade this used to sit behind is exactly what DINOv2+head was measured against and beat; that pairing has never been evaluated. See §4.3 |
| `rerank_model_name` / `rerank_pretrained` | `ViT-H-14` / `laion2b_s32b_b79k` | |
| `rerank_candidates` | `50` | Shortlist size the rerank model re-scores |
| `cache_ttl_days` | `7` | Embedding cache entry lifetime |
| `log_level` | `INFO` | |
| `library_delete_passkey` | `"admin123"` | Single shared passkey gating delete/edit/add-run/add-tag — explicitly **not a real auth system**, see §7.4 |

### 4.7 Event Logging & Observability

`event_log.py` appends one JSON line per event to `LIBRARY_DATA_DIR/logs/events.jsonl`, using the same lock+atomic-write pattern as `file_store.py`. Confirmed live event types emitted by current code: `upload`, `update`, `delete`, `search`, `error`. `scripts/show_stats.py` reads this file to report p50/p95 search latency, error rate, and embedding cache hit rate over a time window — deliberately dependency-free (no Prometheus/Grafana required), though the Prometheus `/metrics` endpoint still exists alongside it.

### 4.8 Errors

All custom exceptions derive from `AppException` (`core/errors.py`) and carry a message, an `error_code`, an HTTP `status_code`, and optional structured `details`:

| Class | Code | Status | Used for |
|---|---|---|---|
| `ValidationError` | `VALIDATION_ERROR` | 400 | Bad input (file type, missing field) |
| `NotFoundError` | `NOT_FOUND` | 404 | Missing resource |
| `ConflictError` | `CONFLICT` | 409 | Stale edit — someone else changed/deleted the record since it was loaded (see §7.3) |
| `ForbiddenError` | `FORBIDDEN` | 403 | Missing/incorrect delete passkey |
| `ServiceUnavailableError` | `SERVICE_UNAVAILABLE` | 503 | Reserved for external-service outages (currently unused in practice — there are no longer any external services to be unavailable, a vestige of the pre-file-store architecture) |

---

## 5. Frontend Deep Dive

No external state-management library — every component uses local `useState`/`useMemo`/`useRef`, with state lifted only as far as the nearest common ancestor that needs it. `frontend/src/api/client.js` is the sole point of contact with the backend.

### 5.1 `App.jsx` — Root Component

Top-level state machine:
- `mode`: `"browse" | "add" | "search"` — the three top-level pages.
- Within `mode === "search"`, a nested `state`: `"idle" | "searching" | "results" | "detail"`.
- `results`, `selectedResult`, `filteredResults` (derived via `useMemo`, filtered by the `SimilarityFilter` range).
- `searchPanelTag` (header dropdown selection) vs `activeSearchPanelTag` (frozen at the moment a search actually fires — shown as "Panel scope" in the results sidebar).
- `isDark` theme flag, persisted to `localStorage`.

**Panel-scoped image search flow:** the header has a panel `<select>` and a "Search by image" button. Clicking the button without a panel picked shows an inline error instead of opening the file dialog (checked twice — once at the button handler, again at the file-input's `onChange`, as defense in depth). Once a file is picked, `handleSearch(file, panelTag)` fires the actual `POST /search/similar` call with `panel_tag` in the filters.

**Dirty-form leave-guard:** `LibraryUpload` reports its own dirty state up via `onDirtyChange`. If the user tries to navigate away from a dirty Add Entry form (clicking Library/another tab, the logo/home button, or starting an image search), navigation is intercepted and a "Discard unsaved entry?" modal appears instead of silently losing data. A `beforeunload` listener also warns on tab-close while dirty. This guard applies **only** to the top-level "Add Entry" tab instance of `LibraryUpload` — the edit-mode instance (rendered inside `LibraryBrowser`) is a separate mount and isn't covered by this specific guard.

**Composition:** `App.jsx` renders `LibraryBrowser` (self-contained, no props) for browse mode, `LibraryUpload` for add mode, and `ResultsGrid`/`SimilarityFilter`/`ImageDetail` for search mode. The search-result `ImageDetail` instance is explicitly **read-only** — no `allowEdit`/`allowDelete`/`adminPasskey` props are passed, so editing/deleting an anomaly is only reachable from the Library tab, never from search results.

### 5.2 `LibraryBrowser.jsx` — Browse/Filter/Detail/Edit Orchestration

Owns the filter state (`EMPTY_FILTERS`: `q`, `anomaly_types`, `identifications`, `panel_tags`, `wall_locations`, `run_number`, `classification_status`, `interacts_with_other_features`) and mediates between three views: the results grid, `ImageDetail` (`selected`), and `LibraryUpload` in edit mode (`editingItem`).

**The per-anomaly admin-passkey unlock** (`adminPasskey`, `handleUnlock`, `lockAdmin`) lives here, not globally:
- `handleUnlock(passkey)` calls the no-side-effect `POST /library/verify-passkey` and only sets `adminPasskey` on success.
- It's scoped to whichever anomaly is currently open — cleared on navigating to a different item (`goToBrowseItem`), on leaving the detail view (`onBack`), after a successful delete (`onDeleted`), after a successful edit save (`onSuccess`), and on any 403 from a subsequent action (`onAuthError`).
- It **survives** Edit → Cancel (going back to the same item's detail view) — the user doesn't have to re-enter the passkey to then try Delete on the same anomaly.

`ReferenceCard` is rendered here **without** `similarityScore` (browse-mode card layout: ID/title left, type/run badges right, no score row) — contrast with `ResultsGrid`'s search-mode cards (see §5.5).

### 5.3 `LibraryUpload.jsx` — Add/Edit Entry Form

The largest component (~1500 lines). A single `form` state object holds every metadata field; `isEditMode = Boolean(editingImage)` branches behavior throughout:

- **Media handling:** new files and (in edit mode) existing media are managed as parallel arrays with a shared combined-index space — surviving existing images first, then new uploads, matching the order the backend expects (`library.py`'s media-reorder logic). Each image gets its own panel-tag `<select>` and a "Make primary" toggle. Removing an existing image marks it `removed: true` rather than splicing the array, so the original index stays stable for the backend's `remove_media` index list.
- **Orientation image:** entirely separate file state/input from the main media picker — structurally impossible for it to end up as searchable media (per an explicit code comment in `client.js`).
- **Tags:** a real `<select>` of existing tags (filtered to exclude already-selected ones) plus a synthetic "+ Add new tag…" option that opens a small passkey-gated mini-form (`addTag`, admin-passkey-gated backend call) — this is the "real dropdown, not just free text" behavior from a recent change.
- **Runs:** same pattern — a `<select>` with a passkey-gated "add new run" mini-form; picking a run auto-fills the read-only "Run ID" field.
- **Interaction fields:** a Yes/No control; selecting "Yes" reveals a chip multi-select (deduped union of anomaly types + component types) and requires at least one selection.
- **Concurrency:** in edit mode, `payload.expected_updated_at = editingImage.image.updated_at` is set right before calling `updateLibraryEntry` — this is what lets the backend's `ConflictError` check (§4.4, §7.3) detect a stale edit.
- **Validation:** required fields enforced client-side before submit (`anomaly_type`, `run_number`, `identification`, `anomaly_id`, `classification_status`, `wall_location`, `contributor_name`, `signal_description`, `differential_diagnosis`, `limitations_uncertainty`, `interacts_with_other_features`, plus conditional requirements for crack angle, interaction items, and per-type dimension fields), plus numeric-format checks. Server-side field errors (`err.details?.field`) also populate the same error state post-hoc.
- **Behavioral difference between modes:** create-mode success shows a local "Saved to Library" screen with an "Upload Another" reset; edit-mode success has **no local screen** — it hands the result to the parent (`LibraryBrowser`), which navigates straight to the updated detail view.
- A `notes` field exists in form state but is deliberately deleted from the payload before submit — effectively dead/unused (harmless, but worth knowing if you're tracing "why doesn't Notes save").

### 5.4 `ImageDetail.jsx` — Detail/Zoom View

Three view modes: **Focus** (single zoomable image, default), **Panels** (mosaic of every panel image, sorted by canonical panel order, clickable to jump into Focus on that image), **Split** (current image side-by-side with the orientation reference image, only available if one exists).

**`currentPanelTag`/`media_index` resolution** is the key piece of dual-purpose logic: a panel-scoped *search result* carries a single `image_url` plus a `media_index` telling which panel slot it matched; a *library browse* item instead carries the full `media_urls` array already in panel order, with no `media_index`, falling back to local `mediaIdx` navigation state. Get this wrong and panel-scoped search results will show the wrong panel label.

**Edit/Delete gate:** shown only once `adminPasskey` is set (passed down as a prop from `LibraryBrowser`); before that, a single inline unlock form is shown instead of the buttons. This is deliberately upfront — the passkey is checked *before* a user invests time filling out an edit form, not buried at the bottom of it (see §7.4). Delete requires an explicit "DELETION CANNOT BE UNDONE" confirmation step.

**Reuse across two call sites** with materially different prop sets — see the table in §5.1: the search-result detail view passes no `allowEdit`/`allowDelete`/`adminPasskey` props at all (fully read-only), while the library-browse detail view wires all of them plus delete/edit callbacks.

### 5.5 `ResultsGrid.jsx` / `ReferenceCard.jsx`

`ReferenceCard` is the one shared card component for both contexts, switching layout based on whether `similarityScore` is non-null: **search mode** shows anomaly ID, identification + similarity percentage, type badge + run number; **browse mode** shows anomaly ID + identification on the left, type/run "aside" on the right, no score.

### 5.6 Supporting Components

- **`SimilarityFilter.jsx`** — dual-thumb 0–100% range slider filtering search results by similarity score; only rendered in search mode.
- **`StatusBar.jsx`** — fixed footer: backend health dot (green/orange/red) plus, only in search mode, result count and timing figures.
- **`ZoomableImage.jsx`** — scroll-to-zoom (up to 6x) + drag-to-pan + double-click-reset; self-resets whenever its `src` changes.

### 5.7 `api/client.js`

Every backend call is centralized here. Base URL detection: `isElectron = window.location.protocol === "file:"` → `http://localhost:8000/api/v1`; otherwise a relative `/api/v1` (proxied by nginx in the Docker path, or same-origin when the backend serves the built frontend directly per `RUNNING_INSTRUCTIONS.md`'s primary run path).

Confirmed **removed** (consistent with earlier feature-removal work): `submitFeedback`, `getExplainability` — neither exists.

**Dead exports** (implemented, backend routes exist, but not called from any current frontend UI): `getImageDetail`, `searchByText` (no text-search UI exists yet), `createSearchWebSocket` (no WebSocket UI exists, and see §12.1 — the backend side is broken anyway).

`uploadToLibrary`'s metadata filtering **drops** empty/null/undefined fields; `updateLibraryEntry`'s **sends** every non-`undefined` key including empty strings. This asymmetry is intentional, not a bug — on edit, an empty string is the signal to *clear* a field (see the tri-state-resolved fields in §4.1); on create, there's nothing to clear yet, so blanks are simply omitted.

### 5.8 `lib/iliConstants.js`

The shared taxonomy: `ANOMALY_TYPES`, `COMPONENT_OPTIONS`, `INTERACTION_OPTIONS` (deduped union of the two), `CLASSIFICATION_STATUS_OPTIONS`, `WALL_LOCATION_OPTIONS`, `CRACK_IMAGE_ANGLE_OPTIONS`, `DIMENSION_REQUIREMENTS` (which dimension fields are required per anomaly type), `IDENTIFICATION_BY_TYPE` (curated identification options per anomaly type) plus `IDENTIFICATION_DEFAULTS` (pre-selected default per type), `STATUS_COLORS`, `ACCEPTED_IMAGE_TYPES`, `PANEL_TAG_OPTIONS` (the 9 ILI Open Panel view types), `RUN_OPTIONS`/`RUN_DESCRIPTIONS` (fallback run catalog if the live `/library/runs` call fails).

**This file is the single source of truth for the taxonomy on the frontend** — adding a new anomaly type, panel type, or identification option starts here (see §11).

### 5.9 Build, Deployment Shape, Electron

`package.json`: React 18 + Vite only as real dependencies; `npm run dev` (hot-reload dev server, port 5173, proxies `/api` to the backend) and `npm run build` (static `dist/` output) are the two scripts that matter. **No `electron` package dependency and no electron build script exist**, despite `frontend/main.js` (an Electron main-process entry that loads `dist/index.html` in a `BrowserWindow`) being present in the repo. The Electron shell is a loosely-wired manual/local workflow, not a first-class CI/build target — see §12.5.

**Production build path (Docker):** two-stage — `node:20-alpine` runs `npm ci && npm run build`, then `nginx:alpine` serves the static `dist/` output. **This is not the primary documented run path** — `RUNNING_INSTRUCTIONS.md` describes the backend serving the built frontend directly at `/` as the normal way to run this (single process, single port, no Docker/nginx needed). The Dockerfile/nginx path still exists and works but is secondary.

---

## 6. End-to-End Data Flow Walkthroughs

### 6.1 Search by Image

1. User picks (optionally) a panel scope, then a file via the header's hidden file input.
2. `App.jsx.handleSearch` → `searchSimilar(file, {panel_tag})` → `POST /api/v1/search/similar` (multipart, rate-limited 30/min/IP).
3. Backend (`search.py`): compute or fetch-from-cache the query embedding → if panel-scoped, lazily ensure per-panel media embeddings exist for the corpus → run the primary vector search across `file_store_service` → if not panel-scoped and `rerank_enabled`, re-score the top `rerank_candidates` with the heavier rerank model (`reranking.py`) → build per-result `image_url`/`media_index` → log a `search` event.
4. Frontend renders `ResultsGrid` of `ReferenceCard`s; `SimilarityFilter` narrows by score client-side (no re-fetch); clicking a card opens the read-only `ImageDetail`.

### 6.2 Upload a New Library Entry

1. User fills the Add Entry form (`LibraryUpload`, create mode) — media files with per-image panel tags and a primary selection, optional orientation image, full metadata, tags, contributor name.
2. Client-side validation blocks submit on any missing required field.
3. `uploadToLibrary(files, payload, orientationFile)` → `POST /library/upload` (multipart).
4. Backend embeds the primary image (and, lazily, other panel images later on first panel-scoped search or edit), stores files via `local_storage.py`, writes the new `Image` record via `file_store.py` (locked, atomic write), logs an `upload` event.
5. Frontend shows a local "Saved to Library" screen with an "Upload Another" reset option.

### 6.3 Edit an Existing Entry (with Concurrency Protection)

1. User opens an anomaly from the Library tab (`LibraryBrowser`), unlocks Edit/Delete via the passkey gate, clicks Edit.
2. `LibraryUpload` (edit mode) pre-populates from the existing record; `editingImage.image.updated_at` is captured at this moment.
3. On submit, the payload includes `expected_updated_at` = that captured value, plus media reorder/remove instructions and the already-verified `adminPasskey`.
4. Backend (`library.py` `PUT /{image_id}`): passkey check → not-found check → **compare `expected_updated_at` against the record's current `updated_at`; if someone else edited or deleted-and-recreated it since this client loaded it, reject with `409 ConflictError`** rather than silently overwriting → the rest of the validation/update pipeline (§4.4) → append a `revision_history` entry → re-embed only the media that actually changed.
5. On success, `LibraryBrowser` clears the edit state, re-locks the admin passkey, and navigates straight to the freshly-updated detail view (no intermediate success screen, unlike create mode).
6. On a `409`, the user sees a clear "someone else changed this" message instead of either a silent overwrite or a confusing failure — this is the fix for the exact two-person race condition reported by the user (delete-while-editing, and the more dangerous silent double-edit-overwrite case).

### 6.4 Delete an Entry

1. From `ImageDetail` in browse mode, with the passkey already unlocked: Delete Entry → explicit "DELETION CANNOT BE UNDONE" confirmation.
2. `deleteLibraryEntry(id, adminPasskey)` → `DELETE /library/{id}` (passkey-gated, no concurrency token needed since delete has no "stale copy" concept the way edit does).
3. Backend removes the record (locked, atomic write) and logs a `delete` event.
4. Frontend clears the detail view, re-locks the passkey, and refreshes the library grid.

---

## 7. Key Design Decisions

### 7.1 File-Based Storage Instead of a Database
Chosen to fit a small-team, low-write-concurrency tool with zero infrastructure to operate: no Postgres/Qdrant/MinIO/Redis to run, patch, or back up. `LIBRARY_DATA_DIR` is pointed at a Dropbox-synced folder in the current production setup, which gives free version history and delete-recovery with zero custom backup code. The tradeoff, explicitly documented in `RUNNING_INSTRUCTIONS.md`, is that this only works safely with **one backend instance at a time** against a given shared folder — cross-machine write races aren't coordinated by the in-process file locks.

### 7.2 A Frozen Self-Supervised Backbone + a Small Trained Head, Not Fine-Tuning
CLIP's caption-alignment training doesn't transfer well to industrial-inspection imagery it never saw anything like during pretraining (beamforming panels, UT plots, corrosion heatmaps); a self-supervised backbone with no text bottleneck (DINOv2) measurably fit this domain better. But the labeled corpus is small — tens to low hundreds of images — nowhere near enough to fine-tune a multi-hundred-million-parameter transformer without it just memorizing the training set. The chosen middle ground: freeze the backbone entirely, train only a small (~230K-parameter) projection head on top with a triplet loss, evaluated with K-fold cross-validation (not a single train/test split, given how thin some classes are) so the reported numbers reflect genuine generalization, not memorization. Every embedding is tagged with its exact backbone+head identity (`model_tag`) so a future model swap can't silently produce nonsense similarity scores by comparing incompatible vector spaces — mismatched embeddings are filtered out rather than compared. `model_registry.json` keeps the full, dated history of every evaluation and every deployment.

### 7.3 Optimistic Concurrency on Edits
`Image.updated_at` doubles as a version token. Edits can optionally supply `expected_updated_at`; a mismatch raises `409 ConflictError`. This is intentionally lightweight (no locking/reservation system) — appropriate for a tool where edit conflicts are rare but costly (silent data loss) rather than frequent.

### 7.4 Upfront Passkey Gating, Not Buried in the Form
Edit/Delete are gated behind a single `POST /library/verify-passkey` check, surfaced *before* the Edit form is even opened, scoped to the currently-open anomaly (not the whole session). This avoids the earlier failure mode of a user filling out an entire edit form only to discover at submit time they lack the passkey. It is explicitly documented as a speed bump against accidental changes, not real authentication/authorization — a single shared passkey with no per-user identity or per-role distinction.

### 7.5 Structural Separation of Orientation Images from Searchable Media
The orientation reference image is stored and uploaded through an entirely separate code path from the panel media images specifically so it can never accidentally end up embedded or returned as a search result.

### 7.6 Always-Authoritative Lists vs. Tri-State Scalars
See §4.1. A deliberate API design choice that lets partial-field edits work correctly (only send what changed) while still supporting explicit "clear this field."

---

## 8. Concurrency & Data Integrity

- **Same-machine, multi-process safety:** `portalocker` exclusive locks + atomic `os.replace()` writes in `file_store.py` and `event_log.py` protect against corruption from concurrent requests on one machine.
- **Cross-machine safety is NOT provided** by the above — only one backend instance should run against a given `LIBRARY_DATA_DIR` at a time (see §7.1). This is a process/deployment discipline, not something the code enforces.
- **Edit-vs-edit and edit-vs-delete races between users** are caught by the optimistic-concurrency check (§7.3) — a stale client gets a clear `409` instead of silently clobbering someone else's change or hitting a confusing failure.
- **`run_catalog.py` does not use the lock+atomic-write pattern** used everywhere else — a genuine gap, see §12.2.
- **`batch_search.py`'s job store is in-memory** — not safe across restarts or multiple worker processes; fine for the single-instance deployment model this system currently uses, but would need rework before scaling out workers.

---

## 9. Deployment

**Primary path (per `RUNNING_INSTRUCTIONS.md` — this is the one actually in use):**
1. `backend`: Python 3.11 venv, `pip install -r requirements.txt`, configure `.env` (critically, `LIBRARY_DATA_DIR`).
2. `frontend`: `npm install && npm run build` (produces `frontend/dist/`).
3. Run `python -m uvicorn app.main:app --host 0.0.0.0 --port 8000` from `backend/` — this single process serves both the API and the built frontend at `/`. Binding to `0.0.0.0` means anyone on the LAN can reach it at the host machine's IP.
4. No Docker, no separate services, no reverse proxy required for this path.

**Secondary path (Docker/nginx):** `docker-compose`-free — actually just a `Dockerfile` for the frontend only, building a static nginx image. Exists and works but is not the documented day-to-day workflow; treat `README.md`'s six-service Docker Compose description as stale (see §12.1).

**Backups:** free, via whatever cloud-sync client (Dropbox today, SharePoint/OneDrive would work identically) `LIBRARY_DATA_DIR` lives inside — every write is already an atomic replace, so each save is a clean version in that sync client's history; accidental deletes are covered by the sync client's trash/recovery.

**Observability:** `LIBRARY_DATA_DIR/logs/events.jsonl` (upload/update/delete/search/error events) + `python -m scripts.show_stats [--hours N]` for a p50/p95 latency, error-rate, cache-hit-rate summary. The Prometheus `/metrics` endpoint is additive, not primary.

---

## 10. Testing

`backend/tests/` — pytest, one file per concern: `test_health.py`, `test_models.py`, `test_services.py`, `test_embedding.py`, `test_search.py`, `test_images.py`, `test_library.py` (largest — covers CRUD, passkey gating, and the concurrency/`ConflictError` behavior in a dedicated `TestUpdateLibraryEntryConcurrency` class), `test_ingestion.py`. Run with:

```bash
cd backend
python -m pytest tests/ -q
```

CI runs the full suite on every push (GitHub Actions workflow, see commit `175a9c7`). There's no frontend automated test suite currently — frontend changes are verified by building (`npm run build`) and manual/live interaction against a running backend.

**When you touch the DB shape** (`Image` dataclass / Pydantic schemas): update the corresponding fields in `test_models.py`, any ORM-mock-equivalent test fixtures in `test_library.py`/`test_services.py`, and the Pydantic schemas together in the same change — this project has a documented history of tests and schema drifting apart (see `CLAUDE.md`).

---

## 11. Common Maintenance Tasks

**Add a new anomaly type / identification option / panel tag / component type:**
Start in `frontend/src/lib/iliConstants.js` — add to the relevant array (`ANOMALY_TYPES`, `IDENTIFICATION_BY_TYPE`, `PANEL_TAG_OPTIONS`, `COMPONENT_OPTIONS`). Check `DIMENSION_REQUIREMENTS`/`IDENTIFICATION_DEFAULTS` if the new type needs required-dimension or default-identification behavior. The backend generally treats these as free strings (no backend-side enum to update), but confirm nothing in `library.py`'s validation hardcodes the old list.

**Add a new metadata field to library entries:**
1. `backend/app/models/image.py` — add to the `Image` dataclass.
2. `backend/app/schemas/image.py` — add to the relevant Pydantic schema(s); decide if it's a tri-state-resolved scalar or an always-authoritative list (§4.1) and follow the matching pattern in `library.py`'s update handler.
3. `frontend/src/components/LibraryUpload.jsx` — add to `EMPTY_FORM`, the form UI, `validate()` if required, and the submit payload mapping.
4. Update `test_models.py` and `test_library.py` together (per §10's guidance).

**Add a new admin-passkey-gated action** (like Add Run / Add Tag): follow the existing pattern in `library.py` — check `X-Delete-Passkey` against `settings.library_delete_passkey`, raise `ForbiddenError` on mismatch. Remember this is a single shared secret with no per-user distinction (§12.7) — don't build anything that assumes it identifies *who* made a change (that's what `contributor_name`/revision history is for).

**Evaluate a candidate model change before adopting it:** run `python -m scripts.evaluate` (grouped by `anomaly_type` and/or `identification`) to benchmark any `open_clip` or `timm` backbone against the real labeled corpus via leave-one-out Precision@K/Recall@K/mAP — this is what actually justified the current DINOv2+head choice, not a guess. To test whether a trained head helps a candidate backbone, use `python -m scripts.train_metric_head`, which K-fold cross-validates so the numbers reflect real generalization. Both append every run to `model_registry.json`.

**Swap or upgrade the primary embedding model:** change `Settings.primary_backbone_name`/`metric_head_path` (or `clip_model_name`/`clip_pretrained` for the legacy rerank model) in `.env`, train/save a new head if needed, restart the backend, then run `python -m scripts.migrate_embeddings` — existing embeddings keep their old `model_tag` and are automatically excluded from comparison against the new model's queries (§4.3/§7.2) until re-embedded, so without this step the whole library simply stops appearing in search results, not just returns worse results. The script backs up `metadata.json` first and retries transient `OSError`s (Dropbox's sync client can momentarily lock the file between rapid successive writes).

**Investigate a production issue:** start with `LIBRARY_DATA_DIR/logs/events.jsonl` and `python -m scripts.show_stats`. Every error response is logged there regardless of source, so it's the fastest way to see what's actually failing before diving into code.

---

## 12. Known Limitations / Technical Debt

Documented here deliberately — a maintenance-focused document should not hide known issues.

1. **`README.md` and `LEARNING.md` describe a stale architecture** (Postgres + Qdrant + MinIO + Redis, `docker compose up -d --build` as the primary path). The actual current system is the flat-file backend described in this document and in `RUNNING_INSTRUCTIONS.md`. These docs need a rewrite; until then, trust `RUNNING_INSTRUCTIONS.md` and the code over `README.md`/`LEARNING.md` for anything architecture-related.
2. **`ws_search.py` is broken.** `file_store_service.search()` returns 3-tuples; the WebSocket handler unpacks results as 2-tuples (`for idx, (image, score) in enumerate(matches)`), which raises `ValueError` on any non-empty result set. It's caught by a generic handler that returns an error to the client, so it fails silently-ish rather than crashing the server — but the endpoint is currently non-functional. No frontend code calls it (`createSearchWebSocket` in `client.js` is a dead export), so this hasn't been user-visible, but it should either be fixed or removed rather than left as dead-and-broken.
3. **`run_catalog.py` (`runs.json`) doesn't use the lock+atomic-write pattern** used everywhere else in the storage layer (`file_store.py`, `event_log.py`, `tag_catalog.py`'s equivalent). Low-risk today (runs are added rarely, via an admin-gated form) but inconsistent, and a real race is theoretically possible on concurrent "Add Run" submissions.
4. **Duplicated URL-building logic** between `images.py` and `library.py` — not incorrect, but a change to how media URLs are constructed needs to be made in both places.
5. **The Electron desktop shell (`frontend/main.js`) has no npm dependency, script, or build config wiring it up** — it's a manual/local workflow, not part of the CI-relevant build pipeline. If Electron distribution is actually needed going forward, it should be made a first-class build target (add the `electron` dependency, a build script, packaging config) rather than left implicit.
6. **`Settings.app_name` ("Inspection Image Similarity Engine") and the FastAPI `description` ("REST API for industrial inspection image similarity search") don't reflect the "ILI Reference Library"/"ILI-brary" branding** used in the frontend UI. Per this repo's own cleanup guidance (`CLAUDE.md` §6), user-facing copy and API metadata should match current branding — worth a grep-and-fix pass.
7. **Single shared admin passkey, no per-role or per-user distinction.** Anyone with the passkey can edit/delete any entry or add runs/tags; there's no way to audit *who* actually clicked delete beyond `contributor_name` on the *edit* trail (deletes have no equivalent).
8. **Legacy dermatology-era search parameters** (`diagnosis`, `tissue_type`, `benign_malignant`) are still accepted by `search.py`/`text_search.py`'s filter schema from before this system was repurposed from a dermatology demo to an industrial-inspection tool — they're accepted but don't correspond to any real current data field. Candidates for removal per `CLAUDE.md`'s "retire features completely" guidance, though confirm nothing external still sends them before deleting.
9. **`batch_search.py` is API-only** (no frontend caller) with an in-memory, non-restart-safe job store — a deliberate capability per earlier research, not abandoned code, but not production-hardened for multi-worker deployment either.
10. **Numeric field type inconsistency**: dimension fields (`depth`/`width`/`length`) are handled as strings on both create and update paths in the frontend payload, but there's a str-vs-float inconsistency between the create and update backend schemas worth double-checking if you're debugging a dimension-field save issue.
11. **`POST /search/text` is now non-functional** — the primary embedding model (DINOv2) has no text encoder, so it fails with a clean `503`. It had no frontend caller even before this (`searchByText` in `client.js` is a dead export), so nothing user-visible broke, but the endpoint should either be removed or rebuilt on a CLIP-family text encoder kept alongside DINOv2 specifically for this, if text search is ever wanted.
12. **Feedback/voting's re-addition** (see §4.2) has no frontend UI — confirm intent before extending it further.

---

## 13. Glossary

- **ILI** — In-Line Inspection (pipeline inspection technology).
- **Panel / Panel Tag** — one of the distinct visualization views a single inspection tool run can produce for the same anomaly (Beamforming, Raw, Plot, Image, Heatmap, Multi Section, Cross-Section, Dent Sizing, Tool Pose).
- **Orientation Image** — a reference image showing pipe orientation, structurally kept separate from searchable panel media.
- **Rerank** — the second-pass, heavier-model re-scoring of a coarse shortlist from the primary search.
- **Model Tag** — a string identifying exactly which backbone+head (or CLIP model+checkpoint, for the legacy rerank model) produced a given embedding (e.g. `vit_base_patch14_dinov2.lvd142m+dinov2_base_head_v1`), used to prevent comparing incompatible vector spaces.
- **DINOv2** — Meta's self-supervised vision backbone (no text/caption training), the current primary embedding model's frozen feature extractor.
- **Metric-Learning Head** — the small trainable projection (`app/ml/projection_head.py`) on top of the frozen DINOv2 backbone, trained with a triplet loss on the labeled anomaly library.
- **Revision History** — the append-only audit trail of edits to a single library entry, each entry signed with a contributor name/comment/timestamp.
- **Passkey** — the single shared secret gating destructive/admin actions (delete, edit, add run, add tag). Not a real authentication system.
