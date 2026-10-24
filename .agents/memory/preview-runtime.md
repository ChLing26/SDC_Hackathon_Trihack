---
name: Preview runtime freshness
description: Distinguishing current source from stale transformed modules in the development preview.
---

A running development preview can serve an older transformed router after task changes merge, even while navigation and the source files are current.

**Why:** A Settings 404 was traced to the served router lacking the route that was already present in source; the navigation module was current. Static type checks could not detect this runtime mismatch.

**How to apply:** When navigation recognizes a destination but its content is a 404, compare the served router module with source before changing route definitions. Confirm the running preview serves current code, not just that the source passes checks.

## Private loopback workflow readiness

Private loopback-only services must use console workflows without the public-port readiness gate.

**Why:** The managed port detector did not recognize a healthy loopback-bound Python service and marked it failed, then terminated it. Changing the bind address to satisfy that detector would violate the reviewed private-service boundary.

**How to apply:** Keep private advice services bound to loopback, omit the public-port wait condition, and verify readiness with authenticated local health requests and socket ownership. Never expose the service just to make the workflow's port indicator pass.
