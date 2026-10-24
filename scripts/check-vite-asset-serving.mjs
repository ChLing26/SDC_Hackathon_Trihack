import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { apps, readPreviewSettings } from "./build-vite-apps.mjs";
import {
  collectBuiltWasmReferences,
  collectSrcsetURLs,
} from "./check-vite-asset-paths.mjs";

const artifactIndexPaths = {
  "@workspace/procurement-workspace":
    "artifacts/procurement-workspace/dist/public/index.html",
  "@workspace/mockup-sandbox": "artifacts/mockup-sandbox/dist/index.html",
};
const previewScripts = {
  "@workspace/procurement-workspace": "serve",
  "@workspace/mockup-sandbox": "preview",
};

const assetTypes = {
  js: {
    extension: /\.(?:[cm]?[jt]s|[cm]?[jt]sx)$/i,
    contentType: /^(?:text|application)\/(?:javascript|ecmascript)$/i,
    label: "JavaScript",
  },
  css: {
    extension: /\.css$/i,
    contentType: /^text\/css$/i,
    label: "CSS",
  },
  media: {
    extension: /\.(?:avif|gif|jpe?g|png|svg|webp)$/i,
    contentType: /^image\/(?:avif|gif|jpeg|png|svg\+xml|webp)$/i,
    label: "media",
  },
};

function expectedAssetPaths(html) {
  const paths = { js: [], css: [], media: [], responsiveMedia: [] };
  const attributePattern =
    /\b(src|href|poster|srcset|imagesrcset)\s*=\s*["']([^"']+)["']/gi;

  for (const [, attribute, value] of html.matchAll(attributePattern)) {
    const isResponsiveImage =
      attribute.toLowerCase() === "srcset" ||
      attribute.toLowerCase() === "imagesrcset";
    const values = isResponsiveImage ? collectSrcsetURLs(value) : [value];

    for (const assetUrl of values) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#|data:)/i.test(assetUrl)) continue;

      let pathname;
      try {
        pathname = new URL(assetUrl, "http://preview.local/").pathname;
      } catch {
        continue;
      }

      for (const [type, definition] of Object.entries(assetTypes)) {
        if (definition.extension.test(pathname)) {
          paths[isResponsiveImage ? "responsiveMedia" : type].push(assetUrl);
          break;
        }
      }
    }
  }

  return paths;
}

