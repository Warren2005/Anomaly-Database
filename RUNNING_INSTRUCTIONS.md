# Running Instructions

## Prerequisites

- Python 3.11 (backend)
- Node.js + npm (frontend build)
- No Docker, no Postgres/Qdrant/MinIO/Redis — everything runs as plain local processes and files (see "Architecture" below).

---

## First-time setup

```bash
# Backend
cd backend
python -m venv venv
venv\Scripts\activate            # Windows; use `source venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
copy .env.example .env           # Windows; `cp .env.example .env` elsewhere
```

Edit your new `backend/.env` and set `LIBRARY_DATA_DIR` — see "Where the data lives" below before you do this; it's not just a default path.

```bash
# Frontend (one-time build — see "Local development" below for hot-reload instead)
cd frontend
npm install
npm run build
```

## Running it

```bash
cd backend
venv\Scripts\activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

(Use whatever `API_PORT` you set in `.env` instead of 8000 if you changed it.)

Open **http://localhost:8000/** — the backend serves the built frontend directly at `/` (see `app/main.py`'s static file mount), so there's only one port to run and no separate frontend server needed for normal use. Interactive API docs are at `/docs`, and a plain JSON health check is at `/api/v1/health`.

Stop it with Ctrl+C (or find and kill the `python -m uvicorn ...` process).

---

## Where the data lives (read this before setting LIBRARY_DATA_DIR)

There is no database to install. `backend/app/services/file_store.py` stores everything — image metadata, embeddings, the embedding cache, and the `events.jsonl` observability log — as plain files under whatever directory `LIBRARY_DATA_DIR` points at.

**This project currently uses the team's shared Dropbox as that directory**, specifically so the data gets Dropbox's automatic version history and delete-recovery as a backup mechanism, with zero custom backup code (see "Backups" below). That means:

- `LIBRARY_DATA_DIR` must point at **your own local machine's copy** of that same shared Dropbox folder (e.g. its path on your machine might be `C:\Users\<you>\DarkVision Dropbox\Analysis-ILI\Defect Library\ILI DA Co-op Project - Anomaly Search`, not necessarily the same drive letter as anyone else's machine). This is exactly why the path lives in the gitignored `.env` and not in code — it's genuinely different per machine.
- Make sure Dropbox is set to keep that folder fully downloaded locally (not "online-only"/Smart Sync) — the backend reads these files directly off disk on every request.
- **Only run one backend instance at a time against this shared folder.** The file-locking that makes concurrent requests safe (`portalocker`, atomic writes — see `file_store.py`) only protects multiple processes on the *same machine*; it does not coordinate across two different machines' Dropbox clients both syncing the same folder. If two people ran their own backend simultaneously, both pointed at the same synced folder, a genuine race is possible — one person's upload getting silently overwritten by the other's, or Dropbox creating a "conflicted copy" file our code never reads. Pulling this repo and starting your own backend to independently verify it works is completely fine; just don't leave two instances running live against the same Dropbox data at the same time. Whoever is "the shared server" at any given moment should be the only live instance.
- If you'd rather test against your own throwaway data instead of the real shared corpus, just point `LIBRARY_DATA_DIR` at any local folder (e.g. the default `./data/library`) instead — it'll start empty and won't touch the shared Dropbox data at all.

---

## Ingesting images

```bash
cd backend
python -m scripts.ingest_custom --image-dir ./data/DV_Data
```

