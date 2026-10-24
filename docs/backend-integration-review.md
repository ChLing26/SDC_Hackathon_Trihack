# Backend integration review

> Historical review snapshot: commit references, test results, and source paths
> below describe the state at review time. For the current Python directory
> layout and current verification commands, see
> [repository-integration.md](repository-integration.md).

## Scope and change boundary

Reviewed on `integration/backend-review-20261023`, based on local commit
`2d533245a5740004deb620e945dacf9680b969bb`.
`main` remains `ee3d1b654412cdaf9948a1f5dca4f14f08447eb3`.

This review adds documentation and opt-in/isolated test tooling only. No
application route, data model, frontend connection, provider integration, secret,
Git configuration or existing backup is changed. No fetch, merge or push is
performed. No connection to the existing PostgreSQL database is needed for the
tests below. This is an integration review, not a comprehensive security audit.

## Backup status and recoverability

- The original `/home/runner/git-history-backups` and
  `/home/runner/git-integration-reports` directories are absent.
- A scoped search of `/home/runner`, `/tmp`, `/mnt`, and `/var/tmp` through depth
  six found no matching Git bundles, original checksum/reference manifests,
  metadata tarballs or dangling-object packs. Dependency/cache/Git-object trees
  were excluded. This is not proof that no independent copy exists elsewhere.
- Read-only `git ls-remote --heads --tags` succeeded for `origin`, `backend`, and
  `gitsafe-backup`. Origin advertises the unchanged target main; backend advertises
  its original main/master. `gitsafe-backup` advertises the current review commit.
  A reachable current branch is **not** recovery or verification of the original
  pre-integration bundles, manifests, source archive or raw metadata archive.
- All 13 archival branches remain locally available. `git fsck --full --no-reflogs`
  reports no missing/corrupt reachable objects. Both original dangling objects
  remain: tree `ead134590ef4462ece514a5a2f269e7aba6c8934` and blob
  `a443189bb67193e8d1f3763c1a51984f43d341dc`. One additional dangling tree is
  reported; no object was pruned or recovered into the working tree.
- Therefore Git-history content remains available for a *future new backup*,
  but the exact original archive files, their checksums, original untracked
  source contents and raw metadata cannot be reconstructed and authenticated
  from the current refs alone.
- No backup was recreated, replaced, restored, deleted or downloaded. First
  locate any independently retained private/downloaded copies and verify their
  original manifests/checksums. If none are available, obtain approval for a
  distinctly named new backup and independent restore verification. Do not label
  that new backup as the recovered original.

## Environment inventory: presence only

| Variable | Review status | Requirement |
| --- | --- | --- |
| `PYTHON_BACKEND_TOKEN` | Not configured | Server-only, high-entropy service credential, at least 32 characters |
| `GEMINI_API_KEY` | Not configured | Needed for a real Gemini request; never a browser variable |
| `GEMINI_MODEL` | Unset | Defaults to `gemini-flash-latest`; real availability remains unverified |
| `PYTHON_SQLITE_PATH` | Unset | Absolute separate writable file needed for emergency evaluation |
| `DATABASE_URL` | Managed secret exists | Existing Express/PostgreSQL only; not used by this review's tests |
| `SESSION_SECRET` | Secret exists | Existing Express session secret; separate from the Python credential |
| `PIP_TARGET`, `PIP_USER` | Development settings configured | Project-local installation; not service authentication |

Only metadata was inspected. Root `.env` is absent. No secret values were
printed or changed. Provider credentials are configured through the project's
environment settings and never exposed to the browser. The AI client reads configuration at
import, so an eventual configured process must be restarted.

## Secure Express-to-Python design, not yet implemented

1. Browser requests continue through Express's existing session, same-origin
   and input checks. Never expose Python's service credential, URLs, or a
   credential-bearing fetch option in React.
2. Express derives the recording account and permitted action server-side.
   Preserve the shared-workspace policy. Current accounts do not establish
   purchasing-manager authority, and typed supplier names are not independent
   supplier authentication. A bearer token must not introduce that claim.
3. A server-only adapter uses a fixed allowlisted private destination and
   `Authorization: Bearer ...`. Do not forward the browser's cookies or bearer
   headers, accept arbitrary destination URLs, or put credentials in query
   strings. Redact authorization headers and quote/provider payloads from logs.
4. Python already rejects missing configuration (503) and wrong/missing
   credentials (401), using constant-time comparison. No browser CORS or public
   docs endpoint is enabled. The supplied launcher binds loopback only.
5. Loopback is suitable only if the processes actually share a trusted runtime.
   Separate services/hosts require a reviewed private networking and TLS/mTLS
   arrangement. CORS is not a security boundary, and launching `uvicorn` directly
   can bypass the launcher's loopback choice. Do not publicly route Python.
