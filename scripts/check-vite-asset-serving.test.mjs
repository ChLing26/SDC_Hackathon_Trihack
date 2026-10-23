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
  mkdirSync(join(outputDirectory, "assets"), { recursive: true });
  const indexPath = join(outputDirectory, "index.html");
  writeFileSync(
    indexPath,
    `<script type="module" src="/__mockup/assets/app.js"></script>
<link rel="stylesheet" href="/__mockup/assets/app.css">
<link rel="icon" href="/__mockup/assets/icon.svg">`,
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
      if (url.pathname === "/__mockup/" || url.pathname === "/__mockup/__asset-check__/nested/") {
        return response("<div id='root'></div>", "text/html", 200, url.href);
      }
      if (url.pathname.endsWith(".js")) return response("export {}", "text/javascript");
      if (url.pathname.endsWith(".css")) return response("body {}", "text/css");
      if (url.pathname.endsWith(".svg")) return response("<svg/>", "image/svg+xml");
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
    ]);
  });

  it("rejects app-shell HTML returned instead of an image", async () => {
    const app = makeBuiltApp();
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith(".svg")) {
        return response("<html>app shell</html>", "text/html");
      }
      if (url.pathname.endsWith(".js")) return response("export {}", "text/javascript");
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
      if (url.pathname.endsWith(".js")) return response("export {}", "text/javascript");
      if (url.pathname.endsWith(".css")) return response("body {}", "text/css");
      if (url.pathname.endsWith(".svg")) return response("<svg/>", "image/svg+xml");
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
