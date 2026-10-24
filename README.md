# ProcureWise

ProcureWise is a procurement workspace for small-business purchasing teams. The
existing React and Express workspaces remain at their current locations; the
private Python backend is organized under `src/`.

## Architecture

- `artifacts/procurement-workspace/` — React and Vite buyer-facing application.
- `artifacts/api-server/` — Express API, account/session authentication,
  PostgreSQL-backed procurement workflows, order approvals, signatures, and
  PDF invoice generation.
- `lib/` — shared API contracts, database code, and integrations.
- `src/api/` — private FastAPI routes for supplier advice and the separate
  emergency-order service.
- `src/models/` — Python request models and validation.
- `src/services/` — advice, anomaly checks, supplier ranking, distance/location
  helpers, and emergency-order business logic.
- `src/database/` — SQLite connection policy and catalogue/emergency data access.
- `scripts/python/` — opt-in Python utilities and the interactive catalogue demo.
- `tests/` — Python regression tests and isolated integration checks.
- `docs/` — backend architecture, data boundaries, and verification notes.

The Express/PostgreSQL application is authoritative for accounts, saved
procurement requests, approvals, invoice records, and signatures. The Python
services are separate private services. The SQLite emergency-order endpoints
are not connected to the live Express procurement workflow.

## Requirements and setup

- Node.js 24 with pnpm.
- Python 3.12 for the Python services.
- A PostgreSQL database for the Express application.

Install the JavaScript workspace with `pnpm install`. Install the Python
requirements with `python -m pip install -r requirements.txt` when setting up a
local Python environment. Replit's configured Python package tooling should be
used for this workspace's Python runtime.

Use `.env.example` as a variable-name checklist for local development. Keep real
credentials in Replit Secrets or an untracked local environment file; never
commit them. The Python service reads `PYTHON_BACKEND_TOKEN` from the process
environment (or Replit Secrets); load a local `.env` into the shell before
launching if using one. The private Python services require a token of at least
32 characters. `GEMINI_API_KEY` is optional and enables AI advice;
`GEMINI_MODEL` optionally selects a supported model. No live Gemini request is
part of the offline test suite.

## Run

In separate terminals or the configured Replit workflows:

```sh
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/procurement-workspace run dev
python -m src.main --service advice --port 8000
```

The Python advice service binds to loopback and requires the private bearer
token. The root `main.py` remains a compatibility entry point; the supported
Python launcher is `python -m src.main`.

The emergency Python service is separate from the live application and creates
its emergency-order table at startup. Run it only against a disposable SQLite
database selected with an absolute `PYTHON_SQLITE_PATH`, not the tracked
snapshot or a production data file:

```sh
python -m src.main --service emergency --port 8001
```

The interactive catalogue demo can geocode an address, call OSRM, and write
catalogue data. Use only a disposable database:

```sh
python -m scripts.python.catalogue_demo
```

## Checks

These checks use mocked providers or disposable fixtures and do not require
Gemini access or modify the tracked SQLite snapshots:

```sh
python -m unittest discover -s tests -p 'test_backend_*.py' -v
python -m unittest discover -s tests -p 'test_anomalies.py' -v
python -m unittest discover -s tests -p 'test_recommendation.py' -v
pnpm --filter @workspace/api-server run test:advice
pnpm --filter @workspace/procurement-workspace test
pnpm run typecheck
pnpm run check:preview-assets
```

The full API/bootstrap test suite and post-merge setup may perform database
setup or migrations. Use only an explicitly isolated database for those
commands; do not run them against production data.

`source-code/` is retained as an existing tracked directory. The active
application source of truth is the workspace layout described above.
