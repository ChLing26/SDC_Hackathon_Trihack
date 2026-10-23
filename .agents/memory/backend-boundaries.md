---
name: Imported backend integration boundaries
description: Security and data boundaries to preserve when connecting the separately developed backend.
---

Preserving a backend's Git history is separate from activating it in the running
application. Keep the imported Python services private until an authenticated
integration and data mapping are explicitly reviewed.

**Why:** The separately developed services do not share the application's account
authorization or live data model. Automatically exposing them or replacing the
existing supplier source could bypass access controls or change signed invoice
and procurement behavior.

**How to apply:** Preserve the PostgreSQL application data and immutable signature
evidence. Review authentication, request units, supplier identity, database paths,
and failure behavior before connecting the imported services. Preserve
experimental branch histories through archival references rather than merging
them simply because their commit identities are absent from main.

## Verify backup availability, not just previous reports

Recheck that history backup archives actually exist and can be read before any
operation that relies on them. A past successful checksum report is not proof
that its container-local files are still available.

**Why:** A later work session retained the integrated Git history but could not
find the previously reported backup/report directories outside the checkout.
That observation does not establish whether copies exist elsewhere or why the
directories are absent.

**How to apply:** Report unavailable archives explicitly rather than silently
skipping verification or claiming preservation. Before destructive Git recovery
or a history migration, verify an independently retained private backup copy.
Do not confuse tracked legacy source/database backups with all-reference Git
bundles or assume their storage has the same lifetime.

## No-data-change review testing

Use a disposable separate PostgreSQL cluster for database-backed review tests
when changes to the existing application database are forbidden.

**Why:** The user expressly prohibited existing PostgreSQL changes during
integration review. The existing API/bootstrap suites write accounts, records
and schemas even though they clean up fixtures afterwards; cleanup does not make
those runs read-only.

**How to apply:** Run the isolated test harness, or report database-dependent
tests as blocked if isolation is unavailable. Do not use the live preview for a
browser journey that creates approvals/signatures while this restriction is in
effect. Propose an isolated browser environment instead of silently relaxing the
data boundary.