6. Add strict response schemas, finite derived-number checks, request/response
   size limits, concurrency/rate limits, timeout/cancellation budgets and generic
   error mapping. The Gemini client timeout is 15 seconds, not proof of a bounded
   whole-workflow duration under SDK retries.
7. Rotate secrets through a secure operator flow. Current Python accepts one
   token; coordinate process restarts and fail closed during rotation. A shared
   token does not provide per-user authorization, request replay prevention or
   manager identity.
8. Keep PostgreSQL as the sole writer for real orders/invoices. Python advice
   must not create a second approval record or mutate signed evidence. Any
   future cross-service mutation needs idempotency, quote/version binding and a
   defined recovery contract. Do not retry approval mutations blindly.

## Field, coordinate, score and unit mapping

| Meaning | Express / PostgreSQL JSON record | Python / SQLite | Required integration decision |
| --- | --- | --- | --- |
| Product identity | Free-text `itemName` | `stationery.item_id`, `item_name`, `unit`; exact-name recommendation lookup | Explicit stable item mapping; casing/packing units cannot be assumed |
| Buyer identity | Account/session plus self-entered `requesterName` | Integer `business_id` | Explicit reviewed mapping; names and row numbers are not identity |
| Supplier identity | Illustrative vendor name; offer ID derived from request ID | Integer `supplier_id`; advice API accepts names, no supplier ID | Stable supplier/quote IDs; never equate an offer ID or name with supplier ID |
| Quantity | Positive integer, no explicit packing UOM | Positive float for emergency/catalogue, plus item UOM | Agree units and rounding; do not truncate fractional quantities silently |
| Price | `unitPrice` | SQLite `unit_price`; advice `product_price_rm` | Advice expects **line subtotal**, so map `unitPrice * quantity`, not unit price |
| Shipping / total | `shippingFee`, `totalPrice` | `delivery_fee`, `shipping_rm`, `total_cost_rm` | Add fee once; define monetary rounding/minor-unit arithmetic |
| Currency / budget | Three-character currency and `budgetAmount`; currency is not validated against an ISO allowlist | Advice fields are RM/MYR; emergency endpoint has no budget field | Restrict to approved MYR mapping or implement explicit FX; do not relabel foreign amounts |
| Required delivery | Absolute `requiredDeliveryDate` | Advice `max_delivery_days`; emergency `required_delivery_time` clock | Agree timezone/date anchor and fractional-day conversion |
| Quote delivery | Illustrative integer `deliveryDays` | SQLite `delivery_time` text; current snapshot values are `HH:MM` | Clock is not days or a calendar ETA; catalogue seeding computes a date but does not store it |
| Location | `deliveryLocation` string; illustrative fixed vendor distances | Named latitude/longitude columns; geocoder returns `(latitude, longitude)` | Resolve explicit consented coordinates; app text currently has no authoritative coordinate mapping |
| Route input | No real route request in current offer generator | OSRM helper takes `(longitude, latitude)`; catalogue wrapper takes lat/lon arguments and reverses them for OSRM | Use named validated coordinate fields; test tuple reversal at every boundary |
| Route output | `distanceKm`; no authoritative routing provenance | OSRM meters become km, seconds become driving minutes | Driving minutes are not fulfillment days; agree precision (helpers use differing minute rounding) and freshness |
| Scoring | 0–100 price/speed/proximity/reliability components, averaged equally into `overallScore`; rank descending | Catalogue rank is total-cost ascending; optional advice `score` is input, not a computed authoritative score | Agree one versioned scoring policy; do not substitute cost rank for average score |
| Reliability | Illustrative 1–5 vendor value multiplied by 20 | No equivalent verified reliability field | Do not invent reliability or silently omit a score component |
| Approval / invoice | Transactional PostgreSQL approval and immutable signature evidence | Separate SQLite emergency decision; no equivalent signed invoice generation | Keep existing order/invoice source of truth; no automatic dual write |

The Express vendor list, prices, distances and ratings are illustrative. Python's
synthetic catalogue is not a live supplier-feed upgrade. Add data source, quote
expiry, route timestamp, units, and scoring-version provenance before relying on
either source for a real purchase.

## Remaining risks and blockers

The approved bug-fix phase addresses numeric overflow, name-based warning
association and approval response-before-COMMIT ordering. See
[express-python-data-contract.md](express-python-data-contract.md) for the
implemented boundaries and the still-unimplemented adapter contract. The original
diagnostics/test table below records the **pre-fix review**, not current failures.

### Must resolve before activating an adapter

- Original history backups are unavailable/unverified, even though local Git
  objects and current remote heads remain accessible.
- Real service credentials and any required private deployment topology are
  unconfigured. There is no Express adapter or per-action authorization contract.
- Item/supplier/buyer identifiers, quantities/UOM, currency, prices, dates,
  coordinates and scoring do not share a proven contract.
