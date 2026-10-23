# Express / Python procurement data contract

## Status and authority

This document specifies the boundary for a **future, separately approved**
adapter. No Python route is connected to React or Express by this change.
PostgreSQL remains the real application's source of truth for requests,
decisions, invoices, accounts and immutable signature evidence. SQLite remains
historical/private evaluation data. A service credential authenticates a
service, not a buyer, supplier or purchasing manager.

The bug-fix phase changes bounded numeric validation, quote-warning identity,
and approval commit ordering only. It does not change scoring weights, verified
roles, supplier feeds, currencies, deadline semantics or approval budget policy.
Existing invoices/hashes are never recalculated or migrated.

## Identifiers and quote identity

| Identifier | Meaning / contract |
| --- | --- |
| Express request ID | PostgreSQL procurement-record identity |
| Express offer ID | Request-scoped offer identity, not a SQLite supplier ID |
| Python `quote_id` | Unique within the advice request; 1–128 ASCII letters/digits/`_.:-`, beginning with a letter/digit |
| SQLite `supplier_id` / `item_id` / `business_id` | Catalogue identities requiring an explicit mapping |
| Account/session ID | Authenticated Express identity; never supplied by the browser as authority |
| Supplier/buyer/manager name | Display or self-entered label, not identity verification |

A future adapter must supply stable, versioned quote IDs. It must preserve the
ID on the corresponding result, warning and AI context and bind it to its
original offer/quote version. Duplicate IDs are rejected with 422 before AI.
Two quotes may have the same supplier name without sharing warnings.

For backward compatibility only, omitted Python IDs are generated uniquely when
each supplier model is constructed. These generated IDs are stable within that
request/response, **not** across requests or proof of an external supplier.
All four anomaly types carry `quote_id`; `supplier` remains a display label.
An input `score` is not trusted or recomputed by the advice API.

## Money, quantities and currency

Defensive numeric ceilings:

- Price, shipping, reported total, calculated total and budget: nonnegative,
  finite and at most **1,000,000,000,000** currency units.
- Quantity: finite, greater than zero, at most **1,000,000,000**.
- Express quantity remains integer-only and its budget remains strictly positive.
  Python advice allows a zero budget; emergency/catalogue quantities may be
  fractional. An adapter must reject incompatible UOM/fractional quantities,
  not silently truncate them.
- These technical ceilings are not budget approval or spending authorization.

Python uses `Decimal(str(value))` for multiplication/addition and rejects an
out-of-range result before JSON conversion. The combined total is rounded once
to two decimals, `ROUND_HALF_UP`. Invalid stored catalogue amounts fail explicitly;
emergency selection returns 409 before inserting any purchase.

The Express request schema rejects out-of-range budgets/quantities before any
record insertion. With its existing bounded vendor factors and cent-rounded
unit prices, the supported range keeps every intermediate well below floating
overflow and integer-cent safety limits. Existing scoring and quote generation
are otherwise unchanged.

| Field | Interpretation |
| --- | --- |
| Express `unitPrice`, SQLite `unit_price` | Per agreed item/pack UOM |
| Express `quantity` | Count of that same UOM |
| Python advice `product_price_rm` | **Line subtotal**, not unit price |
| Express `shippingFee`, SQLite `delivery_fee`, advice `shipping_rm` | One delivery fee per quote |
| Advice `total_cost_rm` | Reported optional total, checked for anomaly; never authoritative |
| Returned `total_cost_rm` / Express `totalPrice` | Recalculated line subtotal plus one fee |

Adapter equation:

```text
subtotal_rm = unit_price_rm * quantity
total_rm    = round_half_up(subtotal_rm + shipping_rm, 2)
```

Do not multiply an already extended subtotal by quantity again. Preserve original
precision until the agreed rounding boundary. Express currently rounds generated
unit prices first; a future real-quote adapter must use a documented cent/UOM
policy and must not silently change stored invoice totals.

RM-suffixed Python fields mean **MYR**. Express accepts a three-character currency
label but does not validate it against a supported-ISO list. The initial adapter
must reject non-MYR inputs unless a separately approved, versioned FX contract is
implemented. Never relabel USD/EUR/etc. as RM or infer a conversion rate.
Neither side adds a tax model through this change.

## Scoring and rank

The existing Express policy gives **25% weight each** to price, speed, proximity
and reliability:

```text
priceScore       = round(clamp((1 - total / budget) * 200 + 50, 0, 100), 2)
availableDays    = max(0, ceil((requiredDate - now) / 86_400_000))
speedScore       = max(0, 100 - deliveryDays * 8
                           - max(0, deliveryDays - availableDays) * 20)
proximityScore   = round(max(0, 100 - distanceKm / 5), 2)
reliabilityScore = reliabilityOutOfFive * 20
overallScore     = round((priceScore + speedScore + proximityScore
                         + reliabilityScore) / 4, 2)
```

Express sorts overall score descending. Its current vendor ratings and quotes
are illustrative, not verified supplier performance.

