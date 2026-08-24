# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Inspection Image Search — a content-based image retrieval system (FastAPI + CLIP + Qdrant + PostgreSQL + MinIO + Redis backend, React/Vite frontend, optional Electron shell). See `README.md` for the quickstart and `LEARNING.md` for a full architecture/concepts walkthrough. Run everything with `docker compose up -d --build`.

## Dev vs. team-preview instances — DO NOT TOUCH team-preview

There are two running instances of this app on this machine, deliberately isolated from each other:

| | Dev instance (default working area) | Team-preview instance |
|---|---|---|
| Code | `C:\Users\warred2\Coop Project\medical-microscopy` (this checkout, branch `master`) | `C:\Users\warred2\Coop Project\medical-microscopy-team-preview` (a separate `git worktree`, branch `team-preview`) |
| Data | `...\ILI DA Co-op Project - Anomaly Search` (the real data) | `...\ILI DA Co-op Project - Anomaly Search - TEAM PREVIEW` (a one-time duplicate, frozen at the point it was copied) |
| Backend port | 8002 | 8001 (the link already shared with the team) |
| Who uses it | The user, for active development | The team, for hands-on testing/feedback |

**Default to working only in the dev instance/checkout** (edit code, `npm run build`, restart the port-8002 backend, etc.) unless the user explicitly asks to push an update to the team. Never edit files in the `medical-microscopy-team-preview` worktree, never write to the `TEAM PREVIEW` data folder, and never restart the port-8001 process as a side effect of other work — the whole point of this split is that the team's instance stays stable and untouched while dev work happens elsewhere, so an accidental touch defeats the purpose.

The one exception: the user explicitly asking to "push," "deploy," "release," or "update what the team sees" — that means merging `master` into `team-preview` inside that worktree, rebuilding its frontend, and restarting only the port-8001 process. Confirm this is really what's being asked before doing it, since it's the one action in this whole setup that affects the team.

## Keeping the codebase clean

This project has previously accumulated real cruft from dataset/feature pivots (a dermatology demo repurposed into an industrial-inspection tool) and from local manual-setup artifacts. When adding, changing, or retiring anything here, actively guard against these recurring failure modes:

1. **Retire features completely, not partially.** If you remove a dataset, endpoint, or feature, remove *all* of it in the same pass: the code, its tests, its data/fixtures, its `requirements.txt`/`package.json` entries, its router/registration wiring, and its mentions in `README.md`/`RUNNING_INSTRUCTIONS.md`/`LEARNING.md`. A half-removed feature (e.g. deleted data but a still-present, now-broken ingestion script) is worse than not touching it.

2. **Never commit binaries, downloaded artifacts, or service-generated data directories.** Local tool binaries (e.g. a downloaded `qdrant` executable), `.tar.gz`/`.zip` downloads, and a service's own on-disk state (e.g. Qdrant's `storage/` or `snapshots/` directories, MinIO data dirs) do not belong in git. Before committing, check `git status` for anything that looks like a large binary or a data dump, and make sure `.gitignore` actually covers it — don't assume it does.

3. **When you touch the DB schema, update everything that assumes the old shape in the same change.** A new Alembic migration should come with: updated model column tests, updated ORM mocks in existing tests (a bare `MagicMock()` silently auto-vivifies unset attributes, which passes until something like Pydantic validation touches that attribute), and updated Pydantic schemas. Don't let migrations and test coverage drift apart.

4. **Don't leave orphaned frontend components.** If you unwire a component from its parent (e.g. removing it from a render tree during a bug fix), delete the component file in the same change — don't leave it importable-but-unused.

5. **Don't add infrastructure config for services that aren't actually deployed.** A `prometheus.yml`, an extra `docker-compose` service block, etc. should only exist if something in the running stack actually uses it. Orphaned config describing infrastructure that was never wired in is misleading, not "future-proofing."

6. **Keep user-facing copy and API metadata matched to the current domain.** Page titles, alt text, labels, and the FastAPI `title`/`description` should describe what the app actually does today. When the domain/branding changes, grep for the old name/terminology and update every user-visible occurrence, not just the obvious ones.

7. **An unused API endpoint is not automatically dead code.** Before deleting a backend capability with no frontend caller (batch search, WebSocket streaming, etc.), check whether it's a deliberate API-only capability versus genuinely abandoned work. When in doubt, ask rather than assuming either way.

8. **Before any cleanup or refactor that touches multiple files, datasets, or features, scope it explicitly first** (a short plan, or a couple of targeted questions) rather than guessing at what counts as "unnecessary." Deleting an unreferenced folder can be irreversible if it isn't tracked in git — confirm before removing anything that isn't trivially recoverable.