- Emergency purchasing filters time-of-day/distance and selects lowest total
  cost. It does not enforce Express's budget or full calendar deadline, and has
  no verified manager-role boundary. Do not use it for live approval.
- **Resolved by bounded decimal validation:** finite numeric inputs could overflow when added/multiplied. An offline
  review probe with `product_price_rm=shipping_rm=1e308` produced a non-finite
  calculated total: expected finite `True`, actual `False`. Such a result is not
  safe for JSON or financial decisions. Add bounded arithmetic validation before
  activation; the approved fix now rejects these inputs and unsafe totals.
- **Resolved by unique quote IDs:** advice warnings were associated by supplier **name**. A probe with two equal
  names, only one with a mismatched total, produced warning counts `[1, 1]`
  instead of `[1, 0]`. Results/warnings now use quote IDs and reject duplicate IDs.
- **Resolved by post-commit responses:** Express approval sent its HTTP response inside the transaction callback,
  before commit completes. Row locks/pending-state checks are present, but a
  commit failure could follow a premature success response. Existing signature
  tests explicitly waited for the approval lock. New isolated regressions use
  real deferred PostgreSQL triggers to fail or block COMMIT, proving rollback
  and absence of premature success.
- Signed invoice fields/evidence must not change following re-ranking or quote
  refresh. Invoices remain internal records, not tax-authority-validated
  e-invoices or certificate-backed signatures.

### Provider, operational and test limitations

- No real Gemini request was made. The mutable model alias, permission, quota,
  billing and recommendation quality remain unverified.
- AI output is free text. Untrusted supplier names/quotes can contain prompt
  injection. Validate decisions deterministically; do not let AI authorize,
  invent prices/reliability or override budget/delivery/anomaly rules. Review
  provider data handling before sending real business details.
- Route/quote freshness and external API availability are not guaranteed.
  Catalogue routing and standalone routing are separate implementations;
  standalone coordinate validation is not proof that both paths are equivalent.
  No live OSRM/geocoding call was repeated during this review.
- The table-name-only SQLite catalogue check is not a full schema/version/type
  verification. File paths remain operator-controlled, not browser inputs.
- Dependency pins cover direct packages only, not a complete transitive lock.
  Project-local packages are excluded from Node deployment; production Python
  provisioning and durable runtime storage remain undesigned.
- The preserved archival AI backup is intentionally still invalid Python.
  Starlette TestClient emits an httpx deprecation warning. Neither is evidence
  of an active request failure.
- Browser PDF download was not run. The exporter rasterizes HTML; successful
  PDF text extraction cannot be required as if it produced searchable text.
  Font/canvas failure, pagination, evidence clipping and actual download bytes
  still require isolated browser verification.

## Writable SQLite evaluation plan — not executed

For current automated tests, continue using synthetic temporary fixtures. Do not
create a permanent copy during this review.

After separate approval for historical-data evaluation:

1. Choose a new absolute destination outside tracked snapshots/backups, with a
   private directory (0700) and file (0600). Refuse an existing destination;
   reject symlink/hardlink aliases and any path under the backup directory.
2. Open the historical source read-only. Use SQLite's consistent backup API into
   the new evaluation file, not a raw copy of a potentially active WAL database.
   This evaluation copy is not a recovered Git-history backup.
3. Check source hashes before/after, destination integrity, foreign keys, required
   columns/types/schema version, quote units, coordinate ranges and time formats.
   Existing sample emergency decisions must not be mistaken for new live orders.
4. Set `PYTHON_SQLITE_PATH` only for the private evaluation process. Never set
   `DATABASE_URL` to SQLite, run seed/update scripts on tracked files, or migrate
   the sample catalogue into PostgreSQL.
5. Define expiry, retention and recovery for the evaluation data before any
   persistent service use; an ignored local directory is not a production store.

## Test execution in this review

| Command/check | Actual result |
| --- | --- |
| `python -m unittest discover -s tests -p 'test_backend_*.py' -v` | 27 passed; 0 failures/errors/skips |
| `python test_anomalies.py` | Passed |
| `python test_recommedation.py` | Passed on isolated synthetic fixture |
| `python -m pip check` | No broken requirements found |
| `pnpm run typecheck` | Passed for libraries and all workspace leaves |
| `pnpm --filter @workspace/procurement-workspace test` | 15 passed, 0 failed/skipped |
| `python tests/run_isolated_application_tests.py` | 26 API/signature/security tests passed; bootstrap suite passed; disposable PostgreSQL stopped |
| SQLite read-only checks | Integrity `ok`, 0 FK issues, 0 invalid/null successful-route distance rows |
| Git integrity/remote checks | No reachable corruption; all three configured remotes accessible read-only |
| New overflow / duplicate-name diagnostic probes | **Two unmet expectations**, reproduced above; not fixed or counted as passing regression tests |
| Browser approval → signatures → PDF download | **Not run**; proposed below |
| Live Gemini | **Not run / blocked**, not passed |

