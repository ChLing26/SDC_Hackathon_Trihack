import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, describe, it } from "node:test";

import { checkServedAssets } from "./check-vite-asset-serving.mjs";

const tempRoot = mkdtempSync(join(tmpdir(), "vite-asset-serving-tests-"));
after(() => rmSync(tempRoot, { recursive: true, force: true }));

function makeBuiltApp() {
  const outputDirectory = join(tempRoot, "dist");
  mkdirSync(join(outputDirectory, "assets", "features"), { recursive: true });
  const indexPath = join(outputDirectory, "index.html");
  writeFileSync(
    indexPath,
    `<script type="module" src="/__mockup/assets/app.js"></script>
<link rel="stylesheet" href="/__mockup/assets/app.css">
<link rel="icon" href="/__mockup/assets/icon.svg">`,
  );
  writeFileSync(
    join(outputDirectory, "assets", "app.js"),
    'import("./features/lazy-feature.js");',
  );
  writeFileSync(
    join(outputDirectory, "assets", "features", "lazy-feature.js"),
    "export {};",
  );

  return {
    name: "Canvas",
    indexPath: indexPath.slice(tempRoot.length + 1),
    basePath: "/__mockup",
  };
}

function response(body, contentType, status = 200, url = "") {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

describe("served Vite asset paths", () => {
  it("loads the configured base and nested routes, then verifies JS, CSS, and media types", async () => {
    const app = makeBuiltApp();
    const requests = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      requests.push(url.pathname);
      if (
        url.pathname === "/__mockup/" ||
        url.pathname === "/__mockup/__asset-check__/nested/"
      ) {
        return response("<div id='root'></div>", "text/html", 200, url.href);
      }
      if (url.pathname.endsWith(".js"))
        return response("export {}", "text/javascript");
      if (url.pathname.endsWith(".css")) return response("body {}", "text/css");
      if (url.pathname.endsWith(".svg"))
        return response("<svg/>", "image/svg+xml");
      return response("missing", "text/html", 404);
    };

    await assert.doesNotReject(() =>
      checkServedAssets(app, {
        cwd: tempRoot,
        baseUrl: "http://preview.local",
        basePath: app.basePath,
        fetchImpl,
        log: () => {},
      }),
    );

    assert.deepEqual(requests, [
      "/__mockup/",
      "/__mockup/__asset-check__/nested/",
      "/__mockup/assets/app.js",
      "/__mockup/assets/app.css",
      "/__mockup/assets/icon.svg",
      "/__mockup/assets/features/lazy-feature.js",
    ]);
  });

  it("rejects app-shell HTML returned instead of a lazy-loaded JavaScript chunk", async () => {
    const app = makeBuiltApp();
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/__mockup/assets/features/lazy-feature.js") {
        return response("<html>app shell</html>", "text/html");
      }
      if (url.pathname.endsWith(".js"))
        return response("export {}", "text/javascript");
      if (url.pathname.endsWith(".css")) return response("body {}", "text/css");
      if (url.pathname.endsWith(".svg"))
        return response("<svg/>", "image/svg+xml");
      return response("<div id='root'></div>", "text/html", 200, url.href);
    };

    await assert.rejects(
      checkServedAssets(app, {
        cwd: tempRoot,
        baseUrl: "http://preview.local",
        basePath: app.basePath,
        fetchImpl,
        log: () => {},
      }),
      /Canvas lazy-loaded JavaScript chunk request .* returned content type "text\/html"/,
    );
  });

  it("fails when a lazy-loaded JavaScript chunk request returns an error", async () => {
    const app = makeBuiltApp();
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/__mockup/assets/features/lazy-feature.js") {
        return response("missing", "text/plain", 404);
      }
      if (url.pathname.endsWith(".js"))
        return response("export {}", "text/javascript");
      if (url.pathname.endsWith(".css")) return response("body {}", "text/css");
      if (url.pathname.endsWith(".svg"))
        return response("<svg/>", "image/svg+xml");
      return response("<div id='root'></div>", "text/html", 200, url.href);
    };

    await assert.rejects(
      checkServedAssets(app, {
        cwd: tempRoot,
        baseUrl: "http://preview.local",
        basePath: app.basePath,
        fetchImpl,
        log: () => {},
      }),
      /Canvas lazy-loaded JavaScript chunk request .* returned HTTP 404/,
    );
  });

  it("rejects app-shell HTML returned instead of an image", async () => {
    const app = makeBuiltApp();
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith(".svg")) {
        return response("<html>app shell</html>", "text/html");
      }
      if (url.pathname.endsWith(".js"))
        return response("export {}", "text/javascript");
      if (url.pathname.endsWith(".css")) return response("body {}", "text/css");
      return response("<div id='root'></div>", "text/html", 200, url.href);
    };

    await assert.rejects(
      checkServedAssets(app, {
        cwd: tempRoot,
        baseUrl: "http://preview.local",
        basePath: app.basePath,
        fetchImpl,
        log: () => {},
      }),
      /Canvas media request .* returned content type "text\/html"/,
    );
  });

  it("requests local srcset and imagesrcset candidates beneath the configured preview path", async () => {
    const app = makeBuiltApp();
    writeFileSync(
      join(tempRoot, app.indexPath),
      `<script type="module" src="/__mockup/assets/app.js"></script>
<link rel="stylesheet" href="/__mockup/assets/app.css">
<link rel="icon" href="/__mockup/assets/icon.svg">
<img srcset="/__mockup/assets/small.webp 1x, /__mockup/assets/large.webp 2x">
<link rel="preload" as="image" imagesrcset="/__mockup/assets/preload-small.avif 1x, /__mockup/assets/preload-large.avif 2x">`,
    );
    const requests = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      requests.push(url.pathname);
      if (
        url.pathname === "/__mockup/" ||
        url.pathname === "/__mockup/__asset-check__/nested/"
      ) {
        return response("<div id='root'></div>", "text/html", 200, url.href);
      }
      if (url.pathname.endsWith(".js"))
        return response("export {}", "text/javascript");
      if (url.pathname.endsWith(".css")) return response("body {}", "text/css");
      if (url.pathname.endsWith(".svg"))
        return response("<svg/>", "image/svg+xml");
      if (url.pathname.endsWith(".webp"))
        return response("image", "image/webp");
      if (url.pathname.endsWith(".avif"))
        return response("image", "image/avif");
      return response("missing", "text/html", 404);
    };

    await assert.doesNotReject(() =>
      checkServedAssets(app, {
        cwd: tempRoot,
        baseUrl: "http://preview.local",
        basePath: app.basePath,
        fetchImpl,
        log: () => {},
      }),
    );

    assert.deepEqual(requests.slice(5, 9), [
      "/__mockup/assets/small.webp",
      "/__mockup/assets/large.webp",
      "/__mockup/assets/preload-small.avif",
      "/__mockup/assets/preload-large.avif",
    ]);
  });

  it("rejects app-shell HTML returned for a responsive image candidate", async () => {
    const app = makeBuiltApp();
    writeFileSync(
      join(tempRoot, app.indexPath),
      `<script type="module" src="/__mockup/assets/app.js"></script>
<link rel="stylesheet" href="/__mockup/assets/app.css">
<link rel="icon" href="/__mockup/assets/icon.svg">
<img srcset="/__mockup/assets/small.webp 1x, /__mockup/assets/missing.webp 2x">`,
    );
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/__mockup/assets/missing.webp") {
        return response("<html>app shell</html>", "text/html");
      }
      if (url.pathname.endsWith(".js"))
        return response("export {}", "text/javascript");
      if (url.pathname.endsWith(".css")) return response("body {}", "text/css");
      if (url.pathname.endsWith(".svg"))
        return response("<svg/>", "image/svg+xml");
      if (url.pathname.endsWith(".webp"))
        return response("image", "image/webp");
      return response("<div id='root'></div>", "text/html", 200, url.href);
    };

    await assert.rejects(
      checkServedAssets(app, {
        cwd: tempRoot,
        baseUrl: "http://preview.local",
        basePath: app.basePath,
        fetchImpl,
        log: () => {},
      }),
      /Canvas responsive image request .*missing\.webp returned content type "text\/html"/,
    );
  });

  it("fails when the server does not return the app shell for a nested route", async () => {
    const app = makeBuiltApp();
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname === "/__mockup/__asset-check__/nested/") {
        return response("not found", "text/plain", 404);
      }
      return response("<div id='root'></div>", "text/html", 200, url.href);
    };

    await assert.rejects(
      checkServedAssets(app, {
        cwd: tempRoot,
        baseUrl: "http://preview.local",
        basePath: app.basePath,
        fetchImpl,
        log: () => {},
      }),
      /Canvas page request .*__asset-check__\/nested\/ returned HTTP 404/,
    );
  });

  it("rejects an asset URL outside the configured preview path", async () => {
    const app = makeBuiltApp();
    const htmlPath = join(tempRoot, app.indexPath);
    writeFileSync(
      htmlPath,
      `<script type="module" src="/assets/app.js"></script>
<link rel="stylesheet" href="/assets/app.css">
<link rel="icon" href="/assets/icon.svg">`,
    );
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith(".js"))
        return response("export {}", "text/javascript");
      if (url.pathname.endsWith(".css")) return response("body {}", "text/css");
      if (url.pathname.endsWith(".svg"))
        return response("<svg/>", "image/svg+xml");
      return response("<div id='root'></div>", "text/html", 200, url.href);
    };

    await assert.rejects(
      checkServedAssets(app, {
        cwd: tempRoot,
        baseUrl: "http://preview.local",
        basePath: app.basePath,
        fetchImpl,
        log: () => {},
      }),
      /does not resolve beneath configured preview path "\/__mockup\/"/,
    );
  });
});
