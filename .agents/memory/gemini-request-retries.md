---
name: Gemini request retries
description: Retry controls and latency boundaries for private supplier-advice requests.
---

Set an explicit retry-attempt limit on each Gemini generation request, not only on the client. Retry limits do not stop SDK automatic continuation: single-shot supplier advice must set `automatic_continuation=False` and reject a response whose finish reason is `CONTINUATION`.

**Why:** SDK retries and continuation are separate causes of additional provider calls. In the installed Gemini SDK, continuation is enabled by default and may follow a continuation token even when HTTP retry attempts are limited.

**How to apply:** When changing Gemini calls, preserve the per-call retry bound and test retries and continuation separately with an offline mock transport.
