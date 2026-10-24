import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { checkServedAssets } from "./check-vite-asset-serving.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteCli = join(
  repositoryRoot,
  "artifacts",
  "mockup-sandbox",
  "node_modules",
  ".bin",
  "vite",
);
const tempRoot = mkdtempSync(join(tmpdir(), "vite-asset-serving-tests-"));
after(() => rmSync(tempRoot, { recursive: true, force: true }));

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return port;
}

function writeViteWorkerFixture(fixtureRoot) {
  mkdirSync(join(fixtureRoot, "src"), { recursive: true });
  mkdirSync(join(fixtureRoot, "public"), { recursive: true });
  writeFileSync(
    join(fixtureRoot, "index.html"),
    `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="/src/style.css">
    <link rel="icon" href="/icon.svg">
  </head>
  <body>
    <div id="app">Worker fixture</div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`,
  );
  writeFileSync(
    join(fixtureRoot, "src", "main.js"),
    `const worker = new Worker(new URL("./worker.js", import.meta.url), {
  type: "module",
});
worker.postMessage("ping");`,
  );
  writeFileSync(
    join(fixtureRoot, "src", "worker.js"),
    `self.onmessage = ({ data }) => self.postMessage(data);`,
  );
  writeFileSync(join(fixtureRoot, "src", "style.css"), "body { color: navy; }");
  writeFileSync(
    join(fixtureRoot, "public", "icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle cx=".5" cy=".5" r=".5"/></svg>',
  );
  writeFileSync(
    join(fixtureRoot, "vite.config.mjs"),
    `export default {
  base: "/__mockup/",
  build: { outDir: "dist" },
};`,
  );
}

function runVite(args, cwd) {
  const result = spawnSync(viteCli, args, { cwd, encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `Vite ${args[0]} failed:\n${result.stdout}\n${result.stderr}`,
  );
}

function startVitePreview(fixtureRoot, port) {
  const child = spawn(
    viteCli,
    ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: fixtureRoot,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  return { child, output };
}

async function waitForVitePreview(server, pageUrl) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`Vite preview exited early:\n${server.output.join("")}`);
    }
    try {
      const response = await fetch(pageUrl);
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // Vite preview has not started listening yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(
    `Vite preview did not start at ${pageUrl}:\n${server.output.join("")}`,
  );
}

