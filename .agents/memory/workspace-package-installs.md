---
name: Workspace package installs
description: Limits of the package-install helper for direct dependencies in the pnpm workspace root.
---

When a root-level script needs a package, it must not rely on a package that only happens to exist as a transitive dependency. The package-install helper rejected adding a dependency at the pnpm workspace root, and passing the workspace-root flag as a package token was rejected too.

**Why:** Root scripts resolve dependencies from the root package context, while pnpm's helper guards against accidentally adding dependencies to a workspace root.

**How to apply:** Prefer a self-contained implementation when practical. If a root dependency is necessary, use a supported root-workspace installation path and verify that `package.json` and the lockfile declare it directly.
