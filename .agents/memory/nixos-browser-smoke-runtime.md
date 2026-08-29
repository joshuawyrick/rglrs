---
name: NixOS browser smoke runtime
description: How release browser checks should choose a Chromium executable in Replit's NixOS environment.
---

Prefer Replit’s managed Chromium executable for release smoke tests when it is available, with Playwright’s bundled browser as a portable fallback.

**Why:** A Playwright-downloaded Chromium can exist but still fail before launch on NixOS because expected shared libraries are not on its runtime path. The managed executable carries a compatible dependency closure.

**How to apply:** Browser-based release scripts should honor an explicit test-browser override first, then Replit’s managed Chromium environment path, and only then let Playwright choose its bundled browser.