---
name: Temporary Vite preview servers
description: Process cleanup for short-lived artifact preview checks started through pnpm.
---

When a script starts a temporary Vite preview through `pnpm`, terminate the detached process group instead of signaling only the direct pnpm process.

**Why:** The package-manager wrapper can leave its Vite child alive after the check finishes, keeping inherited output handles open and preventing the command from exiting.

**How to apply:** For short-lived preview probes, start the command in a detached process group and signal the group on cleanup; escalate to `SIGKILL` after a short timeout.
