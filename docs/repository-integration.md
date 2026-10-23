# Backend history integration

This repository combines the ProcureWise-Hub application with the original
SDC_Hackathon_Trihack backend history using a two-parent, non-squashed Git merge.
The original backend repository is not modified. Experimental task branches are
preserved through `archive/replit/*` references, not reapplied to the application.

## Preserved application boundaries

- `artifacts/procurement-workspace` remains the React application.
- `artifacts/api-server` remains its authenticated Express API.
- `lib/db` and its existing PostgreSQL migrations remain authoritative for the
  application, accounts, encrypted Tools secrets, and signed invoices.
- The existing buyer/account and supplier-signature evidence and PDF exporter
  are unchanged by the backend import.
- Root Python modules and `src/` retain the imported backend implementation.
  They are not automatically exposed through the application's proxy or
  connected to its request/invoice mutations.

This separation is intentional. The FastAPI routes require private service
authentication, not the existing browser account/session model. Exposing them or
replacing the application's supplier source requires an explicit authenticated
Express adapter, input/unit mapping, failure handling, and a reviewed data-source
decision first. A service token alone does not identify a buyer or manager.

## Imported backend components

| Component | Source |
| --- | --- |
| Supplier advice and anomaly rules | `api.py` |
| Gemini request construction | `ai_advisor.py` |
| OSRM road-distance calculation | `distance.py` |
| SQLite catalogue and supplier ranking | `src/database_w_input.py` |
| Emergency selection and approval records | `src/emergency_orders.py` |
| Existing SQLite snapshots | `src/business_supplier_selection.db`, `backups/business_supplier_selection_backup.db` |

The SQLite snapshots are historical/sample backend data, not a replacement for
the live PostgreSQL database. Do not run the interactive seeding scripts against
them or migrate them into live data without a separate decision.

## Verification

```sh
pnpm run typecheck
pnpm --filter @workspace/procurement-workspace test
pnpm --filter @workspace/api-server test
python -m unittest discover -s tests -p 'test_backend_*.py' -v
python test_anomalies.py
python test_recommedation.py
python -m pip check
```

The Python suite parses executable sources and opens both SQLite snapshots
read-only. A separate test verifies the exact hash and expected syntax failure of
the malformed archival AI file; it is not claimed to be repaired. Runtime cases
use temporary SQLite fixtures, fixture service credentials and mocked Gemini/OSRM
calls. Two loopback HTTP tests start actual private Uvicorn processes. No tests
modify the tracked SQLite databases or invoke a paid model.

The anomaly script remains available. The recommendation script now seeds an
isolated deterministic fixture and asserts quantity, shipping, ranking and
business isolation. Previously it queried business 1, while successful sample
routes belonged to businesses 3/4, and printed an empty result as success.
Assertions and exceptions now exit nonzero.

## Python installation and private startup

The workspace uses Replit's full `python-3.12` module alongside the unchanged Node
module. The base Python module lacked package tools. The full module's pip
executable disables user-site access, conflicting with its default user install.
Development `PIP_USER=false` and `PIP_TARGET` direct supported package installation
to the project-local `.pythonlibs/lib/python3.12/site-packages` directory, which
the Python module can import. No virtual environment or Nix store write is used.
The Replit package helper successfully installed the declared dependencies.
`requirements.txt` pins the direct versions tested. The helper also provisioned
`libxcrypt`. Node packages and workflows are not replaced.

The target directory is installation output, ignored by Git and deployment.
When moving/forking this workspace, update the development `PIP_TARGET` to the new
project root and reinstall the declared packages through Replit's package tools.
Python is not added to the existing Node production service.

`python -m src.main --help` and `python main.py --help` are the supported launchers.
The old placeholder `utils` dependency is removed, not replaced with invented
greeting utilities.

Before starting either service, provision `PYTHON_BACKEND_TOKEN` securely in
Replit Secrets (at least 32 characters). Do not put it in source, URLs, browser
code, or logs. No real service token was provisioned by the repair; tests use
ephemeral fixture credentials.

```sh
python -m src.main --service advice --port 8000
python -m src.main --service emergency --port 8001
```

Both launchers bind **127.0.0.1 only**. Neither is registered as a public artifact
route. Routes fail closed: 503 without valid server-side configuration, 401 for
missing/wrong bearer authentication. Browser CORS and public schema/docs are
disabled. Bounded supplier lists, finite-number validation and generic provider
errors reduce resource abuse and prevent credential-bearing error readback.
These are integration prerequisites, not a full production security certification.

## Database selection

- `DATABASE_URL` remains the Express/PostgreSQL application's authoritative
  database. Python never treats that URL as a SQLite filename or silently
  migrates/falls back from PostgreSQL.
- Both Python modules use the same absolute configured SQLite path.
  Without `PYTHON_SQLITE_PATH`, catalogue reads use the historical snapshot in
  `src/` **read-only**, independent of the working directory.
- Writes to tracked snapshots, backup files, and symlink/hardlink aliases are
  rejected. Mutating operations require an explicitly selected separate file.
- For private emergency evaluation, first create a separate working copy of the
  sample catalogue (e.g. under ignored `backend-data/`), then set the non-secret
  `PYTHON_SQLITE_PATH` to its **absolute** path. No runtime copy is automatically
  created from or substituted for live application data.
- Missing files fail instead of silently creating the wrong empty database.
  Emergency startup validates the existing catalogue tables before initializing
  its own purchase table. Transactions close connections explicitly.
- Approvals are conditional updates; an already decided fixture purchase cannot
  be overwritten by another decision.

## Gemini and routing

- Gemini is optional for deterministic validation. Missing `GEMINI_API_KEY`
  produces `ai_status=unavailable`, not false AI success. Empty/provider-failed
  responses produce failure status without logging upstream bodies or secrets.
- `GEMINI_MODEL` can select a provider-supported model; the default is
  `gemini-flash-latest`, replacing the unverified `gemini-3.8-flash` identifier.
  The client has a 15-second request timeout.
- No Gemini secret exists in the current environment, so live Gemini generation,
  model availability and quota remain **unverified**. Application Tools secrets
  are not automatically environment variables. No provider was switched or
  newly provisioned.
- A live public OSRM KL-to-Shah-Alam route probe succeeded: 25.21 km, 23.8 minutes.
  This is a verification sample, not a fixed quote or delivery promise.
- Offline provider tests cover distance unit conversion, invalid coordinates,
  no-route/invalid-route responses, missing AI configuration, empty results and
  sanitized provider failures. Supplier geocoding itself was not live-tested.

## Remaining limitations

- There is still a syntax error at line 1 of the inherited
  `backups/ai_advisor_backup.py`, which contains pasted shell commands. It is
  preserved verbatim as a historical backup, not treated as an executable entry
  point. Active `ai_advisor.py` is the supported implementation.
- Live Gemini verification requires a securely configured credential and
  confirmed model/quota. Missing configuration is not a test pass.
- The upstream Starlette TestClient warns that its current httpx compatibility
  path is deprecated; tests pass, but a future dependency upgrade should review it.
- A reviewed Express adapter still needs account/session enforcement, request
  unit mapping, supplier identity/data mapping, and error handling before Python
  can be connected to the frontend. Do not use a service token as proof of
  purchasing-manager or supplier authority.
- PDF exporter code is unchanged; this repair does not add certificate-backed
  signatures or claim that browser PDF download was exercised by Python tests.

No public route, live database migration, AI-provider switch or live data
replacement is introduced by the import or this repair.
