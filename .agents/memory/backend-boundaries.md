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