function collectBundledScriptReferences(outputDirectory) {
  const references = [];
  const pendingDirectories = [outputDirectory];
  const dynamicImportPattern = /\bimport\s*\(\s*(["'\x60])([^"'\x60]+)\1\s*\)/g;
  const workerPattern =
    /\bnew\s+(?:Worker|SharedWorker)\s*\(\s*(?:new\s+URL\s*\(\s*)?(["'\x60])([^"'\x60]+)\1/g;

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }

      if (!entry.isFile() || !/\.(?:m?js)$/i.test(entry.name)) continue;

      const source = relative(outputDirectory, entryPath).split(sep).join("/");
      const content = readFileSync(entryPath, "utf8");
      for (const match of content.matchAll(dynamicImportPattern)) {
        const specifier = match[2];
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(specifier)) continue;
        let pathname;
        try {
          pathname = new URL(specifier, "http://preview.local/").pathname;
        } catch {
          continue;
        }
        if (!/\.(?:m?js)$/i.test(pathname)) continue;
        references.push({ source, specifier, isWorker: false });
      }

      for (const match of content.matchAll(workerPattern)) {
        const specifier = match[2];
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(specifier)) continue;
        let pathname;
        try {
          pathname = new URL(specifier, "http://preview.local/").pathname;
        } catch {
          continue;
        }
        if (!/\.(?:m?js)$/i.test(pathname)) continue;
        references.push({ source, specifier, isWorker: true });
      }
    }
  }

  return references;
}

function assertResponse(
  response,
  type,
  requestUrl,
  appName,
  requestLabel = assetTypes[type].label,
) {
  const definition = assetTypes[type];
  if (!response.ok) {
    throw new Error(
      `${appName} ${requestLabel} request ${requestUrl} returned HTTP ${response.status}.`,
    );
  }

  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim();
  if (!contentType || !definition.contentType.test(contentType)) {
    throw new Error(
      `${appName} ${requestLabel} request ${requestUrl} returned content type "${contentType ?? "missing"}" instead of an expected ${definition.label} type.`,
    );
  }
}

function assertResponseStaysWithinPreview(
  response,
  requestUrl,
  previewOrigin,
  basePath,
  appName,
  requestLabel,
) {
  const finalUrl = response.url ? new URL(response.url) : new URL(requestUrl);
  if (
    finalUrl.origin !== previewOrigin ||
    !finalUrl.pathname.startsWith(basePath)
  ) {
    throw new Error(
      `${appName} ${requestLabel} request ${requestUrl} redirected outside configured preview origin or path "${basePath}": final URL ${finalUrl.href}.`,
    );
  }
}

function assertWasmResponse(response, requestUrl, appName) {
  if (!response.ok) {
    throw new Error(
      `${appName} WebAssembly request ${requestUrl} returned HTTP ${response.status}.`,
    );
  }

  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim();
  if (!contentType || !/^application\/wasm$/i.test(contentType)) {
    throw new Error(
      `${appName} WebAssembly request ${requestUrl} returned content type "${contentType ?? "missing"}" instead of application/wasm.`,
    );
  }
}

async function readPage(fetchImpl, pageUrl, appName) {
  let response;
  try {
    response = await fetchImpl(pageUrl);
  } catch (error) {
    throw new Error(
      `${appName} preview did not respond at ${pageUrl}: ${error.message}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `${appName} page request ${pageUrl} returned HTTP ${response.status}.`,
    );
  }

  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim();
  if (contentType !== "text/html") {
    throw new Error(
      `${appName} page request ${pageUrl} returned content type "${contentType ?? "missing"}" instead of text/html.`,
    );
  }

  return { html: await response.text(), responseUrl: response.url || pageUrl };
}

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

function startPreviewServer(app, { cwd, port, basePath }) {
  const previewScript = previewScripts[app.packageName];
  if (!previewScript) {
    throw new Error(`No preview command is configured for ${app.packageName}.`);
  }

  const child = spawn(
    "pnpm",
    ["--filter", app.packageName, "run", previewScript],
    {
      cwd,
      env: {
        ...process.env,
        PORT: String(port),
        BASE_PATH: basePath,
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  return { child, output };
}

async function waitForPreviewServer(server, url, appName) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `${appName} preview server exited before becoming ready.\n${server.output.join("")}`,
      );
    }

    try {
      const response = await fetch(url);
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }

  throw new Error(
    `${appName} preview server did not become ready at ${url}.\n${server.output.join("")}`,
  );
}

async function stopPreviewServer(server) {
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

export async function checkServedAssets(
  app,
  {
    baseUrl,
    basePath,
    fetchImpl = fetch,
    cwd = process.cwd(),
    log = console.log,
  } = {},
) {
  const indexPath = resolve(cwd, app.indexPath);
  let builtHtml;
  try {
    builtHtml = readFileSync(indexPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `${app.name} build output is missing ${app.indexPath}. Build it before checking preview asset serving.`,
      );
    }
    throw error;
  }

  const origin = baseUrl ?? `http://127.0.0.1:${app.port}`;
  const previewOrigin = new URL(origin).origin;
  const normalizedBasePath = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const rootPageUrl = new URL(normalizedBasePath, origin).href;
  const nestedPath = `${normalizedBasePath}__asset-check__/nested/`;
  const nestedPageUrl = new URL(nestedPath, origin).href;
  const outputDirectory = dirname(indexPath);

  // Load both pages before using their URLs, matching a hard refresh from a
  // nested client-side route rather than relying only on build-time URLs.
  await readPage(fetchImpl, rootPageUrl, app.name);
  const nestedPage = await readPage(fetchImpl, nestedPageUrl, app.name);
  const assetPaths = expectedAssetPaths(builtHtml);

  for (const type of Object.keys(assetTypes)) {
    const assetPathsToCheck =
      type === "media" ? assetPaths[type] : [assetPaths[type][0]];
    if (!assetPathsToCheck[0]) {
      throw new Error(
        `${app.name} build output has no ${assetTypes[type].label} URL to verify.`,
      );
    }

    for (const assetPath of assetPathsToCheck) {
      const resolvedAssetUrl = new URL(assetPath, nestedPage.responseUrl);
      if (
        resolvedAssetUrl.origin !== new URL(origin).origin ||
        !resolvedAssetUrl.pathname.startsWith(normalizedBasePath)
      ) {
        throw new Error(
          `${app.name} ${assetTypes[type].label} URL "${assetPath}" does not resolve beneath configured preview path "${normalizedBasePath}" from the nested route.`,
        );
      }

      let response;
      try {
        response = await fetchImpl(resolvedAssetUrl);
      } catch (error) {
        throw new Error(
          `${app.name} ${assetTypes[type].label} request ${resolvedAssetUrl.href} failed: ${error.message}`,
        );
      }
      assertResponseStaysWithinPreview(
        response,
        resolvedAssetUrl.href,
        previewOrigin,
        normalizedBasePath,
        app.name,
        assetTypes[type].label,
      );
      assertResponse(response, type, resolvedAssetUrl.href, app.name);
    }
  }

  const responsiveImageUrls = new Set();
  for (const imagePath of assetPaths.responsiveMedia) {
    const imageUrl = new URL(imagePath, nestedPage.responseUrl);
    if (
      imageUrl.origin !== new URL(origin).origin ||
      !imageUrl.pathname.startsWith(normalizedBasePath)
    ) {
      throw new Error(
        `${app.name} responsive image URL "${imagePath}" does not resolve beneath configured preview path "${normalizedBasePath}" from the nested route.`,
      );
    }
    responsiveImageUrls.add(imageUrl.href);
  }

  for (const imageUrl of responsiveImageUrls) {
    let response;
    try {
      response = await fetchImpl(imageUrl);
    } catch (error) {
      throw new Error(
        `${app.name} responsive image request ${imageUrl} failed: ${error.message}`,
      );
    }
    assertResponseStaysWithinPreview(
      response,
      imageUrl,
      previewOrigin,
      normalizedBasePath,
      app.name,
      "responsive image",
    );
    assertResponse(response, "media", imageUrl, app.name, "responsive image");
  }

  const lazyChunkUrls = new Set();
  const workerUrls = new Set();
  for (const { source, specifier, isWorker } of collectBundledScriptReferences(
    outputDirectory,
  )) {
    const sourceUrl = new URL(source, new URL(normalizedBasePath, origin));
    const scriptUrl = new URL(specifier, sourceUrl);
    const requestLabel = isWorker
      ? "web worker"
      : "lazy-loaded JavaScript chunk";
    if (
      scriptUrl.origin !== new URL(origin).origin ||
      !scriptUrl.pathname.startsWith(normalizedBasePath)
    ) {
      throw new Error(
        `${app.name} ${requestLabel} URL "${specifier}" from "${source}" does not resolve beneath configured preview path "${normalizedBasePath}".`,
      );
    }
    (isWorker ? workerUrls : lazyChunkUrls).add(scriptUrl.href);
  }

  for (const chunkUrl of lazyChunkUrls) {
    let response;
    try {
      response = await fetchImpl(chunkUrl);
    } catch (error) {
      throw new Error(
        `${app.name} lazy-loaded JavaScript chunk request ${chunkUrl} failed: ${error.message}`,
      );
    }
    assertResponseStaysWithinPreview(
      response,
      chunkUrl,
      previewOrigin,
      normalizedBasePath,
      app.name,
      "lazy-loaded JavaScript chunk",
    );
    assertResponse(
      response,
      "js",
      chunkUrl,
      app.name,
      "lazy-loaded JavaScript chunk",
    );
  }

  for (const workerUrl of workerUrls) {
    let response;
    try {
      response = await fetchImpl(workerUrl);
    } catch (error) {
      throw new Error(
        `${app.name} web worker request ${workerUrl} failed: ${error.message}`,
      );
    }
    assertResponseStaysWithinPreview(
      response,
      workerUrl,
      previewOrigin,
      normalizedBasePath,
      app.name,
      "web worker",
    );
    assertResponse(response, "js", workerUrl, app.name, "web worker");
  }

  const wasmUrls = new Set();
  for (const { source, url: specifier } of collectBuiltWasmReferences(
    outputDirectory,
  )) {
    const sourceUrl = new URL(source, new URL(normalizedBasePath, origin));
    const wasmUrl = new URL(specifier, sourceUrl);
    if (
      wasmUrl.origin !== new URL(origin).origin ||
      !wasmUrl.pathname.startsWith(normalizedBasePath)
    ) {
      throw new Error(
        `${app.name} WebAssembly URL "${specifier}" from "${source}" does not resolve beneath configured preview path "${normalizedBasePath}".`,
      );
    }
    wasmUrls.add(wasmUrl.href);
  }

  for (const wasmUrl of wasmUrls) {
    let response;
    try {
      response = await fetchImpl(wasmUrl);
    } catch (error) {
      throw new Error(
        `${app.name} WebAssembly request ${wasmUrl} failed: ${error.message}`,
      );
    }
    assertResponseStaysWithinPreview(
      response,
      wasmUrl,
      previewOrigin,
      normalizedBasePath,
      app.name,
      "WebAssembly",
    );
    assertWasmResponse(response, wasmUrl, app.name);
  }

  log(
    `${app.name} served JavaScript, CSS, media, ${responsiveImageUrls.size} responsive image${responsiveImageUrls.size === 1 ? "" : "s"}, ${lazyChunkUrls.size} lazy-loaded JavaScript chunk${lazyChunkUrls.size === 1 ? "" : "s"}, ${workerUrls.size} web worker${workerUrls.size === 1 ? "" : "s"}, and ${wasmUrls.size} WebAssembly file${wasmUrls.size === 1 ? "" : "s"} successfully from ${normalizedBasePath} and nested route ${nestedPath}.`,
  );
}

export async function checkAllServedAssets({
  appConfigs = apps,
  cwd = process.cwd(),
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  for (const config of appConfigs) {
    const { port, basePath } = readPreviewSettings(config, cwd);
    const app = {
      ...config,
      port,
      basePath,
      indexPath: artifactIndexPaths[config.packageName],
    };

    if (!app.indexPath) {
      throw new Error(
        `No built index.html location is configured for ${config.packageName}.`,
      );
    }

    const previewPort = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${previewPort}`;
    const server = startPreviewServer(app, {
      cwd,
      port: previewPort,
      basePath,
    });

    try {
      await waitForPreviewServer(
        server,
        new URL(basePath.endsWith("/") ? basePath : `${basePath}/`, baseUrl),
        app.name,
      );
      await checkServedAssets(app, {
        baseUrl,
        basePath,
        cwd,
        fetchImpl,
        log,
      });
    } finally {
      await stopPreviewServer(server);
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  checkAllServedAssets().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