async function stopVitePreview(server) {
  if (server.child.exitCode !== null) return;
  const exited = new Promise((resolveExit) => {
    server.child.once("exit", resolveExit);
  });
  try {
    process.kill(-server.child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  let timeout;
  await Promise.race([
    exited,
    new Promise((resolveTimeout) => {
      timeout = setTimeout(resolveTimeout, 3000);
    }),
  ]);
  clearTimeout(timeout);
  if (server.child.exitCode === null) {
    try {
      process.kill(-server.child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await exited;
  }
}

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
  const result = new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
  if (url) Object.defineProperty(result, "url", { value: url });
  return result;
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

  it("requests local WebAssembly files referenced by emitted bundles beneath the preview path", async () => {
    const app = makeBuiltApp();
    writeFileSync(
      join(tempRoot, "dist", "assets", "app.js"),
      `import("./features/lazy-feature.js");
new URL("./feature.wasm", import.meta.url);`,
    );
    writeFileSync(
      join(tempRoot, "dist", "assets", "features", "lazy-feature.js"),
      `new URL("./nested-feature.wasm?init", import.meta.url);`,
    );
    const requests = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      requests.push(url.pathname + url.search);
      if (
        url.pathname === "/__mockup/" ||
        url.pathname === "/__mockup/__asset-check__/nested/"
      ) {
        return response("<div id='root'></div>", "text/html", 200, url.href);
      }
      if (url.pathname.endsWith(".wasm")) {
        return response("wasm", "application/wasm; charset=binary");
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

    assert.ok(requests.includes("/__mockup/assets/feature.wasm"));
    assert.ok(
      requests.includes("/__mockup/assets/features/nested-feature.wasm?init"),
    );
  });

  it("requests emitted WebAssembly files matched by runtime template and concatenation URLs", async () => {
    const app = makeBuiltApp();
    writeFileSync(
      join(tempRoot, "dist", "assets", "app.js"),
      `const variant = getVariant();
new URL(\`./features/feature-\${variant}.wasm?init\`, import.meta.url);
new URL("./features/" + featureName + "-worker.wasm", import.meta.url);
new URL(\`/__mockup/assets/features/root-\${variant}.wasm\`, import.meta.url);
const label = \`./features/not-a-real-\${variant}.wasm\`;
new URL(\`https://cdn.example/\${variant}.wasm\`, import.meta.url);`,
    );
    writeFileSync(
      join(tempRoot, "dist", "assets", "features", "feature-alpha.wasm"),
      "wasm",
    );
    writeFileSync(
      join(tempRoot, "dist", "assets", "features", "feature-beta-worker.wasm"),
      "wasm",
    );
    writeFileSync(
      join(tempRoot, "dist", "assets", "features", "root-alpha.wasm"),
      "wasm",
    );
    const requests = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      requests.push(url.pathname + url.search);
      if (
        url.pathname === "/__mockup/" ||
        url.pathname === "/__mockup/__asset-check__/nested/"
      ) {
        return response("<div id='root'></div>", "text/html", 200, url.href);
      }
      if (url.pathname.endsWith(".wasm")) {
        return response("wasm", "application/wasm; charset=binary");
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

    assert.ok(
      requests.includes("/__mockup/assets/features/feature-alpha.wasm?init"),
    );
    assert.ok(
      requests.includes("/__mockup/assets/features/feature-beta-worker.wasm"),
    );
    assert.ok(requests.includes("/__mockup/assets/features/root-alpha.wasm"));
    assert.ok(!requests.includes("/__mockup/assets/features/not-a-real.wasm"));
  });

  it("fails when a referenced WebAssembly file returns an HTTP error", async () => {
    const app = makeBuiltApp();
    writeFileSync(
      join(tempRoot, "dist", "assets", "features", "lazy-feature.js"),
      `new URL("./missing.wasm", import.meta.url);`,
    );
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith(".wasm")) {
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
      /Canvas WebAssembly request .* from emitted bundle "assets\/features\/lazy-feature\.js" returned HTTP 404/,
    );
  });

  it("rejects a successful WebAssembly request with the wrong response type", async () => {
    const app = makeBuiltApp();
    writeFileSync(
      join(tempRoot, "dist", "assets", "features", "lazy-feature.js"),
      `new URL("./feature.wasm", import.meta.url);`,
    );
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith(".wasm")) {
        return response("not wasm", "application/octet-stream");
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
      /Canvas WebAssembly request .* from emitted bundle "assets\/features\/lazy-feature\.js" returned content type "application\/octet-stream" instead of application\/wasm/,
    );
  });

  it("includes the emitted bundle when a WebAssembly request fails on the network", async () => {
    const app = makeBuiltApp();
    writeFileSync(
      join(tempRoot, "dist", "assets", "features", "lazy-feature.js"),
      `new URL("./feature.wasm", import.meta.url);`,
    );
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith(".wasm")) {
        throw new Error("connection reset");
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
      /Canvas WebAssembly request .* from emitted bundle "assets\/features\/lazy-feature\.js" failed: connection reset/,
    );
  });

  it("requests local Worker and SharedWorker scripts beneath the configured preview path", async () => {
    const app = makeBuiltApp();
    writeFileSync(
      join(tempRoot, app.indexPath.replace("index.html", "assets/app.js")),
      `import("./features/lazy-feature.js");
const featureWorkerPath = "./features/feature-worker.js";
const featureWorkerUrl = new URL(featureWorkerPath, import.meta.url);
const sharedWorkerPath = "/__mockup/assets/shared-worker.js";
const sharedWorkerUrl = new URL(sharedWorkerPath, import.meta.url).href;
new Worker(featureWorkerUrl, { type: "module" });
new SharedWorker(sharedWorkerUrl);`,
    );
    writeFileSync(
      join(tempRoot, "dist", "assets", "features", "feature-worker.js"),
      "self.onmessage = () => {};",
    );
    writeFileSync(
      join(tempRoot, "dist", "assets", "shared-worker.js"),
      "self.onconnect = () => {};",
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

    assert.ok(requests.includes("/__mockup/assets/features/feature-worker.js"));
    assert.ok(requests.includes("/__mockup/assets/shared-worker.js"));
  });

  it("ignores external, blob-backed, and unresolved runtime worker URLs", async () => {
    const app = makeBuiltApp();
    writeFileSync(
      join(tempRoot, app.indexPath.replace("index.html", "assets/app.js")),
      `const remoteWorkerUrl = "https://cdn.example/worker.js";
const blobWorkerUrl = URL.createObjectURL(new Blob());
const runtimeWorkerName = getWorkerName();
new Worker(remoteWorkerUrl);
new Worker(blobWorkerUrl);
new Worker(new URL(runtimeWorkerName, import.meta.url));
new Worker(new URL(\`./workers/\${runtimeWorkerName}.js\`, import.meta.url));`,
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

    assert.equal(
      requests.some((path) => path.includes("worker.js")),
      false,
    );
  });

  it("rejects app-shell HTML returned instead of a web worker script", async () => {
    const app = makeBuiltApp();
    writeFileSync(
      join(tempRoot, app.indexPath.replace("index.html", "assets/app.js")),
      `new Worker(new URL("./features/feature-worker.js", import.meta.url), { type: "module" });`,
    );
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/feature-worker.js")) {
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
      /Canvas web worker request .* returned content type "text\/html"/,
    );
  });

  it("fails when a web worker request returns an HTTP error", async () => {
    const app = makeBuiltApp();
    writeFileSync(
      join(tempRoot, app.indexPath.replace("index.html", "assets/app.js")),
      `new Worker("/__mockup/assets/feature-worker.js");`,
    );
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/feature-worker.js")) {
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
      /Canvas web worker request .* returned HTTP 404/,
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

  it("rejects an asset response redirected outside the configured preview path", async () => {
    const app = makeBuiltApp();
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith(".svg")) {
        return response(
          "<svg/>",
          "image/svg+xml",
          200,
          "http://preview.local/assets/icon.svg",
        );
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
      /Canvas media request .* redirected outside configured preview origin or path "\/__mockup\/": final URL http:\/\/preview\.local\/assets\/icon\.svg/,
    );
  });

  it("rejects an asset response redirected to a different origin", async () => {
    const app = makeBuiltApp();
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith(".svg")) {
        return response(
          "<svg/>",
          "image/svg+xml",
          200,
          "https://other.example/__mockup/assets/icon.svg",
        );
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
      /Canvas media request .* redirected outside configured preview origin or path "\/__mockup\/": final URL https:\/\/other\.example\/__mockup\/assets\/icon\.svg/,
    );
  });

  it("allows an asset redirect that stays under the configured preview path", async () => {
    const app = makeBuiltApp();
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith(".svg")) {
        return response(
          "<svg/>",
          "image/svg+xml",
          200,
          "http://preview.local/__mockup/assets/final-icon.svg",
        );
      }
      if (url.pathname.endsWith(".js"))
        return response("export {}", "text/javascript");
      if (url.pathname.endsWith(".css")) return response("body {}", "text/css");
      return response("<div id='root'></div>", "text/html", 200, url.href);
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
  });

  it("fails when a secondary ordinary media request returns an HTTP error", async () => {
    const app = makeBuiltApp();
    writeFileSync(
      join(tempRoot, app.indexPath),
      `<script type="module" src="/__mockup/assets/app.js"></script>
<link rel="stylesheet" href="/__mockup/assets/app.css">
<link rel="icon" href="/__mockup/assets/icon.svg">
<video poster="/__mockup/assets/poster.png"></video>`,
    );
    const requests = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      requests.push(url.pathname);
      if (url.pathname === "/__mockup/assets/poster.png") {
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
      /Canvas media request .*poster\.png.* returned HTTP 404/,
    );

    assert.ok(requests.includes("/__mockup/assets/icon.svg"));
    assert.ok(requests.includes("/__mockup/assets/poster.png"));
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

describe("worker URLs in Vite production output", () => {
  const fixtureRoot = join(tempRoot, "vite-worker-fixture");
  let app;
  let baseUrl;
  let previewServer;

  before(async () => {
    writeViteWorkerFixture(fixtureRoot);
    runVite(["build", "--config", "vite.config.mjs"], fixtureRoot);
    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    app = {
      name: "Vite Worker Fixture",
      indexPath: "dist/index.html",
      basePath: "/__mockup",
    };
    previewServer = startVitePreview(fixtureRoot, port);
    await waitForVitePreview(previewServer, `${baseUrl}/__mockup/`);
  });

  after(async () => {
    if (previewServer) await stopVitePreview(previewServer);
  });

  it("requests and serves the worker emitted by a real production build", async () => {
    const workerRequests = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      const response = await fetch(url);
      if (/worker[^/]*\.js$/i.test(url.pathname)) {
        workerRequests.push({
          pathname: url.pathname,
          contentType: response.headers.get("content-type"),
          body: await response.clone().text(),
        });
      }
      return response;
    };

    await checkServedAssets(app, {
      cwd: fixtureRoot,
      baseUrl,
      basePath: app.basePath,
      fetchImpl,
      log: () => {},
    });

    assert.equal(workerRequests.length, 1);
    assert.match(workerRequests[0].pathname, /^\/__mockup\/.*worker.*\.js$/i);
    assert.match(workerRequests[0].contentType, /javascript/i);
    assert.match(workerRequests[0].body, /postMessage/);
  });

  it("reports a failed response for the worker emitted by Vite", async () => {
    const workerRequests = [];
    const fetchImpl = async (input) => {
      const url = new URL(input);
      if (/worker[^/]*\.js$/i.test(url.pathname)) {
        workerRequests.push(url.pathname);
        return new Response("missing worker", {
          status: 404,
          headers: { "content-type": "text/plain" },
        });
      }
      return fetch(url);
    };

    await assert.rejects(
      checkServedAssets(app, {
        cwd: fixtureRoot,
        baseUrl,
        basePath: app.basePath,
        fetchImpl,
        log: () => {},
      }),
      /Vite Worker Fixture web worker request .* returned HTTP 404/,
    );
    assert.equal(workerRequests.length, 1);
    assert.match(workerRequests[0], /^\/__mockup\/.*worker.*\.js$/i);
  });
});
