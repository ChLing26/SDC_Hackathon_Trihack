---
name: Workspace package installs
description: pnpm workspace package-install constraints and safe handling of targeted transitive updates.
---

When a root-level script needs a package, it must not rely on a package that only happens to exist as a transitive dependency. The package-install helper rejected adding a dependency at the pnpm workspace root, and passing the workspace-root flag as a package token was rejected too.

**Why:** Root scripts resolve dependencies from the root package context, while pnpm's helper guards against accidentally adding dependencies to a workspace root.

**How to apply:** Prefer a self-contained implementation when practical. If a root dependency is necessary, use a supported root-workspace installation path and verify that `package.json` and the lockfile declare it directly.

When a single transitive dependency needs a security patch, avoid a recursive, depth-infinite workspace update if it would also refresh unrelated packages. Prefer a narrowly scoped override only after checking the parent dependency's compatible range, then verify the lockfile diff and a frozen install.

**Why:** A recursive lockfile-only update changed unrelated Vite/tsx resolutions while leaving the requested transitive package pinned.

**How to apply:** Target the direct parent first where that yields a minimal compatible update. If pnpm cannot select the transitive patch narrowly, scope an override to the parent-child edge and confirm no unrelated package resolutions changed.