Python catalogue/emergency rank remains **total-cost ascending**. Emergency ties
use delivery time then distance; catalogue ordering for equal rounded totals
retains retrieval order. Python does not calculate the four-component average,
and advice priority is an AI instruction, not a deterministic scoring weight.

A future adapter must either implement the same versioned score policy with
verified inputs or expose a separately labelled cost rank. It must not invent
reliability, substitute a rank for a score, or trust client-supplied `score`.
No scoring-policy unification is activated by this bug fix.

## Coordinates, route status and units

- Express currently has free-text `deliveryLocation` and illustrative vendor
  distances, not authoritative stored geocoded locations.
- SQLite stores named `latitude` and `longitude`; geopy returns `(lat, lon)`.
- `distance.get_distance()` consumes `(longitude, latitude)` pairs. Catalogue
  `calculate_road_distance(lat1, lon1, lat2, lon2)` reverses them for OSRM.
- The adapter must use named fields and validate longitude `[-180, 180]`,
  latitude `[-90, 90]`, and finite values at every boundary. Do not infer a tuple
  convention from array position without mapping it explicitly.
- OSRM meters become km; seconds become driving minutes. Driving time is not
  fulfillment/delivery days. The current helpers round minute outputs to
  different precision; preserve raw provenance and agree one precision policy.
- Failed/unknown routes are not eligible. Current data has no quote/route expiry
  contract; add timestamps/validity before real procurement.

## Deadlines and budget enforcement

Express stores `requiredDeliveryDate` and generates illustrative `deliveryDays`.
Its current date coercion/scoring behavior is preserved. Python advice compares
relative `delivery_days` with `max_delivery_days`; SQLite emergency selection
compares clock text with `required_delivery_time`, without a calendar date.

The future adapter must agree an explicit business timezone and deadline instant,
then derive relative days from that same instant and evaluation timestamp.
Do not round a deadline up silently, treat a clock as a date, or use OSRM minutes
as delivery days. Date-only input cutoff policy remains an integration blocker.

Current enforcement must not be overstated:

- Advice reports `within_budget` and delivery flags and gives the AI an eligible
  subset, but text advice is not authorization and must not override deterministic
  checks.
- Emergency selection has **no budget input** or full calendar deadline.
- Express approval currently validates pending state and selected-offer ownership.
  Synthetic offers are normally below budget, but this is not an explicit
  real-quote over-budget approval policy.

Before a real adapter can be activated, approve and implement deterministic
eligibility: `validated_total <= budget`, validated ETA no later than the agreed
deadline, valid/fresh route/quote, correct currency/UOM and supported numeric range.
An over-budget override would require explicit product/authorization design;
no such override or new policy is introduced here.

## Approval and error semantics

Approval locks the PostgreSQL row, validates pending state, builds the invoice
and validates its response inside the transaction. It returns **no HTTP success
until the transaction promise resolves after COMMIT**. Deferred commit failure
returns generic 503; the order remains pending and a later retry can succeed.
Concurrent/repeated decisions cannot replace an existing approved invoice.

| Condition | Behavior |
| --- | --- |
| Python invalid amount, overflow, duplicate quote ID | 422 at HTTP request validation |
| Direct Python invalid amount/calculation | `ValueError`, no provider request |
| Invalid stored emergency quote | 409, no purchase inserted |
| Express request numeric ceiling violation | 400, no record created |
| Missing request / already reviewed decision | Existing 404 / 400 behavior |
| Approval COMMIT fails | 503 before any success headers; transaction rolls back |
| Approval succeeds | 200 only after committed persistence |

Signature recording remains separate and immutable. This is an internal invoice
record/PDF, not tax-authority validation, certified signatures or verified
supplier identity. Browser download and live Gemini remain untested unless
separately authorized and actually exercised.

## Bug-fix verification

Starting review commit: `d2c6208`.

| Verification | Actual final result |
| --- | --- |
| New Python regression file | 11 tests passed |
| Full Python backend discovery | 38 passed, 0 failures/errors/skips |
| Existing anomaly and recommendation scripts | Both passed |
| Python dependency consistency | No broken requirements found |
| OpenAPI generation and full TypeScript checks | Passed |
| Existing frontend suite | 15 passed, 0 failed/skipped |
| Express suite on disposable PostgreSQL | 33 passed, 0 failed/skipped |
| New Express regressions within that suite | 6 subtests plus their parent passed |
| Isolated bootstrap/approval/invoice/restart suite | Passed |

Commit-order regressions use real deferred PostgreSQL constraint triggers: one
raises during COMMIT and verifies rollback/503 plus successful retry; another
waits on an advisory lock at COMMIT and proves no success headers arrive until
release. Concurrent decisions also prove one approval cannot replace another.
All trigger DDL and fixture writes occur only on the disposable cluster. The
regression suite requires the isolated runner's explicit marker and validates
the private temporary Unix-socket target before executing.

No live Gemini request, credential setup, permanent writable SQLite copy,
frontend-to-Python connection, project PostgreSQL migration or backup operation
is part of this phase. Browser PDF download was not exercised. The inherited
archival Python syntax error and upstream TestClient deprecation warning remain
documented, not disguised as repaired.
