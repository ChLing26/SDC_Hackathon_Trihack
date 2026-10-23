---
name: Gemini request retries
description: Retry controls and latency boundaries for private supplier-advice requests.
---

Set an explicit retry-attempt limit on each Gemini generation request, not only on the client. Keep the request timeout and attempt count aligned with the private service's response budget.

**Why:** The SDK may retry transient provider failures by default, and per-request options can override client defaults.

**How to apply:** When changing Gemini calls, preserve the per-call retry bound and test it offline with a mock transport whose client-level retry policy would make a second request if the per-call override were missing.
