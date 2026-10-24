---
name: JavaScript responsive image paths
description: Scope extensionless image URL detection in JavaScript responsive-image candidate lists.
---

When inferring an extensionless local image from a JavaScript responsive-image list, require a recognizable static asset or media path and reject API paths, even when a route segment resembles an image directory.

**Why:** API endpoints can include image-like path segments, so treating every extensionless candidate in an image list as a local file creates false missing-asset errors.

**How to apply:** Preserve this distinction when broadening JavaScript `srcset` or preload-image candidate scanning.
