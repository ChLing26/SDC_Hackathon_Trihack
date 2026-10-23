# Supplier-advice browser checks

`supplier_advice.py` exercises the real ProcureFlow request-detail page with a
fresh browser context and fixture-only API responses. It does **not** test real
authentication, provider behavior, backend eligibility calculations, or persistence.
Those belong to the existing API/provider/contract tests.

## Safety boundary

- Start only the managed `artifacts/procurement-workspace: web` workflow.
- Do not start the API or Python advice services for this test.
- A mocked `GET /api/auth/me` supplies a synthetic signed-in identity; no account,
  cookie, or database session is created.
- All API traffic is intercepted before navigation. Only fixture identity,
  request list/detail, and advice responses are allowed. Unexpected API calls
  are blocked and fail the checks; none are passed through to a backend.
- Outside-origin requests are blocked and service workers are disabled.
- No database access, migrations, approval actions, invoices, signatures, or
  real provider calls are needed.

This setup may also be run against an existing frontend preview without stopping
its backend: the browser interception is still mandatory and fails closed.
Never remove the interception to make a test pass.

## Run

Use a testing environment with Python Playwright and its Chromium browser
already available (the Replit browser testing environment provides these).
No application runtime dependency is added.

```sh
python tests/browser/supplier_advice.py \
  --url "https://$REPLIT_DEV_DOMAIN" \
  --output generated-artifacts/supplier-advice \
  --executable /repl/tools/bin/chromium
```

`--executable` is optional; omit it when using Playwright's installed Chromium.

The URL is the frontend preview base, without `/requests/...`; a path prefix is
supported. The script uses headless Chromium. For an environment that already
provides a browser, import `run(browser, base_url, output_path)` instead.

The checks include:

- Signed-in detail rendering without an automatic advice call.
- Held response/loading state, disabled button, success and rerun.
- Totals, budget/delivery eligibility, offer-specific warnings, and disclaimers.
- AI `unavailable`, `failed`, and `skipped` while deterministic results remain.
- No-anomaly response, passed deadline, HTTP error and successful manual retry.
- Actual in-app navigation between requests and back without stale advice.
- Mounted detail refetch after fixture changes, then a fresh advice result.
- 375px viewport containment and non-MYR prevention, including a currency
  change discovered by a mounted page's background refetch.

Two freshness checks intentionally wait for the application's real 30-second
polling interval. Allow about two minutes for the complete run.

Outputs are a JSON pass list/network ledger and loading, success, and mobile
screenshots under `generated-artifacts/supplier-advice/`. Generated files are
ignored by Git and deployment. A thrown assertion/nonzero exit is a failure;
the JSON report is also saved on failure to show the last successful check.

## Verified outcome

The fixture-only browser pass on 2026-10-23 passed all 13 checks using Python
Playwright 1.55 and system Chromium. The network ledger contained no unexpected
API requests, and the browser reported no page errors. Loading, success, and
375px screenshots were captured; the narrow-screen screenshot was inspected.
The API and Python advice workflows remained stopped throughout the pass.
