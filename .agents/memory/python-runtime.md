---
name: Replit Python package installation
description: Why Python installs may fail despite an installed interpreter, and the project-local installation boundary.
---

Use a full Replit Python tooling module for backend development and keep installed
packages in the project-local Python library location, not the immutable Nix
interpreter or a virtual environment.

**Why:** The basic interpreter module lacked pip tooling. With the full module,
the pip executable's Nix wrapper disabled user-site access while Replit's pip
configuration requested a user install. That combination failed even though
running Python directly reported that user-site imports were enabled. A supported
package-helper install succeeded when its development environment explicitly
disabled user mode and targeted the project-local library directory.

**How to apply:** Inspect the wrapper and the active Python module before
retrying installs. Use Replit's package tooling, preserve the Node module, and
keep the target directory aligned with the interpreter's minor version and
workspace root. Recheck that path when forking/moving the project or upgrading
Python. Do not bypass system protections or check installed package trees into
Git. Development package provisioning does not activate a Python production
service or authorize exposing it through the application proxy.