- `--label` sets the dataset label tag (defaults to the folder name)
- `--limit N` processes only the first N images, useful for a quick test
- The script is resumable via a per-folder `.ingest_checkpoint.db` checkpoint file — if interrupted, re-running the same command skips already-processed images. Delete that checkpoint file if you need to force full re-processing (e.g. after a CLIP model change — see `app/services/embedding.py`'s `model_tag`).

Verify the data landed by hitting the running backend's search endpoint, or check `backend/scripts/show_stats.py` / read `LIBRARY_DATA_DIR/metadata.json` directly.

---

## Backups

The backup story doesn't need any new backup service or scheduled job — it just needs `LIBRARY_DATA_DIR` to live inside a location that already versions files on its own, via a desktop sync client.

**Currently configured**: `LIBRARY_DATA_DIR` points at a folder inside the team's shared Dropbox. Every write already lands via an atomic replace (see `file_store.py`), so each save looks like a clean version to Dropbox's version history, and accidental deletes are covered by Dropbox's "Deleted files" recovery — both with zero custom backup code. Two things worth checking periodically:

- **The Dropbox client on the shared machine must keep this folder fully downloaded** (not "online-only"/Smart Sync).
- **Version history retention depends on the team's Dropbox plan** (commonly 30 days on Basic/Plus, longer on Business plans) — worth confirming how far back that actually reaches.

This same approach — pointing `LIBRARY_DATA_DIR` at any always-synced cloud folder — works identically with SharePoint/OneDrive if that ever becomes the company's preferred tool instead: no code changes needed, only a different folder path.

## Observability

Every search, library upload, and handled/unhandled error appends one JSON line to `LIBRARY_DATA_DIR/logs/events.jsonl` (see `app/services/event_log.py`) — e.g. `{"ts": "...", "event": "search", "embed_ms": 43.2, "rerank_ms": 79.1, "result_count": 30, "cache_hit": false}`. Because it lives under `LIBRARY_DATA_DIR`, it inherits the same backup story above for free.

To see a summary (p50/p95 search latency, error rate, embedding cache hit rate) over a time window:

```bash
cd backend
python -m scripts.show_stats            # last 24h
python -m scripts.show_stats --hours 1  # last hour
```

This is deliberately dependency-free — no Prometheus/Grafana to stand up or maintain. (The existing `/metrics` Prometheus endpoint and counters still work if you want them, but `events.jsonl` + `show_stats.py` is the log actually meant to be checked day-to-day.)

## Local development (frontend hot-reload)

`npm run build` (used above) produces a static snapshot — fine for normal use, but you won't see edits live. For active frontend development, run the backend as above, then in a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

This starts Vite on **http://localhost:5173**, proxying `/api` requests to your backend. By default it assumes the backend is on port 8000; if yours runs on a different port, `copy .env.local.example .env.local` in `frontend/` and set `BACKEND_PORT` to match (see `vite.config.js`).

After editing frontend code for real, rebuild the static snapshot the backend serves with `npm run build`, then restart the backend.

---

## Letting others on your network use it

The backend binds to `0.0.0.0`, so once it's running, anyone on the same local network can reach it at `http://<your-machine's-LAN-IP>:<API_PORT>/` in a browser (find your IP with `ipconfig`/`ifconfig`) — no frontend dev server needed, since the backend already serves the built frontend at `/`. Windows Firewall may need to allow inbound connections on that port for machines other than your own to reach it; test with a colleague opening `/api/v1/health` in their browser first.

---

## Always-on deployment (survives sleep, recovers after a reboot)

A laptop that goes to sleep stops responding to network requests, full stop — no server process can outlive that. If you need the link to stay reachable to everyone on the company network/VPN even while nobody is actively using the host machine, the fix isn't in the app, it's in the host machine's Windows configuration. This section is for whoever's machine is acting as the shared host (see `CLAUDE.md` for which machine that currently is).

**This does not survive a full shutdown or a Windows Update-triggered restart** — only sleep. After a genuine restart, the steps below get the server back up automatically on the next login; there's no way to make a stopped machine start itself back up.

### 1. Stop the host from sleeping

Run once, in an elevated PowerShell, on the host machine:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

This only disables sleep while plugged into AC power — leave the host plugged in at all times. If it's a laptop, also check **Settings → System → Power & Sleep → Additional power settings → Choose what closing the lid does** and set "When plugged in" to **Do nothing**, otherwise closing the lid suspends it regardless of the timeout above. Screen/monitor timeout is unrelated to this and can be left as-is — the display turning off doesn't affect the backend.

### 2. Open the port to the company network

```powershell
New-NetFirewallRule -DisplayName "ILI Backend" -Direction Inbound -Protocol TCP -LocalPort <API_PORT> -Action Allow -Profile Domain,Private
```

Deliberately scoped to the `Domain`/`Private` firewall profiles, not `Public` — this keeps it off the public internet even if the machine's network location is ever misdetected. This deployment is company-network/VPN-only by design, not internet-facing — this app has no login/auth layer, so exposing it publicly would need real security work first.

### 3. Get a network address that doesn't change

A DHCP-assigned IP can change after a reboot, silently breaking the link everyone has bookmarked. Before sharing an address:

- Run `ipconfig /all` and `hostname` on the host, then try `ping <hostname>` from another machine on the network — many corporate (Active Directory-joined) networks already resolve a machine's hostname automatically, which is the simplest fix and needs no ticket.
- If that doesn't resolve, ask IT for a **DHCP reservation** binding this machine's MAC address to a fixed IP, so the address is stable across reboots without hand-configuring a static IP (which can conflict with the DHCP pool if done ad hoc).

### 4. Auto-start the backend after a reboot

The backend needs to run in the same Windows user session as the Dropbox desktop client (Dropbox syncs per-user, and `LIBRARY_DATA_DIR` depends on that sync being live and current — see "Where the data lives" above), so this uses an "At log on" Task Scheduler trigger, not a session-independent service:

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\backend\run_server.ps1"'
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "ILI Backend" -Action $action -Trigger $trigger -RunLevel Highest
```

(Adjust the `-File` path to wherever this repo lives on the host.) This runs `backend/run_server.ps1` — a small wrapper in this repo that activates the venv, reads `API_PORT` from `.env`, and launches `uvicorn`, logging to `backend/logs/uvicorn.log` for troubleshooting.

For the task to fire without anyone manually logging in after a reboot, the host's Windows account needs to auto-log-in on boot (`netplwiz` → uncheck "Users must enter a password" for that account, or your IT team's preferred method). This trades a small amount of physical-console security for full recovery automation — reasonable for a machine already behind company physical security, but worth a deliberate call rather than a default. If auto-login isn't acceptable, the Task Scheduler job still saves you from having to remember the exact command — just log in manually after a reboot and it starts itself a few seconds later.

### 5. Verify

After setting all of the above up, test the whole recovery path once: restart the host machine, don't touch it, and from a *different* machine on the network confirm `http://<host-address>:<API_PORT>/api/v1/health` comes back healthy within a minute or two of the host finishing boot.

---

## Troubleshooting

- **CUDA / GPU errors on startup**: `CLIP_DEVICE=cuda` requires a CUDA build of `torch`/`torchvision` matching your driver, not the default CPU wheels `open-clip-torch` pulls in — see the comment block in `requirements.txt`. When in doubt, set `CLIP_DEVICE=cpu`; it works everywhere, just slower.
- **`ModuleNotFoundError` on startup**: make sure the virtual environment is activated (`venv\Scripts\activate`) before running `pip install` or `uvicorn`.
- **Frontend shows "backend offline" in `npm run dev` mode**: confirm `frontend/.env.local`'s `BACKEND_PORT` (if you created one) matches the port your backend actually runs on — see "Local development" above.
- **Port already in use**: pick a different `API_PORT` in `backend/.env` (common cause on Windows: corporate software already bound to 8000).
- **`/` returns a 404 instead of the app**: the backend only mounts the frontend if `frontend/dist/` exists — run `npm run build` in `frontend/` first.
