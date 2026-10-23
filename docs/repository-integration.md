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

This separation is intentional. The imported FastAPI routes do not enforce the
existing account/session model. Exposing them or replacing the application's
supplier source requires an explicit authenticated API adapter, input/unit
mapping, failure handling, and a reviewed data-source decision first.

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
python3 -m unittest discover -s tests -p test_backend_integration.py -v
```

The Python smoke suite always parses the imported source and opens both SQLite
snapshots read-only. Runtime cases require the packages in `requirements.txt`;
they report explicit skips when those packages are unavailable. Runtime cases
use temporary SQLite fixtures and mocked Gemini/OSRM calls, not live credentials
or the tracked databases. A skipped test is not evidence of runtime readiness.

The original `test_anomalies.py` and `test_recommedation.py` are also preserved.
The latter catches errors and prints them, so its exit status alone must not be
treated as proof of a successful recommendation test.

## Remaining integration limitations

- The smoke suite reports a syntax error at line 1 of the inherited
  `backups/ai_advisor_backup.py`, which contains pasted shell commands. It is
  preserved verbatim as a historical backup, not treated as an executable entry
  point. The failing source check remains visible rather than being excluded.
- At the initial local integration, the declared Python packages were absent.
  Replit's package helper failed with `externally-managed-environment`; no
  `--break-system-packages` or virtual environment workaround was used. A Nix
  package-availability lookup timed out. Python runtime verification remains
  blocked until supported dependency provisioning succeeds.
- Live Gemini, geocoding and routing calls are not verified by offline tests.
  The inherited Gemini model identifier must be confirmed with the provider.
  Application Tools secrets are not automatically environment variables.
- `src/emergency_orders.py` uses a working-directory-relative database filename,
  unlike the catalogue module. Do not start it against a newly created empty
  database or the tracked snapshot before defining a writable runtime data path.
- The imported emergency endpoints have no account authorization. Keep them
  private until an authenticated integration is implemented.
- `src/main.py` is an inherited scaffold importing the missing `utils` module;
  it is not the supplier API entry point. Root `main.py` is empty.
- The inherited advice code can report an AI success while returning a
  missing-key message. This is not proof that Gemini is configured or usable.

No workflow, public route, database migration, AI-provider switch, or live data
replacement is introduced by this repository merge.