The API suite exercises actual approval routes and both signature orders,
concurrent signature requests, duplicate rejection and failed-write recovery.
The bootstrap suite exercises signup, request creation, approval/invoice,
restart persistence and logout, entirely on the disposable cluster. None of
these is a browser PDF-download test. The runner never uses the project database
URL; its cluster has no TCP listener and only a private Unix socket.

## Proposed complete browser flow and additional regressions

Do not run against the current shared workspace while PostgreSQL changes are
forbidden. A future test needs an isolated application instance and disposable
PostgreSQL, without overriding the user's running workflows or data.

1. Register a uniquely named synthetic account. Create a MYR request with known
   quantity, shipping, deadline and generated offer. Verify subtotal, totals and
   displayed ranking; reject invalid/foreign-currency adapter inputs explicitly.
2. Approve once through the actual UI; verify exactly one invoice, correct
   selected offer/amounts, and reload persistence. Reject repeat/concurrent
   decisions and return no success until database commit has completed.
3. Add buyer/account and supplier-recorded signatures with consent, checking both
   signing orders. Verify duplicate rejection and immutable content/evidence
   after reload. Do not describe typed supplier identity as verified.
4. Await the actual browser download event after clicking `button-download-pdf`.
   Save its file, check suggested filename, `%PDF-` header, non-empty bytes and
   parseable page count; render the saved PDF pages to verify all amounts,
   Unicode names, both signatures/hashes, and multi-page evidence placement.
   Exclude interactive/no-print controls. Do not rely on DOM visibility alone.
5. Test slow/failing fonts/canvas, PDF error/retry UI, long evidence/pagination,
   and that signing disables navigation/print/download until evidence is saved.
   Printing a page or seeing the button is not a successful PDF download.
6. Confirm logout/anonymous access denial and unchanged signed records following
   reload/retry. Tear down only the isolated test instance and its fixtures.

Add regressions for the two failed diagnostics above, coordinate reversal, UOM
and fractional quantity, MYR-only boundaries, clock-vs-date deadlines, quote
expiry/version binding, invalid/stale routes, schema mismatch, budget failure,
approval idempotency/commit failure, and signed-invoice immutability on re-ranking.

## Safe opt-in live Gemini probe

`tests/gemini_live_probe.py` uses the active `ai_advisor.get_smart_advice` function
with one synthetic quote and no private buyer/supplier details. It makes no
request unless explicitly opted in. Configure a real key securely, confirm an
approved supported model and budget/quota, and obtain authorization for the live
call before running:

```sh
RUN_LIVE_GEMINI_TEST=1 python tests/gemini_live_probe.py
```

Exit 77 means blocked/not run, exit 1 means failed, and exit 0 requires an actual
non-empty live response. No key, provider error body or advice text is printed.
It makes one application-level generation call; SDK retries may affect actual
request count/cost. A pass proves provider connectivity only, not procurement
correctness, safe handling of adversarial data or manager authorization.

## Files inspected or changed

Changed/added by this review:

- `docs/repository-integration.md` — link to findings and safe isolated test command.
- `docs/backend-integration-review.md` — this review, mappings and proposed tests.
- `tests/run_isolated_application_tests.py` — disposable PostgreSQL runner.
- `tests/gemini_live_probe.py` — explicitly opt-in live provider probe.
- `.agents/memory/backend-boundaries.md` — preserve the no-existing-DB-write test rule.

Inspected implementation and tests:

- `api.py`, `ai_advisor.py`, `distance.py`.
- `src/backend_security.py`, `src/backend_database.py`,
  `src/database_w_input.py`, `src/emergency_orders.py`.
- `artifacts/api-server/src/lib/procurement.ts`,
  `artifacts/api-server/src/routes/procurement.ts`,
  `artifacts/api-server/src/app.ts`.
- `lib/db/src/schema/procurement.ts`, `lib/api-zod/src/generated/api.ts`,
  `lib/db/scripts/migrate.mjs`, `lib/db/scripts/test-bootstrap.mjs`.
- `artifacts/api-server/src/test/auth.test.ts`,
  `artifacts/api-server/src/test/invoice-signatures.test.ts`.
- `artifacts/procurement-workspace/src/pages/invoices.tsx`,
  `artifacts/procurement-workspace/src/lib/invoice-pdf.ts`.
- Tracked SQLite snapshot metadata/integrity, Git refs/object integrity and
  remote-advertised refs (read-only). No secret values were inspected.

All implementation and production-facing configuration files remain unchanged
by this review. Stop here; no push, merge or frontend adapter is approved.
