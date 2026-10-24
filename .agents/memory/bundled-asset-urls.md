---
name: Bundled asset URL resolution
description: How to interpret local URLs embedded in built JavaScript and CSS when validating preview base paths.
---

Generated modules can reference chunks with relative URLs such as `./chunk.js`; those URLs inherit the artifact base path when resolved from the emitting module. Do not reject every relative URL as missing a configured prefix.

**Why:** Real production builds include dependency chunks using relative imports, and treating them as root-relative incorrectly fails the build for valid artifacts.

**How to apply:** Resolve relative references against the generated JS or CSS file's public URL, then validate the resolved path and emitted file. Check absolute local URLs directly against the configured preview base path.
