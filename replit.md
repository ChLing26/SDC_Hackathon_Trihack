# ProcureFlow

Shared procurement workspace for SME buying teams, with persistent email-and-password accounts.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the Express API server (port 8080)
- `pnpm --filter @workspace/procurement-workspace run dev` — run the React/Vite frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run migrate` — repeatable procurement and account/session schema setup plus legacy secret-table cleanup; also runs after task merges
- `pnpm --filter @workspace/api-server test` — account/session API checks plus isolated empty-schema bootstrap, procurement workflow, and process-restart checks (cleans up its own data)
- Required env: `DATABASE_URL` — PostgreSQL connection for the Express application.
  The private Python services also require `PYTHON_BACKEND_TOKEN`; optional
  Python settings are `GEMINI_API_KEY`, `GEMINI_MODEL`, and `PYTHON_SQLITE_PATH`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/procurement-workspace/` — React/Vite application.
- `artifacts/api-server/` — Express API, accounts, PostgreSQL workflows, approvals,
  signatures, and PDF invoices.
- `lib/` — shared API contracts, database, and integration packages.
- `src/api/`, `src/models/`, `src/services/`, `src/database/` — private Python
  FastAPI routes, validation models, procurement logic, and SQLite data access.
- `scripts/python/` — opt-in Python utilities and the interactive catalogue demo.
- `tests/` and `docs/` — regression checks and project documentation.
- `source-code/` remains a tracked submission copy; active source files are in
  the workspace paths above.

## Architecture decisions

- Authentication uses the explicitly requested local email/password accounts and PostgreSQL sessions, not an external identity provider.

## Account operation

- Run the forward migrations before starting the API against either a new or existing database. They bootstrap procurement and account/session tables and remove legacy secret storage; existing procurement records are never recreated or reseeded.
- Sessions have a fixed seven-day lifetime. Passwords use salted scrypt; only hashes of opaque session tokens are stored. `SESSION_SECRET` is not needed for these database-backed opaque sessions.
- Set `NODE_ENV=production` for production serving so session cookies are Secure. The API artifact already sets this. Use HTTPS for production.
- Requests must come through the same-origin app proxy. JSON mutations require `X-ProcureFlow-Request: 1`; the shared API client supplies this automatically. No cross-origin CORS access is granted.
- Password recovery, email verification, invitations, general role management, and private datasets are deliberately outside the current account scope.

## Environment configuration

- Configure provider credentials through Replit project environment settings. ProcureFlow does not store provider keys in its database or provide an app-managed key vault.

## Private supplier advice (Phase A)

- Run the separate **Private Python Advice** console workflow: `python -m src.main --service advice --port 8000`. It binds only to loopback; do not add a public artifact route or a `waitForPort` public-port readiness check.
- Configure `PYTHON_BACKEND_TOKEN` in Replit Secrets (at least 32 characters). Express and Python read it at runtime; never use a `VITE_` variable or send it to the browser. `GEMINI_API_KEY` enables optional Gemini advice.
- `POST /api/procurement/requests/:requestId/advice` requires the existing account session and same-origin mutation header. Body: `{}` or `{ "priority": "balanced" | "lowest_cost" | "fastest_delivery" }`; all other fields are rejected.
- Express loads the stored PostgreSQL record, derives subtotal from unit price × quantity, and sends shipping separately to the fixed private endpoint. Advice is transient, MYR-only, and based on illustrative offers. No advice is written to PostgreSQL or SQLite.
- Delivery checks use the existing illustrative scoring basis: ceiling of remaining 24-hour periods to UTC midnight of the stored delivery date. An elapsed deadline is always shown as ineligible. This is not a real fulfillment promise or live route verification.
- The adapter has a 20-second total deadline, bounded responses, redirect refusal, schema/quote consistency checks, and sanitized failures. Gemini failures returned by Python preserve deterministic eligibility and anomalies. A service-level timeout/unavailability is reported explicitly rather than simulated as success.
- Existing approvals, signatures, invoice persistence and OpenAI approval-history recommendations are unchanged. Do not activate SQLite emergency-order mutations.
- Safe no-project-DB checks: `pnpm --filter @workspace/api-server run test:advice`, `pnpm --filter @workspace/procurement-workspace test`, `python -m unittest discover -s tests -p 'test_backend_*.py'`, `pnpm run typecheck`. Python tests use temporary SQLite fixtures and mocked providers.
- The general API/bootstrap tests and `scripts/post-merge.sh` can mutate a database. Do not run them against the project database during no-data-change reviews; this Phase A check does not run migration scripts.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
