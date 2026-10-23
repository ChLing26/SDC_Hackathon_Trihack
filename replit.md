# ProcureFlow

Shared procurement workspace for SME buying teams, with persistent email-and-password accounts.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run migrate` — repeatable procurement and account/session schema setup plus legacy secret-table cleanup; also runs after task merges
- `pnpm --filter @workspace/api-server test` — account/session API checks plus isolated empty-schema bootstrap, procurement workflow, and process-restart checks (cleans up its own data)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

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

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
