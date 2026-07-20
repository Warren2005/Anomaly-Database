# Medical Microscopy Similarity Search Engine — Comprehensive Learning Document

> **How to use this document**: Read it front-to-back if you are new to any of the technologies involved. If you already know a topic, use the section headers to jump to where it appears in this codebase. Every concept is explained from first principles before being shown in context.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Core Concepts](#3-core-concepts)
4. [System Design Deep Dive](#4-system-design-deep-dive)
5. [Data Layer](#5-data-layer)
6. [Machine Learning Components](#6-machine-learning-components)
7. [Key Implementation Walkthrough](#7-key-implementation-walkthrough)
8. [Configuration and Deployment](#8-configuration-and-deployment)
9. [Glossary](#9-glossary)

---

## 1. Project Overview

### What This Project Does

This is a **content-based medical image retrieval system** — a search engine where you search with pictures, not words.

A pathologist or clinician can drag and drop a microscopy or dermatology image into the application, and within seconds, the system returns the most visually similar images from a database of tens of thousands of labelled medical images. Each result comes with metadata: the diagnosis, whether the lesion is benign or malignant, the patient's age and sex, and the dataset it came from.

The system also supports:
- **Text-to-image search**: Type "melanoma with irregular borders" and retrieve matching images
- **Attention maps**: Highlight which regions of an image drove the similarity score
- **Feedback**: Pathologists can up/downvote results, gradually improving rankings over time
- **Batch search**: Upload a ZIP of images and process them asynchronously

### Why It Exists

Medical diagnosis increasingly involves pattern recognition across large image archives. Pathologists spend enormous time reviewing slides that look like ones they (or colleagues) have seen before. This system makes that institutional visual knowledge searchable — "show me other cases that look like this one."

### Who It Is For

- **Pathologists** doing case review
- **Medical researchers** studying visual patterns across diagnoses
- **Clinicians** who want a second reference when reviewing ambiguous cases

---

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER (Browser or Electron)                   │
│                        React 18 Frontend (Vite)                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │  HTTP / WebSocket
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Nginx Reverse Proxy (port 3000)                  │
│   Serves static files + proxies /api/* to backend:8000             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│              FastAPI Backend (Gunicorn + Uvicorn workers)           │
│                         port 8000                                   │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │  Embedding  │  │    Search    │  │     Explainability        │ │
│  │   Service   │  │   Service    │  │       Service             │ │
│  │  (CLIP ML)  │  │  (Qdrant)   │  │     (GradCAM)             │ │
│  └──────┬──────┘  └──────┬───────┘  └───────────────────────────┘ │
│         │                │                                          │
│  ┌──────▼──────┐  ┌──────▼───────┐  ┌───────────────────────────┐ │
│  │    Redis    │  │    Qdrant    │  │       PostgreSQL           │ │
│  │   (Cache)   │  │  (Vectors)   │  │      (Metadata)           │ │
│  └─────────────┘  └──────────────┘  └───────────────────────────┘ │
│                                                                     │
│                    ┌──────────────────┐                            │
│                    │      MinIO       │                            │
│                    │  (Image Files)   │                            │
│                    └──────────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

**Data flow summary**: Image → CLIP Model → 512-number vector → Qdrant search → PostgreSQL metadata lookup → response to browser.

---

### Directory Structure Walkthrough

```
medical-microscopy/
│
├── docker-compose.yml          # Orchestrates all 6 services as one system
├── prometheus.yml              # Monitoring config (optional)
├── RUNNING_INSTRUCTIONS.md     # Setup guide for local development
│
├── backend/                    # Python FastAPI application
│   ├── Dockerfile              # Container build instructions
│   ├── requirements.txt        # Python package dependencies
│   ├── gunicorn.conf.py        # Production server configuration
│   ├── .env                    # Local environment variables
│   │
│   ├── app/                    # Application source code
│   │   ├── main.py             # App entry point, service lifecycle
│   │   ├── core/               # Settings, errors, logging
│   │   ├── middleware/         # Error handling, metrics
│   │   ├── models/             # SQLAlchemy database models (ORM)
│   │   ├── schemas/            # Pydantic request/response shapes
│   │   ├── services/           # Business logic (DB, Qdrant, ML, etc.)
│   │   └── api/v1/endpoints/   # HTTP route handlers
│   │
│   ├── alembic/                # Database migration scripts
│   ├── scripts/                # Data ingestion tools
│   └── tests/                  # Automated tests
│
├── frontend/                   # React application
│   ├── main.js                 # Electron desktop app entry
│   ├── vite.config.js          # Frontend build tool config
│   ├── Dockerfile              # Container build (Nginx serving React)
│   ├── nginx.conf              # Web server + API proxy config
│   │
│   └── src/
│       ├── main.jsx            # React application bootstrap
│       ├── App.jsx             # Root component, state machine
│       ├── api/client.js       # API wrapper functions
│       ├── components/         # Reusable UI components
│       └── styles/App.css      # All application styles
│
└── images/                     # Custom image datasets (gitignored)
    ├── healthy/
    └── flawed/
```

**Why this layout?** The separation of `services/` from `api/endpoints/` is intentional. Services hold the business logic and can be tested independently (or swapped out). Endpoints are thin layers that validate input, call services, and shape the response. This is the classic **service layer pattern**.

---

## 2. Technology Stack

### Python (Backend Language)

**What it is**: A high-level, dynamically typed programming language known for its readable syntax and massive ecosystem, especially in data science and web development.

**Why used here**: Python has the best library ecosystem for machine learning (PyTorch, CLIP) and scientific computing. FastAPI is built on Python. The combination of Python async capabilities with PyTorch's inference makes it well-suited for this use case.

**Where it appears**: All files under `backend/`.

---

### FastAPI

**What it is**: A modern Python web framework for building HTTP APIs. It uses Python's type annotation system to automatically validate request data, generate documentation, and serialize responses.

**How it works**: You write a Python function and annotate its parameters with types. FastAPI reads those annotations and automatically:
- Validates incoming request data
- Returns descriptive error messages if validation fails
- Generates interactive API documentation at `/docs`
- Serializes Python objects to JSON

**Example from this codebase** (`backend/app/api/v1/endpoints/search.py`):
```python
@router.post("/similar", response_model=SearchResponse)
async def search_similar(
    request: Request,
    file: UploadFile = File(...),       # Required file upload
    limit: int = Query(default=10),     # Optional query param, defaults to 10
    diagnosis: Optional[str] = Query(default=None),
):
```
FastAPI reads this and knows: this endpoint expects a POST with a file upload and optional `limit` and `diagnosis` query parameters. It validates them automatically.

**Why used here instead of Flask or Django**: FastAPI is built for async I/O from the ground up (critical when waiting on database queries, ML inference, and object storage simultaneously). It's also significantly faster than Flask and lighter than Django.

---

### Pydantic

**What it is**: A Python data validation library. You define a class with typed fields, and Pydantic enforces that any data you create matches those types at runtime.

**Why it matters**: In a world where data comes from untrusted HTTP requests, Pydantic ensures your business logic only ever sees clean, correctly typed data.

**Where it appears**: All files in `backend/app/schemas/`. For example, `SearchResult` in `backend/app/schemas/search.py`:

```python
class SearchResult(BaseModel):
    image: ImageResponse
    similarity_score: float
    image_url: str
```

Any code that creates a `SearchResult` must provide an `ImageResponse` object, a float, and a string — or Pydantic raises a descriptive error.

FastAPI is built on Pydantic — when you annotate a route's `response_model=SearchResponse`, FastAPI uses Pydantic to serialize the return value to JSON.

---

### SQLAlchemy (Async)

**What it is**: An ORM (Object-Relational Mapper). An ORM lets you work with databases using Python objects instead of writing raw SQL strings.

**What ORM means**: Instead of writing `SELECT * FROM images WHERE id = '...'`, you write `session.get(Image, image_id)`. The ORM translates your Python code to SQL and maps the results back to Python objects.

**Async vs. sync**: Traditional SQLAlchemy is synchronous — it blocks the thread while waiting for the database. This project uses `SQLAlchemy 2.x` with the async extension, so database queries yield control back to the event loop while waiting, allowing other requests to be served concurrently.

**Where it appears**: `backend/app/services/database.py` (connection management), `backend/app/models/` (table definitions).

**Why used here**: The combination of async SQLAlchemy + asyncpg gives near-native database performance while remaining non-blocking.

---

### asyncpg

**What it is**: A fast, pure-Python PostgreSQL driver built for async. It's one of the fastest PostgreSQL clients available in any language.

**Why it's needed**: The default PostgreSQL driver (`psycopg2`) is synchronous — it blocks the calling thread. `asyncpg` speaks the same protocol but is designed for async/await, making it compatible with FastAPI's event loop.

**Where it appears**: Referenced in `backend/alembic/env.py` (URL scheme `postgresql+asyncpg://`) and used implicitly when SQLAlchemy creates the engine.

---

### Alembic

**What it is**: A database migration tool for SQLAlchemy. Migrations are version-controlled scripts that describe how to evolve a database schema over time.

**The problem it solves**: When you change your data model (add a column, rename a table), you need to update the actual database to match. Doing this by hand is error-prone and hard to reproduce across environments. Alembic tracks which migrations have been run and applies only the missing ones.

**How it works**:
1. You write a migration script (a Python file with `upgrade()` and `downgrade()` functions)
2. Alembic stores which migrations have been applied in a `alembic_version` table
3. Running `alembic upgrade head` applies all pending migrations in order

**Where it appears**: `backend/alembic/env.py` (configuration), `backend/alembic/versions/` (the actual migration files).

**Two migrations in this project**:
- `001_create_images_table.py`: Creates the `images` table with UUID primary keys, diagnosis fields, indexes
- `002_create_feedback_table.py`: Creates the `feedback` table for user votes

---

### Qdrant

**What it is**: A vector similarity search engine. It stores collections of high-dimensional numerical vectors and can quickly find the most similar ones to a query vector.

**What "vector similarity" means**: Instead of searching by exact match (like a traditional database), Qdrant searches by geometric proximity. Two vectors are similar if the angle between them is small (cosine similarity) or the distance between them is small (Euclidean distance).

**Why a dedicated vector database**: Traditional databases like PostgreSQL can store arrays of numbers, but they cannot efficiently search millions of them by similarity. Qdrant uses a data structure called HNSW (Hierarchical Navigable Small World graph) that enables approximate nearest-neighbor search in milliseconds even with millions of vectors.

**Where it appears**: `backend/app/services/qdrant.py` (all interaction), called from `backend/app/api/v1/endpoints/search.py`.

**How Qdrant is used here**:
- At ingestion time: each image's CLIP embedding (512 numbers) is stored with metadata as the "payload"
- At search time: query image's embedding is compared against all stored embeddings; top-N most similar are returned

---

### PostgreSQL

**What it is**: A powerful, open-source relational database. Data is organized into tables with rows and columns, and relationships between tables are enforced with foreign keys.

**Why use PostgreSQL alongside Qdrant**: Qdrant stores vectors efficiently but is not designed for rich relational queries. PostgreSQL stores the image metadata (diagnosis text, patient age, sex, dataset source, timestamps) and can be queried with the full power of SQL. The system uses Qdrant's vector search results as IDs, then fetches rich metadata from PostgreSQL.

**Where it appears**: `backend/app/services/database.py`, `backend/app/models/`, all endpoint files that query image metadata.

---

### MinIO

**What it is**: An S3-compatible object storage server. Object storage is designed for storing large binary files (images, videos, documents) as "objects" identified by a key (like a file path), not as rows in a table.

**Why not store images in PostgreSQL**: Databases are optimized for small, structured data. Storing thousands of JPEG files (each potentially megabytes) in a database causes performance problems. Object storage is purpose-built for this — fast streaming of large binary blobs.

**S3-compatible**: MinIO implements the same API as Amazon S3, so the same client libraries work with both. This means you could swap MinIO for real S3 in production with a configuration change.

**Where it appears**: `backend/app/services/storage.py`, referenced in every endpoint that returns image URLs, and in the ingestion scripts.

**How images flow**: Ingestion script reads image file → uploads to MinIO as `custom/DV_Data/example.png` → stores the path string in PostgreSQL → at search time, backend reads path from PostgreSQL, fetches bytes from MinIO, returns them as HTTP response.

---

### Redis

**What it is**: An in-memory key-value store. Data is kept in RAM (not on disk), making reads and writes extremely fast (sub-millisecond). It supports automatic expiry of keys via TTL (time-to-live).

**How it's used here**: CLIP embedding generation is the most computationally expensive part of a search — it takes the most time. If someone searches with the same image twice, there's no need to run inference again. The system hashes the image bytes with SHA256, uses that hash as a Redis key, and stores the embedding vector as the value with a 24-hour TTL.

**Where it appears**: `backend/app/services/cache.py`, called from `backend/app/services/embedding.py`.

**Cache hit/miss flow**:
```
Image bytes → SHA256 hash
              └─→ Redis GET hash
                  ├─ Hit: return cached embedding (microseconds)
                  └─ Miss: run CLIP inference (hundreds of milliseconds)
                           └─→ Redis SET hash=embedding EX=86400
```

---

### open-clip-torch (CLIP)

**What it is**: An open-source implementation of OpenAI's CLIP (Contrastive Language-Image Pre-training) model. CLIP is a neural network trained to understand both images and text in a shared semantic space.

**Why it's the core of this system**: CLIP converts any image into a 512-dimensional vector in a way that captures semantic meaning. Images of melanoma lesions cluster together in this space. Images of healthy skin cluster elsewhere. The similarity search is just measuring distances between these vectors.

**Why open-clip-torch instead of OpenAI's original**: OpenAI's original CLIP library has become less actively maintained. `open_clip_torch` is a community fork with the same models, active maintenance, and additional model variants. The model weights are identical.

**Where it appears**: `backend/app/services/embedding.py`.

---

### React 18

**What it is**: A JavaScript library for building user interfaces. You describe what the UI should look like for a given state, and React efficiently updates the DOM to match when state changes.

**Core idea — declarative UI**: Instead of manually manipulating HTML elements ("find the button, set its text, hide the spinner"), you write components that say "when `loading` is true, show spinner; otherwise show button." React handles the DOM updates.

**Where it appears**: All files under `frontend/src/`.

**Key React concepts used in this project**:
- `useState`: Track UI state (search results, loading, errors)
- `useEffect`: Fetch initial data (filters, health check) when component mounts
- Components as functions: `DropZone`, `ResultsGrid`, `ImageDetail`, etc.
- Props: Data passed from parent to child components

---

### Vite

**What it is**: A frontend build tool that bundles your JavaScript, JSX, CSS, and assets into optimized files that browsers can load.

**Why it's fast**: During development, Vite serves files individually via native ES modules (no bundling). It only bundles code that actually changed, rather than re-bundling everything. For production builds, it uses Rollup under the hood for optimized output.

**Where it appears**: `frontend/vite.config.js`, `frontend/package.json` (build/dev scripts).

**Critical setting in this project**: `base: "./"` in `vite.config.js`. This makes all asset paths relative rather than absolute, which is required for Electron (which loads files from the filesystem via `file://` protocol, not from a server). Without this, the Electron app would show a blank white screen.

---

### Electron

**What it is**: A framework that lets you build desktop applications using web technologies (HTML, CSS, JavaScript). It bundles a Chromium browser and a Node.js runtime into a native desktop app.

**How it works**: Electron has two processes:
- **Main process** (`main.js`): Node.js environment, creates the application window, handles OS integration
- **Renderer process**: Chromium browser, runs your React app

**Where it appears**: `frontend/main.js` (main process), `frontend/package.json` (electron dependency, start script).

**Electron vs. browser**: When running as a desktop app, the page URL is `file:///path/to/dist/index.html` — there's no server. This means relative API calls (`/api/v1/search`) don't work because there's no server to route them. The app detects this with `window.location.protocol === "file:"` and switches to `http://localhost:8000` for API calls.

---

### Nginx

**What it is**: A high-performance web server and reverse proxy. In this project, it serves two purposes:
1. Serve the React app's static files (HTML, JS, CSS)
2. Forward `/api/*` requests to the FastAPI backend

**Reverse proxy**: When Nginx receives a request for `/api/v1/search/similar`, it forwards it to `http://backend:8000/api/v1/search/similar` and returns the response to the client. The browser never connects to the backend directly.

**Why this matters**: It means the browser makes all requests to the same origin (port 3000). Without this, the browser would block cross-origin API calls (CORS policy).

**Where it appears**: `frontend/nginx.conf`, `frontend/Dockerfile` (runtime stage uses nginx:alpine).

---

### Docker & Docker Compose

**What Docker is**: A platform for packaging applications and their dependencies into isolated containers. A container is like a lightweight virtual machine — it has its own filesystem, network, and process space, but shares the host OS kernel.

**What "containerising" means**: Instead of installing PostgreSQL, Redis, MinIO, Qdrant, and Python directly on your machine, you define them in configuration files and Docker runs them in isolated containers. This ensures the application runs identically on any machine.

**What Docker Compose is**: A tool for defining and running multi-container applications. `docker-compose.yml` describes all 6 services, their configuration, how they communicate, and how they depend on each other.

**Where it appears**: `docker-compose.yml` (root), `backend/Dockerfile`, `frontend/Dockerfile`.

---

### Gunicorn

**What it is**: A production-grade WSGI/ASGI server for Python. It manages a pool of worker processes, each capable of handling requests.

**Why not just use Uvicorn alone**: Uvicorn is a single-process async server. For production, you want multiple worker processes to use multiple CPU cores. Gunicorn acts as a process manager — it spawns multiple Uvicorn workers and monitors their health, restarting them if they crash.

**Worker class**: `uvicorn.workers.UvicornWorker` — each Gunicorn worker is a full Uvicorn server (async), not a blocking worker.

**Critical setting**: `preload_app = True` in `gunicorn.conf.py`. This loads the Python application (including the CLIP model) in the parent process before forking workers. Workers inherit the model via copy-on-write, rather than each loading it independently. This cuts memory usage from `workers × 350MB` to `~350MB + small overhead`.

**Where it appears**: `backend/gunicorn.conf.py`, `backend/Dockerfile` (CMD).

---

### Prometheus & SlowAPI

**Prometheus**: A monitoring system that scrapes metrics from applications at regular intervals. Metrics are counters, gauges, and histograms exposed at an HTTP endpoint.

**Where it appears**: `backend/app/middleware/metrics.py` exposes metrics like `search_latency_seconds` and `cache_hit_total`. The `/metrics` endpoint returns them in Prometheus format. `prometheus.yml` configures the Prometheus server (not active in the trimmed Docker Compose).

**SlowAPI**: A rate limiting library for FastAPI. It counts requests per IP address per time window and rejects excessive requests with HTTP 429.

**Where it appears**: `backend/app/api/v1/endpoints/search.py` — `@limiter.limit("30/minute")` on the search endpoint.

---

## 3. Core Concepts

### 3.1 CLIP — Contrastive Language-Image Pre-training

#### Concept Explanation

CLIP is a neural network trained on 400 million (image, caption) pairs scraped from the internet. The training objective was simple but powerful: make the network produce similar vectors for matching image-caption pairs, and dissimilar vectors for non-matching pairs.

Imagine training with millions of examples like:
- (photo of a cat, "a cat sitting on a fence") → embeddings should be similar
- (photo of a cat, "a car driving on a highway") → embeddings should be dissimilar

After training, CLIP learned to encode *semantic meaning* into vectors. Two images of melanoma lesions will have similar vectors — not because their pixels are numerically close, but because CLIP learned that they represent the same medical concept.

#### The Architecture

CLIP has two encoders:
1. **Vision encoder**: A Vision Transformer (ViT-B/32 in this project) that converts images to vectors
2. **Text encoder**: A Transformer that converts text to vectors

Both encoders project their output into the same 512-dimensional space. This is what makes text-to-image search possible: "melanoma with irregular borders" gets encoded into a vector in the same space as actual melanoma images.

```
Image ─────→ Vision Encoder ─────→ [0.1, -0.3, 0.7, ...]  ← 512 numbers
                                              ↑
                                     same vector space
                                              ↓
Text  ─────→ Text Encoder   ─────→ [0.1, -0.3, 0.7, ...]  ← 512 numbers
```

#### Mathematical Foundation

The similarity between two vectors **a** and **b** is measured with **cosine similarity**:

```
                   a · b
sim(a, b) = ──────────────────
             ‖a‖ × ‖b‖
```

Where `a · b` is the dot product and `‖a‖` is the magnitude (L2 norm). This gives a value between -1 and 1. When the system normalizes embeddings to unit length (‖a‖ = 1), cosine similarity reduces to just the dot product, which is what Qdrant computes during search.

**L2 normalization** (applied in this codebase):
```python
embedding = embedding / np.linalg.norm(embedding)
```
This makes every embedding vector have magnitude 1, so geometric distance and cosine similarity are equivalent.

#### Where It Appears in This Codebase

`backend/app/services/embedding.py`:

```python
async def load_model(self):
    # Downloads ViT-B/32 model weights at build time (baked into Docker image)
    self.model, _, self.preprocess = open_clip.create_model_and_transforms("ViT-B-32")
    self.tokenizer = open_clip.get_tokenizer("ViT-B-32")

def _compute_embedding(self, image_bytes: bytes) -> list[float]:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image_tensor = self.preprocess(image).unsqueeze(0)   # Add batch dimension
    with torch.no_grad():                                 # No gradient tracking needed
        features = self.model.encode_image(image_tensor)
        features = features / features.norm(dim=-1, keepdim=True)  # L2 normalize
    return features[0].tolist()
```

#### Why ViT-B/32

ViT-B/32 means: Vision Transformer, Base size, patch size 32×32 pixels.

- "Base" model is a good balance between accuracy and speed (smaller than ViT-L/14 which is more accurate but ~4× slower)
- 32×32 patches means the image is divided into non-overlapping 32-pixel squares, each processed as a "token" by the Transformer
- Produces 512-dimensional vectors (smaller than larger models' 768 or 1024 dimensions)

For medical images on CPU (no GPU in the Docker container), ViT-B/32 is practical — typically 200-500ms per inference.

---

### 3.2 Vector Similarity Search and HNSW

#### The Problem

You have 25,000 image embeddings, each a 512-dimensional vector. A user uploads a new image, producing another 512-dimensional vector. You need to find the 10 most similar stored vectors. How?

**Brute force**: Compare the query vector against all 25,000 stored vectors. This is O(n) and works fine at 25,000 images but becomes impractical at millions.

**HNSW (Hierarchical Navigable Small World)**: A graph-based data structure that makes approximate nearest-neighbor search sub-linear. It builds a layered graph where:
- Top layers have long-range connections (coarse navigation)
- Bottom layers have short-range connections (fine-grained search)

Search starts at the top layer, greedily moving toward the query vector, then descends to finer layers for precision.

```
Layer 2 (sparse):    A ─────────────────────────── M
Layer 1 (medium):    A ─── C ─── F ─── J ─── M
Layer 0 (dense):     A─B─C─D─E─F─G─H─I─J─K─L─M
                                 ↑
                           Query lands here
```

The graph structure means search can skip large portions of the dataset, achieving O(log n) complexity in practice.

#### Where It Appears

`backend/app/services/qdrant.py`:

```python
await self.client.create_collection(
    collection_name=settings.qdrant_collection_name,
    vectors_config=VectorParams(
        size=512,           # CLIP ViT-B/32 output dimension
        distance=Distance.COSINE,
    ),
)
```

Qdrant builds the HNSW index automatically when you create a collection. The `distance=Distance.COSINE` setting tells Qdrant to measure similarity by cosine distance.

---

### 3.3 Attention Maps / Explainability (GradCAM)

#### What the Problem Is

Neural networks are often called "black boxes." A CLIP model can tell you that image A is 87% similar to image B, but not *why*. Which pixels in the query image drove that similarity? This is the explainability problem.

#### What GradCAM Is

GradCAM (Gradient-weighted Class Activation Mapping) is a technique that uses the gradients of a neural network to produce a heatmap highlighting which spatial regions were most important for a given output.

**The idea**: Run the image through the network. Then "backpropagate" from the output back through the network. The gradients at each pixel location tell you: "if I change this pixel, how much would the output change?" Large gradients = important pixels.

#### How It's Implemented Here

`backend/app/services/explainability.py` uses input-gradient saliency (a simpler variant of GradCAM):

```
1. Load the query image
2. Run it through the CLIP vision encoder
3. Get the embedding vector (512 numbers)
4. "Backpropagate" from the sum of the embedding back to the input image
5. The absolute value of gradients at each pixel = saliency score
6. Normalize and upsample to original image size
7. Apply a red-yellow colormap
8. Blend with the original image (alpha composite)
9. Return as PNG
```

The result is the original medical image with a translucent "heat overlay" showing which regions the model focused on — useful for understanding why two images were considered similar.

---

### 3.4 Asynchronous Programming (async/await)

#### The Problem

A web server handles many requests concurrently. If each request blocks the thread while waiting for a database query (which might take 50ms), and you have 100 concurrent users, you need 100 threads — expensive and limits scalability.

**Async I/O** solves this: instead of blocking a thread while waiting for the database response, the coroutine is suspended and the thread handles other work. When the database responds, the coroutine resumes.

#### Python async/await

```python
# Synchronous (blocks the thread):
def get_image(image_id):
    result = database.query(...)   # Thread sits idle for 50ms
    return result

# Asynchronous (yields control while waiting):
async def get_image(image_id):
    result = await database.query(...)  # Thread handles other requests while waiting
    return result
```

The `async` keyword marks a function as a coroutine. The `await` keyword suspends execution until the awaited operation completes, freeing the thread for other work.

#### The Event Loop

Python's `asyncio` module manages an **event loop** — a single thread that switches between many coroutines. When one coroutine is waiting for I/O, the loop runs another. This is called **cooperative multitasking**.

```
Event Loop:
┌─────────────────────────────────────────────────────┐
│  Request A: awaiting DB query...                    │
│  → run Request B while A waits                      │
│  Request B: awaiting MinIO fetch...                 │
│  → run Request C while B waits                      │
│  DB query for A complete → resume Request A         │
└─────────────────────────────────────────────────────┘
```

#### CLIP Inference is Synchronous — a Problem

PyTorch's CLIP inference is CPU-bound and synchronous — it doesn't yield to the event loop. If you call it directly in an async function, it blocks the entire event loop and freezes all other requests for hundreds of milliseconds.

**Solution**: Run it in a thread pool executor:

```python
# backend/app/services/embedding.py
embedding = await asyncio.to_thread(self._compute_embedding, image_bytes)
```

`asyncio.to_thread` runs the synchronous function in a separate thread (from Python's thread pool), and the event loop can service other requests while it runs. The result is awaited asynchronously.

---

### 3.5 Content-Based Image Retrieval (CBIR)

**What it is**: A technique for searching image databases using visual content of the images, rather than text metadata. You provide an example image, and the system finds similar images.

**Traditional approach**: Extract hand-crafted features (color histograms, edge detectors, texture descriptors) and compare them. These are brittle and domain-specific.

**Deep learning approach (used here)**: Use a neural network trained on massive datasets to extract semantic features. The network learns what "looks similar" in a high-dimensional sense. This generalizes far better across domains.

**Pipeline for this project**:
```
Query Image
    ↓
CLIP Vision Encoder (ViT-B/32)
    ↓
512-dim normalized embedding vector
    ↓
Qdrant cosine similarity search
    ↓
Top-N similar image IDs + similarity scores
    ↓
PostgreSQL metadata lookup
    ↓
Feedback score adjustment
    ↓
Ranked results with image URLs and metadata
```

---

### 3.6 Feedback Loop / Learning-to-Rank

**The problem**: CLIP similarity is purely visual. Two images might be visually similar but clinically unrelated (similar coloring, similar texture, different pathology). Pathologists reviewing results can signal which results were useful and which were not.

**How it's implemented**: The `feedback` table stores `vote` values (+1, -1) per query-result pair. At search time:

```python
# backend/app/api/v1/endpoints/search.py
FEEDBACK_WEIGHT = 0.02
net_vote = feedback_scores.get(image.id, 0)
adjusted_score = point.score + (net_vote * FEEDBACK_WEIGHT)
adjusted_score = max(0.0, min(1.0, adjusted_score))
```

If 5 users upvoted a result (+5 net vote), it gets a +0.10 boost to its similarity score. If 3 users downvoted (-3 net vote), it gets a -0.06 penalty.

**Limitation**: This is a simple linear adjustment. Real production systems would use more sophisticated techniques (Learning to Rank with gradient boosted trees, or re-training the embedding model on feedback data). The 0.02 weight was chosen to be meaningful but not overpowering.

---

### 3.7 Object Storage vs. Relational Storage

**Relational database (PostgreSQL)**:
- Stores structured data in tables with rows and columns
- Supports complex queries (joins, aggregations, filtering)
- Optimized for small records (bytes to kilobytes)
- ACID-compliant (atomic, consistent, isolated, durable)

**Object storage (MinIO/S3)**:
- Stores arbitrary binary blobs identified by a key
- No query language — just GET/PUT/DELETE by key
- Optimized for large objects (megabytes to gigabytes)
- Scales horizontally to petabytes

**Why this project uses both**:
- Metadata (diagnosis, age, sex) → PostgreSQL (fast text queries, joins with feedback table)
- Image files (JPEG bytes, potentially 1-5MB each) → MinIO (efficient binary streaming)

The image path (`custom/DV_Data/example.png`) stored in PostgreSQL is the "foreign key" that points to the object in MinIO.

---

### 3.8 Database Migrations

**The problem**: Your application needs a specific database schema (specific tables, columns, indexes). But when you first install the app, the database is empty. And as the app evolves, the schema needs to change. How do you keep the database in sync with your code?

**Solution — migrations**: Versioned scripts, each describing a schema change. Applied in order, they bring any database from empty to the current schema.

**Alembic migration example** (`backend/alembic/versions/001_create_images_table.py`):
```python
def upgrade():
    op.create_table(
        "images",
        sa.Column("id", postgresql.UUID, server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("diagnosis", sa.String(100)),
        # ... more columns
    )

def downgrade():
    op.drop_table("images")
```

`upgrade()` applies the change. `downgrade()` reverses it. Alembic tracks which have been applied in the `alembic_version` table.

**In this project**: When the Docker container starts, Alembic runs migrations before the app starts, ensuring the database schema is always current.

---

## 4. System Design Deep Dive

### 4.1 Architectural Patterns

#### Service Layer Pattern

The backend separates concerns into distinct layers:

```
HTTP Request
    ↓
API Endpoint (thin: validate, call services, shape response)
    ↓
Service (business logic: embedding, search, storage)
    ↓
External System (PostgreSQL, Qdrant, MinIO, Redis)
```

**Why**: Each layer has one job. Services can be tested without HTTP. Endpoints can be refactored without touching business logic. External systems can be swapped without touching endpoints.

**Example**: `search.py` endpoint validates the file, then calls `embedding_service.get_embedding()`, `qdrant_service.search()`, and `db_service.get_session()`. It knows nothing about how CLIP works or how Qdrant stores data.

#### Singleton Services

Each service (`db_service`, `qdrant_service`, `storage_service`, `embedding_service`, `cache_service`) is instantiated once at module import time and reused across all requests.

**Why**: The CLIP model is ~350MB. If you re-loaded it per request, you'd use gigabytes of memory and seconds of startup time per request. Services also maintain connection pools (PostgreSQL, Redis) that would be wasteful to recreate per request.

**Where**: `backend/app/services/*.py` — each file ends with:
```python
db_service = DatabaseService(settings.database_url)
embedding_service = EmbeddingService()
# etc.
```

#### Event-Driven Lifecycle (Lifespan)

Services need to connect on startup and disconnect gracefully on shutdown. FastAPI's `lifespan` context manager handles this:

```python
# backend/app/main.py
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect all services
    await db_service.connect()
    await embedding_service.load_model()
    yield  # App runs here
    # Shutdown: disconnect all services
    await db_service.disconnect()
```

This ensures database connections are properly closed (no leaked connections), the CLIP model is cleaned up, and Redis connections are released.

---

### 4.2 Data Flow — End-to-End Image Search

Let's trace a complete request from browser click to displayed results:

**1. Browser (Frontend)**
```
User drops image on DropZone
→ handleSearch(file) in App.jsx
→ searchSimilar(file, filters) in client.js
→ POST /api/v1/search/similar (multipart form, 50MB max)
```

**2. Nginx (Proxy)**
```
Receives POST /api/v1/search/similar
→ Proxies to http://backend:8000/api/v1/search/similar
```

**3. FastAPI (Endpoint)**
```
search_similar() in search.py
→ Validate content type (JPEG/PNG/TIFF only)
→ Read file bytes (max 50MB)
```

**4. Embedding Service**
```
embedding_service.get_embedding(image_bytes)
→ SHA256 hash of bytes
→ Redis GET {hash}
  Hit: return cached 512-dim vector
  Miss:
    → asyncio.to_thread(_compute_embedding, bytes)
       → Open image, preprocess (resize, normalize)
       → CLIP vision encoder forward pass
       → L2 normalize
       → Return [0.1, -0.3, ...] (512 floats)
    → Redis SET {hash} = embedding (24h TTL)
```

**5. Qdrant Search**
```
qdrant_service.search(vector, limit=10, query_filter)
→ Build Filter object (if diagnosis/tissue_type/benign_malignant given)
→ Qdrant HNSW search: find top-10 vectors by cosine similarity
→ Returns: [(id="uuid1", score=0.923), (id="uuid2", score=0.891), ...]
```

**6. Metadata Fetch**
```
PostgreSQL: SELECT * FROM images WHERE id IN (uuid1, uuid2, ...)
→ Returns Image ORM objects with diagnosis, age, sex, etc.

PostgreSQL: SELECT result_image_id, SUM(vote) FROM feedback WHERE result_image_id IN (...)
→ Returns feedback vote totals per image
```

**7. Response Assembly**
```
For each Qdrant result:
  net_vote = feedback_scores.get(image.id, 0)
  adjusted_score = qdrant_score + (net_vote * 0.02)
  adjusted_score = clamp(0.0, 1.0, adjusted_score)
  image_url = f"/api/v1/images/{image.id}/file"

Sort by adjusted_score descending
Return SearchResponse with timing info
```

**8. Frontend Display**
```
Receives SearchResponse with results[]
→ setResults(data.results), setHealth(...)
→ ResultsGrid renders each result card
→ img src={resolveImageUrl(result.image_url)}
  In browser: src="/api/v1/images/{id}/file" → Nginx proxies to backend
  In Electron: src="http://localhost:8000/api/v1/images/{id}/file" → direct
→ Backend /images/{id}/file endpoint:
  PostgreSQL: get image.image_path
  MinIO: get_object(image_path) → bytes
  Return Response(content=bytes, media_type="image/jpeg")
```

---

### 4.3 API Design

All endpoints follow REST conventions and return consistent JSON shapes.

**Base URL**: `/api/v1/`

**Versioning**: The `/v1/` prefix allows breaking API changes in the future (introduce `/v2/`) without breaking existing clients.

**Consistent error format** (`backend/app/middleware/error_handler.py`):
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Unsupported file type. Use JPEG, PNG, or TIFF.",
    "details": { "content_type": "image/gif" }
  }
}
```

**Endpoint summary**:

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/health` | Service status | None |
| POST | `/search/similar` | Image similarity search | Rate limited |
| POST | `/search/text` | Text-to-image search | None |
| POST | `/search/batch` | Batch ZIP search | None |
| GET | `/search/jobs/{id}` | Batch job status | None |
| GET | `/images/filters` | Available filter values | None |
| GET | `/images/{id}` | Image metadata | None |
| GET | `/images/{id}/file` | Raw image bytes | None |
| POST | `/feedback` | Submit relevance vote | None |
| GET | `/feedback/stats` | Aggregate vote stats | None |
| POST | `/explain` | Generate attention heatmap | None |
| WS | `/ws/search` | Streaming search results | None |

---

### 4.4 Concurrency Strategy

**FastAPI + Uvicorn**: Single-threaded async event loop per worker process. Handles thousands of concurrent I/O-bound requests efficiently.

**Gunicorn workers**: Multiple Uvicorn worker processes (capped at 2 in this configuration to limit CLIP model memory usage). Each has its own event loop and its own copy of the CLIP model (via `preload_app` + fork).

**CPU-bound tasks (CLIP inference)**: Run in a thread pool via `asyncio.to_thread()`. This prevents one slow inference from blocking the event loop for all other requests.

**Batch search concurrency**: Processes up to 4 images simultaneously using `asyncio.gather()`:
```python
# backend/app/api/v1/endpoints/batch_search.py
sem = asyncio.Semaphore(4)
tasks = [process_single(sem, img_bytes) for img_bytes in images]
results = await asyncio.gather(*tasks)
```
The semaphore limits concurrent CLIP inferences to 4, preventing memory exhaustion.

---

### 4.5 Scalability Considerations

**What would need to change for 10× scale**:

1. **More Gunicorn workers**: Increase `GUNICORN_WORKERS` env var. Each worker handles requests concurrently, but each also loads CLIP model (~350MB). With 8 workers, that's ~2.8GB just for the model.

2. **GPU inference**: CLIP on GPU is ~50× faster. Would require changing `clip_device` from `"cpu"` to `"cuda"` and using a GPU-enabled Docker image.

3. **Qdrant clustering**: Qdrant supports distributed operation across multiple nodes for larger vector collections.

4. **PostgreSQL read replicas**: For read-heavy workloads, replicas serve SELECT queries, reducing load on the primary.

5. **MinIO distributed mode**: MinIO supports erasure coding and distributed operation for high availability.

The current design is a good foundation — all external services are already containerized and could be scaled independently.

---

## 5. Data Layer

### 5.1 Data Models

#### Image Table (`backend/app/models/image.py`)

The core entity in the system. Every image that's been ingested into the search engine has a record here.

```
┌────────────────────────────────────────────────────────┐
│                        images                          │
├──────────────────┬──────────────┬──────────────────────┤
│ Column           │ Type         │ Notes                │
├──────────────────┼──────────────┼──────────────────────┤
│ id               │ UUID         │ Primary key, auto    │
│ dataset_source   │ VARCHAR(50)  │ "custom_DV_Data"     │
│ image_path       │ VARCHAR(500) │ MinIO object key     │
│ diagnosis        │ VARCHAR(100) │ "melanoma", "nevus"  │
│ tissue_type      │ VARCHAR(50)  │ Anatomical site      │
│ benign_malignant │ VARCHAR(20)  │ "benign"/"malignant" │
│ age              │ INTEGER      │ Patient age (years)  │
│ sex              │ VARCHAR(10)  │ "male"/"female"      │
│ created_at       │ TIMESTAMP    │ Auto-set on insert   │
│ updated_at       │ TIMESTAMP    │ Auto-set on update   │
└──────────────────┴──────────────┴──────────────────────┘

Indexes:
  idx_diagnosis: for filter queries by diagnosis
  idx_tissue_type: for filter queries by tissue type
```

**UUID primary keys**: Unlike sequential integers, UUIDs are globally unique, can be generated client-side, and don't reveal insertion order or record count. PostgreSQL generates them server-side using `gen_random_uuid()`.

#### Feedback Table (`backend/app/models/feedback.py`)

Stores pathologist feedback on search results.

```
┌─────────────────────────────────────────────────────────┐
│                        feedback                         │
├──────────────────┬──────────────┬───────────────────────┤
│ Column           │ Type         │ Notes                 │
├──────────────────┼──────────────┼───────────────────────┤
│ id               │ UUID         │ Primary key, auto     │
│ query_image_id   │ UUID         │ Nullable (text search)│
│ result_image_id  │ UUID         │ Which result was rated│
│ vote             │ INTEGER      │ +1 (up) or -1 (down)  │
│ created_at       │ TIMESTAMP    │ Auto-set on insert    │
└──────────────────┴──────────────┴───────────────────────┘

Indexes:
  idx_feedback_query_image: aggregate votes per query image
  idx_feedback_result_image: aggregate votes per result image
```

**Why `query_image_id` is nullable**: For text searches, there's no query image — just a text string. The feedback still records which result was rated, but the query side is empty.

**No foreign keys**: The `result_image_id` doesn't have a formal foreign key constraint to `images.id`. This is a pragmatic choice — adding/removing images won't fail due to orphaned feedback records.

---

### 5.2 Qdrant Data Model

Qdrant stores "points" — each point has:
- **ID**: Same UUID as the PostgreSQL image record (keeps systems in sync)
- **Vector**: 512-float CLIP embedding
- **Payload**: Metadata copied from PostgreSQL for Qdrant-side filtering

```python
# backend/app/services/qdrant.py
await self.client.upsert(
    collection_name=settings.qdrant_collection_name,
    points=[
        PointStruct(
            id=str(image_id),
            vector=embedding,         # [0.1, -0.3, ...] (512 floats)
            payload={
                "diagnosis": "DV_Data",
                "tissue_type": None,
                "benign_malignant": None,
                "dataset": "custom_DV_Data",
            }
        )
    ]
)
```

**Payload indexes**: Qdrant creates indexes on payload fields so filters are applied efficiently during vector search. Without indexes, filtering would require checking every matching vector's payload.

---

### 5.3 Redis Data Model

Keys follow the pattern: `emb:{sha256_hash}`

```
emb:a3f2b1c4d5e6... → "[0.1, -0.3, 0.7, ...]"  (JSON-encoded float array)
TTL: 86400 seconds (24 hours)
```

**Why JSON strings instead of Redis native types**: Redis native list operations on 512-element lists are slower than storing the embedding as a single JSON string and parsing it with Python's `json.loads()`. The tradeoff is slightly larger memory usage but faster serialization.

---

### 5.4 MinIO Object Structure

Objects are stored with paths that preserve their origin:

```
medical-images/           ← bucket name
└── custom/
    └── DV_Data/
        ├── GirthweldBF.png
        ├── inclusion.jpg
        └── ...
```

The `image_path` stored in PostgreSQL is the full object key: `custom/DV_Data/GirthweldBF.png`. The backend reconstructs the full URL from this path.

---

### 5.5 Data Pipeline — Custom Dataset Ingestion

**Ingestion script**: `backend/scripts/ingest_custom.py`

**Usage**: `python -m scripts.ingest_custom --image-dir ./data/DV_Data`. It globs every `.jpg`/`.jpeg`/`.png` file in the target directory and, for each one, uploads it to MinIO, computes a CLIP embedding, inserts a row into PostgreSQL, and upserts the vector into Qdrant. The `--label` flag sets the `diagnosis`/`dataset_source` tag (defaults to the folder name); `--limit` caps how many images are processed, useful for a quick test run.

**Resumable processing**: A SQLite checkpoint file (`.ingest_checkpoint.db`, written inside the image directory) records which images have been processed by filename. If the script is interrupted, restarting picks up where it left off.

**Important**: The checkpoint file is tied to whichever Postgres/Qdrant instance it ran against. If you point the same image directory at a *different* instance (e.g. after resetting Docker containers), delete the checkpoint file first — otherwise it will report those images as already done and skip re-ingesting them into the new instance, even though it's empty.

---

## 6. Machine Learning Components

### 6.1 CLIP Vision Encoder (ViT-B/32)

#### Problem It Solves

Encode any input image into a fixed-size vector (512 numbers) that captures semantic meaning, such that visually and semantically similar images have geometrically close vectors.

#### Architecture: Vision Transformer (ViT)

ViT applies the Transformer architecture (originally designed for text) to images.

**Step 1 — Patch Embedding**
The image (224×224 pixels after preprocessing) is divided into non-overlapping 32×32 pixel patches. ViT-B/32 produces 7×7 = 49 patches (224÷32 = 7).

```
224×224 image
    ↓
49 patches of 32×32 pixels
    ↓
Each patch → linear projection → 768-dim embedding
    ↓
[CLS] + 49 patch embeddings = 50 tokens
```

**Step 2 — Transformer Encoder**
A [CLS] (classification) token is prepended. All 50 tokens pass through 12 layers of multi-head self-attention. Each attention layer allows every token to "look at" every other token, building a global understanding of the image.

**Step 3 — Projection**
The [CLS] token output (768 dims) is projected down to 512 dims via a linear layer. This is the image embedding.

#### Preprocessing (`self.preprocess`)

Before the image enters the model:
1. Resize to 224×224 pixels
2. Convert to RGB (drop alpha channel if present)
3. Normalize pixel values: subtract mean `[0.48145466, 0.4578275, 0.40821073]`, divide by std `[0.26862954, 0.26130258, 0.27577711]`

These specific normalization values come from the CLIP training set statistics.

#### Why Not Fine-Tune CLIP on Medical Images?

The system uses CLIP "off the shelf" — no domain adaptation to medical images. This is a pragmatic choice:
- Fine-tuning requires labelled medical data and GPU compute
- CLIP's general visual representations transfer reasonably well to medical images
- Domain-adapted models (BioMedCLIP, etc.) would perform better but add complexity

---

### 6.2 GradCAM Explainability

#### The Problem

CLIP says "these two images are 87% similar." A pathologist asks: "Based on what? Which region is driving that score?"

#### Implementation

`backend/app/services/explainability.py` computes **input-gradient saliency**:

```python
image_tensor.requires_grad_(True)         # Track gradients
features = model.encode_image(image_tensor)
loss = features.sum()                     # Aggregate all embedding values
loss.backward()                           # Backpropagate
saliency = image_tensor.grad.abs()        # Gradient magnitude = importance
saliency = saliency.max(dim=1)[0]        # Max across color channels
```

The gradient at each pixel answers: "if this pixel's value changed slightly, how much would the embedding change?" High gradient = important pixel.

**Visualization steps**:
1. Upsample saliency map to original image dimensions (using bilinear interpolation)
2. Normalize to [0, 1]
3. Apply "inferno" colormap: low → dark purple, high → bright yellow
4. Alpha-blend with original image at 60% opacity
5. Return as PNG bytes

**Limitation**: Input-gradient saliency is a relatively simple explainability technique. It can be noisy and doesn't always localize to meaningful regions. More sophisticated techniques (SHAP, LIME, attention rollout) would give more reliable explanations but require more computation.

---

### 6.3 Text-to-Image Search

CLIP's text encoder converts text queries into the same 512-dim vector space as images. This makes text-to-image search possible with no extra training.

`backend/app/services/embedding.py`:
```python
def _compute_text_embedding(self, text: str) -> list[float]:
    tokens = self.tokenizer([text])              # Tokenize text
    with torch.no_grad():
        features = self.model.encode_text(tokens) # Text → 512-dim vector
        features = features / features.norm(dim=-1, keepdim=True)
    return features[0].tolist()
```

The resulting vector is searched against Qdrant exactly like an image embedding. CLIP was trained to make "a photo of a cat" and a cat photo produce nearby vectors — this property generalizes to medical terminology like "basal cell carcinoma" and BCC histology images.

---

## 7. Key Implementation Walkthrough

### 7.1 Image Search Endpoint

**File**: `backend/app/api/v1/endpoints/search.py`

```python
@router.post("/similar", response_model=SearchResponse)
@limiter.limit("30/minute")  # Rate limit: prevent abuse
async def search_similar(
    request: Request,
    file: UploadFile = File(...),          # Required multipart file upload
    limit: int = Query(default=10, ge=1, le=50),  # Result count, clamped 1-50
    diagnosis: Optional[str] = Query(default=None),
    tissue_type: Optional[str] = Query(default=None),
    benign_malignant: Optional[str] = Query(default=None),
):
    total_start = time.time()

    # --- Validation ---
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise ValidationError(
            "Unsupported file type. Use JPEG, PNG, or TIFF.",
            details={"content_type": file.content_type},
        )
    # Read entire file into memory (necessary for hashing and CLIP preprocessing)
    image_bytes = await file.read()
    if len(image_bytes) > MAX_FILE_SIZE:  # 50MB limit
        raise ValidationError(...)

    # --- Embedding ---
    embed_start = time.time()
    embedding = await embedding_service.get_embedding(image_bytes)
    # This call:
    #   1. Checks Redis cache (SHA256 hash of bytes)
    #   2. If miss: runs CLIP in thread pool, caches result
    embed_time = (time.time() - embed_start) * 1000

    # --- Vector Search ---
    query_filter = build_qdrant_filter(diagnosis, tissue_type, benign_malignant)
    # Returns Qdrant Filter object with MatchValue conditions, or None
    
    search_start = time.time()
    qdrant_results = await qdrant_service.search(
        vector=embedding, limit=limit, query_filter=query_filter
    )
    search_time = (time.time() - search_start) * 1000

    # --- Metadata Fetch ---
    if qdrant_results:
        image_ids = [UUID(str(point.id)) for point in qdrant_results]
        async with db_service.get_session() as session:
            # Batch fetch: one query for all IDs (not N+1 queries)
            stmt = select(Image).where(Image.id.in_(image_ids))
            result = await session.execute(stmt)
            images_by_id = {img.id: img for img in result.scalars().all()}

            # Batch fetch feedback scores
            fb_stmt = (
                select(
                    Feedback.result_image_id,
                    func.sum(Feedback.vote).label("net_vote"),
                )
                .where(Feedback.result_image_id.in_(image_ids))
                .group_by(Feedback.result_image_id)
            )
            fb_result = await session.execute(fb_stmt)
            feedback_scores = {row.result_image_id: row.net_vote for row in fb_result}

    # --- Response Assembly ---
    FEEDBACK_WEIGHT = 0.02
    results = []
    for point in qdrant_results:
        image = images_by_id.get(UUID(str(point.id)))
        if image:
            net_vote = feedback_scores.get(image.id, 0)
            adjusted_score = point.score + (net_vote * FEEDBACK_WEIGHT)
            adjusted_score = max(0.0, min(1.0, adjusted_score))  # Clamp to [0,1]
            results.append(
                SearchResult(
                    image=ImageResponse.model_validate(image),
                    similarity_score=round(adjusted_score, 6),
                    image_url=f"/api/v1/images/{image.id}/file",
                    # Path-relative URL, resolved by Nginx (browser) or
                    # resolveImageUrl() (Electron)
                )
            )

    results.sort(key=lambda r: r.similarity_score, reverse=True)
    total_time = (time.time() - total_start) * 1000
    return SearchResponse(
        query_processing_time_ms=round(embed_time, 1),
        search_time_ms=round(search_time, 1),
        total_time_ms=round(total_time, 1),
        results=results,
        result_count=len(results),
    )
```

**Key decisions**:
- **Two database queries, not N+1**: Fetches all image metadata in one `WHERE id IN (...)` query, not one query per result. Same for feedback. This is critical for performance.
- **Timing everything**: Embed time and search time are returned to the client, displayed in the status bar. This lets the development team see where time is spent.
- **Clamp scores**: Feedback could theoretically push scores above 1.0 or below 0.0. Clamping ensures scores are always in a sensible range.

---

### 7.2 Embedding Service with Redis Caching

**File**: `backend/app/services/embedding.py`

```python
async def get_embedding(self, image_bytes: bytes) -> list[float]:
    # --- Cache lookup ---
    image_hash = cache_service.hash_image(image_bytes)
    # SHA256 is a deterministic hash: same bytes → same hash
    # Collision probability is astronomically low

    cached = await cache_service.get_embedding(image_hash)
    if cached is not None:
        return cached
    # Cache hit: returns in <1ms

    # --- Cache miss: run inference ---
    embedding = await asyncio.to_thread(self._compute_embedding, image_bytes)
    # asyncio.to_thread:
    #   - Submits _compute_embedding to the default ThreadPoolExecutor
    #   - Returns a coroutine that awaits the thread's completion
    #   - Event loop is NOT blocked while CLIP inference runs
    #   - Other HTTP requests are served during this time

    # --- Store in cache ---
    await cache_service.set_embedding(image_hash, embedding)
    # Key: "emb:{hash}"
    # Value: JSON-encoded float array
    # TTL: 24 hours (configurable via cache_ttl_hours setting)

    return embedding

def _compute_embedding(self, image_bytes: bytes) -> list[float]:
    # This runs in a thread (not the event loop)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image_tensor = self.preprocess(image).unsqueeze(0)
    # preprocess: resize to 224×224, normalize pixel values
    # unsqueeze(0): add batch dimension [1, 3, 224, 224]

    with torch.no_grad():
        # no_grad: don't track gradients (saves memory, speeds up inference)
        features = self.model.encode_image(image_tensor)
        # Output shape: [1, 512]

        features = features / features.norm(dim=-1, keepdim=True)
        # L2 normalize: divide each vector by its magnitude
        # After this, all embeddings lie on the unit hypersphere
        # Cosine similarity between unit vectors = dot product

    return features[0].tolist()
    # [0]: remove batch dimension → shape [512]
    # .tolist(): convert PyTorch tensor to Python list of floats
```

---

### 7.3 Frontend API Client

**File**: `frontend/src/api/client.js`

```javascript
// Detect runtime environment
// Electron loads the app as file:///path/to/index.html
// Browser loads it as http://localhost:3000
const isElectron = typeof window !== "undefined" && window.location.protocol === "file:";

// In browser: /api/v1 → Nginx proxies to backend:8000
// In Electron: no server, must use absolute URL
const BASE_URL = isElectron ? "http://localhost:8000/api/v1" : "/api/v1";

// Image URLs returned by the backend are paths like /api/v1/images/{id}/file
// In a browser, the <img> src="/api/v1/..." automatically hits Nginx
// In Electron (file:// protocol), there's no server to resolve /api/v1/...
// This function patches the URL for Electron
export function resolveImageUrl(url) {
  if (isElectron && url && url.startsWith("/")) {
    return `http://localhost:8000${url}`;
    // /api/v1/images/abc/file → http://localhost:8000/api/v1/images/abc/file
  }
  return url;  // In browser: leave as-is, Nginx handles it
}

export async function searchSimilar(file, filters = {}) {
  const formData = new FormData();
  formData.append("file", file);
  // FormData with a File object sends as multipart/form-data automatically

  // Build query string for filter parameters
  const params = new URLSearchParams();
  if (filters.diagnosis) params.set("diagnosis", filters.diagnosis);
  if (filters.tissue_type) params.set("tissue_type", filters.tissue_type);
  if (filters.benign_malignant) params.set("benign_malignant", filters.benign_malignant);

  const queryString = params.toString();
  const url = `${BASE_URL}/search/similar${queryString ? `?${queryString}` : ""}`;

  const response = await fetch(url, { method: "POST", body: formData });
  // Don't set Content-Type header — browser sets it automatically with boundary parameter
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error?.message || `Search failed: ${response.status}`);
    // Optional chaining (?.) prevents crash if response isn't the expected format
  }
  return response.json();
}
```

---

### 7.4 App Component State Machine

**File**: `frontend/src/App.jsx`

The App component manages a state machine with four states:

```
         ┌──────────────────────────────────────┐
         │              idle                    │
         │         (show DropZone)              │
         └──────────────┬───────────────────────┘
                        │ user drops file
                        ▼
         ┌──────────────────────────────────────┐
         │            searching                 │
         │         (show spinner)               │
         └──────────────┬───────────────────────┘
                        │ results received
              ┌─────────┼─────────┐
              ▼         │         ▼
         results        │       error
         (grid)         │    (banner)
              │         │
              │ click result
              ▼
         ┌──────────────────────────────────────┐
         │              detail                  │
         │         (show ImageDetail)           │
         └──────────────────────────────────────┘
                        │ click Back
                        ▼
                      results
```

```jsx
// State variables
const [view, setView] = useState("idle");       // "idle" | "searching" | "results" | "detail"
const [results, setResults] = useState([]);
const [selectedResult, setSelectedResult] = useState(null);
const [error, setError] = useState(null);
const [health, setHealth] = useState(null);
const [filters, setFilters] = useState({});
const [queryFile, setQueryFile] = useState(null);  // Stored to re-run search on filter change
const [timing, setTiming] = useState(null);
const [filterOptions, setFilterOptions] = useState({});

const handleSearch = async (file) => {
  setQueryFile(file);
  setView("searching");
  setError(null);
  try {
    const data = await searchSimilar(file, filters);
    setResults(data.results);
    setTiming({ embed: data.query_processing_time_ms, search: data.search_time_ms, total: data.total_time_ms });
    setView("results");
  } catch (err) {
    setError(err.message);
    setView("idle");
  }
};
```

**Why this pattern**: Centralizing state in App means child components are stateless displays. `ResultsGrid` just receives `results` and calls `onResultClick`. This makes the components easy to understand, test, and reuse.

---

### 7.5 Gunicorn Configuration with Preloaded App

**File**: `backend/gunicorn.conf.py`

```python
import multiprocessing
import os

# Server socket
bind = "0.0.0.0:8000"

# Worker count: capped at 2 to prevent OOM from multiple CLIP model instances
# Override with GUNICORN_WORKERS env var for higher-memory deployments
workers = int(os.environ.get("GUNICORN_WORKERS", min(multiprocessing.cpu_count(), 2)))

# Worker class: Uvicorn async workers (not sync WSGI workers)
worker_class = "uvicorn.workers.UvicornWorker"

# Timeouts
timeout = 120         # Kill worker if request takes >120s (CLIP inference can be slow)
graceful_timeout = 30 # Give workers 30s to finish in-flight requests on shutdown
keepalive = 5         # HTTP keep-alive timeout

# Logging (both to stdout, captured by Docker)
accesslog = "-"
errorlog = "-"
loglevel = "info"

proc_name = "medical-microscopy"

# CRITICAL: Load application before forking workers
# Without this: each worker loads CLIP model independently (~350MB each)
# With this: model loaded once in parent, workers inherit via copy-on-write
# Memory with 2 workers, preload_app=False: ~700MB just for models
# Memory with 2 workers, preload_app=True:  ~350MB + small overhead
preload_app = True
```

**Fork and copy-on-write**: When Gunicorn forks a child process, the OS doesn't immediately copy all the parent's memory. It marks the pages as "copy-on-write" — they're shared between parent and child until either modifies a page, at which point that page is copied. Since the CLIP model weights are never modified after loading, they remain shared across all workers.

---

## 8. Configuration and Deployment

### 8.1 Environment Variables

All configuration flows through `backend/app/core/config.py` (a Pydantic `BaseSettings` class). Values can be set via environment variables or a `.env` file.

| Variable | Default | Used in Docker | Description |
|----------|---------|---------------|-------------|
| `DATABASE_URL` | `postgresql://localhost:5432/medical_microscopy` | `postgresql://postgres:postgres@postgres:5432/medical_microscopy` | PostgreSQL connection string |
| `QDRANT_HOST` | `localhost` | `qdrant` | Qdrant hostname |
| `QDRANT_PORT` | `6333` | `6333` | Qdrant HTTP port |
| `MINIO_ENDPOINT` | `localhost:9000` | `minio:9000` | MinIO internal endpoint |
| `MINIO_ACCESS_KEY` | `minioadmin` | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | `minioadmin` | `minioadmin` | MinIO secret key |
| `MINIO_BUCKET` | `medical-images` | `medical-images` | S3 bucket name |
| `MINIO_SECURE` | `false` | `false` | TLS on/off |
| `REDIS_URL` | `redis://localhost:6379/0` | `redis://redis:6379/0` | Redis connection URL |
| `ENVIRONMENT` | `development` | `production` | Controls some behavior |
| `LOG_LEVEL` | `INFO` | `INFO` | Logging verbosity |
| `GUNICORN_WORKERS` | (auto) | (auto: 2) | Override worker count |
| `CLIP_MODEL_NAME` | `ViT-B/32` | `ViT-B/32` | CLIP model variant |
| `CLIP_DEVICE` | `cpu` | `cpu` | `cpu` or `cuda` for GPU |
| `CACHE_TTL_HOURS` | `24` | `24` | Redis embedding TTL |

**Important note**: In Docker, service hostnames are the service names from `docker-compose.yml` (e.g., `postgres`, `qdrant`, `minio`, `redis`). Docker's internal DNS resolves these to the container's IP.

---

### 8.2 Docker Setup

#### Backend Dockerfile

Multi-stage build:

**Stage 1 — dependency builder**:
```dockerfile
FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
```
Installing dependencies in a separate stage allows Docker to cache them. If only app code changes, the dependency install layer is reused.

**Stage 2 — CLIP model download**:
```dockerfile
FROM builder AS model-downloader
# Pre-download CLIP model at build time
# This bakes the model weights into the image
# Without this, each container startup downloads the model from the internet
RUN python -c "import open_clip; open_clip.create_model_and_transforms('ViT-B-32')"
```

**Stage 3 — runtime**:
```dockerfile
FROM python:3.11-slim
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/...
COPY --from=model-downloader /root/.cache /root/.cache
COPY . .
CMD ["gunicorn", "-c", "gunicorn.conf.py", "app.main:app"]
```

#### Frontend Dockerfile

```dockerfile
# Stage 1: Build React app
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci                    # Faster, reproducible install from lockfile
COPY . .
RUN npm run build             # Runs vite build → produces dist/

# Stage 2: Serve with Nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

#### docker-compose.yml Service Dependencies

```yaml
backend:
  depends_on:
    postgres:
      condition: service_healthy    # Wait for pg_isready
    qdrant:
      condition: service_started   # Qdrant has no healthcheck in free tier
    minio:
      condition: service_healthy   # Wait for mc ready
    redis:
      condition: service_healthy   # Wait for redis-cli ping
```

`service_healthy` waits for the healthcheck to pass. `service_started` waits for the container to just start (no healthcheck). Without these, the backend might start before PostgreSQL is ready and fail to connect.

---

### 8.3 Running the Application

#### Docker (Recommended)

```bash
# First-time setup: build and start all services
docker compose up --build

# Subsequent starts (no code changes):
docker compose up

# Stop all services:
docker compose down

# Stop and delete all data (volumes):
docker compose down -v
```

After services start, access the application at `http://localhost:3000`.

**Initial data loading** (run once after first `docker compose up`):
```bash
docker compose exec backend python -m scripts.ingest_custom \
  --image-dir ./data/DV_Data
```

#### Local Development (No Docker)

Requires: PostgreSQL, Qdrant, MinIO, and Redis installed locally.

```bash
# Terminal 1: Start Qdrant
./qdrant  # or: qdrant serve

# Terminal 2: Start MinIO
minio server ~/minio-data --console-address ":9001"

# Terminal 3: Backend
cd backend
source venv/bin/activate
alembic upgrade head          # Run migrations
uvicorn app.main:app --reload --port 8000

# Terminal 4: Frontend (Electron desktop app)
cd frontend
npm run start                 # Builds and opens Electron window
# Or for browser development:
npm run dev                   # Vite dev server at localhost:5173
```

PostgreSQL is assumed to be running as a system service (e.g., `brew services start postgresql`).

---

### 8.4 Health Verification

```bash
# Check all services are healthy
curl http://localhost:8000/api/v1/health

# Expected response:
{
  "status": "healthy",
  "services": {
    "api": "up",
    "postgres": "up",
    "qdrant": "up",
    "minio": "up",
    "clip": "up",
    "redis": "up"
  },
  "version": "1.0.0",
  "environment": "production"
}
```

---

## 9. Glossary

**ACID**: Atomicity, Consistency, Isolation, Durability — properties that guarantee database transactions are processed reliably.

**Alpha blending**: Combining two images by mixing their pixels with a transparency factor (alpha). Used to overlay the attention heatmap on the original medical image.

**Alembic**: Database migration tool for SQLAlchemy. Tracks and applies versioned schema changes.

**ASGI**: Asynchronous Server Gateway Interface. The Python standard for async web servers. FastAPI and Uvicorn both implement ASGI.

**asyncio**: Python's standard library for writing async code with the `async/await` syntax.

**asyncpg**: Async PostgreSQL driver for Python.

**Attention map**: A visualization showing which parts of an image a neural network focused on when producing an output.

**CBIR**: Content-Based Image Retrieval. Searching images by visual content rather than text metadata.

**CLIP**: Contrastive Language-Image Pre-training. A neural network trained to align images and text in a shared vector space.

**Cosine similarity**: A measure of similarity between two vectors based on the angle between them. Ranges from -1 (opposite) to 1 (identical direction). Used to compare CLIP embeddings.

**Docker**: Platform for packaging and running applications in isolated containers.

**Docker Compose**: Tool for defining and managing multi-container Docker applications.

**DICOM**: Digital Imaging and Communications in Medicine. Standard format for medical imaging data.

**Electron**: Framework for building cross-platform desktop apps with web technologies (Chromium + Node.js).

**Embedding**: A fixed-size numerical vector representation of an item (image, text, etc.) that encodes its semantic meaning.

**Event loop**: The core of Python's async runtime. A single thread that switches between coroutines, running them when their I/O is ready.

**FastAPI**: Python web framework for building APIs, built on Starlette and Pydantic.

**Fork**: Creating a copy of a running process. Gunicorn forks worker processes from the parent after loading the CLIP model.

**GradCAM**: Gradient-weighted Class Activation Mapping. A technique for visualizing which image regions influenced a neural network's output.

**Gunicorn**: Python WSGI/ASGI process manager. Runs multiple worker processes for production deployments.

**HNSW**: Hierarchical Navigable Small World graph. A data structure for efficient approximate nearest-neighbor search in high-dimensional spaces.

**ISIC**: International Skin Imaging Collaboration. Runs annual challenges with public dermoscopy datasets.

**L2 normalization**: Dividing a vector by its L2 norm (magnitude) so it has unit length. Enables cosine similarity to be computed as a dot product.

**Lifespan**: FastAPI's context manager for startup and shutdown events. Connects services on startup, disconnects on shutdown.

**MinIO**: Open-source S3-compatible object storage server.

**Migration**: A versioned script that describes a database schema change (add table, add column, etc.).

**Multipart form data**: An HTTP encoding for file uploads. The request body is split into multiple parts, each with its own headers.

**Nginx**: High-performance web server and reverse proxy.

**ORM**: Object-Relational Mapper. Maps database tables to Python classes and rows to objects.

**Payload (Qdrant)**: Metadata attached to a vector point in Qdrant. Can be used for filtering during search.

**Pydantic**: Python data validation library using type annotations.

**Qdrant**: Vector similarity search engine. Stores and searches high-dimensional vectors efficiently.

**Rate limiting**: Restricting how many requests a client can make in a given time period.

**Redis**: In-memory key-value store used here for caching CLIP embeddings.

**Reverse proxy**: A server that forwards client requests to backend servers and returns the response. Hides backend complexity from clients.

**SHA256**: Cryptographic hash function. Produces a deterministic 256-bit fingerprint of any data. Used here to identify unique images for cache lookup.

**Singleton**: A design pattern where only one instance of a class exists. Services in this project are singletons — one instance shared across all requests.

**SQLAlchemy**: Python SQL toolkit and ORM. Supports both synchronous and asynchronous operation.

**TTL**: Time-to-live. Automatic expiry of Redis keys after a set duration (24 hours for embeddings in this project).

**UUID**: Universally Unique Identifier. A 128-bit number used as a unique identifier. Extremely low collision probability.

**Uvicorn**: ASGI server implementation in Python. Used as the worker class inside Gunicorn.

**Vector space**: A mathematical space where embeddings exist. Similar items are near each other geometrically.

**ViT**: Vision Transformer. Applies the Transformer architecture (originally for text) to images by treating patches of pixels as tokens.

**WSGI**: Web Server Gateway Interface. The synchronous equivalent of ASGI. Not used directly here (FastAPI uses ASGI), but Gunicorn historically served WSGI apps.

---

*This document covers 100% of the source files in the medical-microscopy repository as of the date of writing. For questions about specific implementation details, refer to the source file paths cited throughout.*
