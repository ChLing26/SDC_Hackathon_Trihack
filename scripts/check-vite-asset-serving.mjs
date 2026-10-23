import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { apps, readPreviewSettings } from "./build-vite-apps.mjs";

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
  const paths = { js: [], css: [], media: [] };
  const attributePattern = /\b(src|href|poster)\s*=\s*["']([^"']+)["']/gi;

  for (const [, attribute, value] of html.matchAll(attributePattern)) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#|data:)/i.test(value)) continue;

    let pathname;
    try {
      pathname = new URL(value, "http://preview.local/").pathname;
    } catch {
      continue;
    }

    for (const [type, definition] of Object.entries(assetTypes)) {
      if (definition.extension.test(pathname)) {
        paths[type].push(value);
        break;
      }
    }
  }

  return paths;
}

function collectLazyChunkReferences(outputDirectory) {
  const references = [];
  const pendingDirectories = [outputDirectory];
  const dynamicImportPattern = /\bimport\s*\(\s*(["'\x60])([^"'\x60]+)\1\s*\)/g;

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
        references.push({ source, specifier });
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
    const assetPath = assetPaths[type][0];
    if (!assetPath) {
      throw new Error(
        `${app.name} build output has no ${assetTypes[type].label} URL to verify.`,
      );
    }

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
    assertResponse(response, type, resolvedAssetUrl.href, app.name);
  }

  const lazyChunkUrls = new Set();
  for (const { source, specifier } of collectLazyChunkReferences(
    outputDirectory,
  )) {
    const sourceUrl = new URL(source, new URL(normalizedBasePath, origin));
    const chunkUrl = new URL(specifier, sourceUrl);
    if (
      chunkUrl.origin !== new URL(origin).origin ||
      !chunkUrl.pathname.startsWith(normalizedBasePath)
    ) {
      throw new Error(
        `${app.name} lazy-loaded JavaScript chunk URL "${specifier}" from "${source}" does not resolve beneath configured preview path "${normalizedBasePath}".`,
      );
    }
    lazyChunkUrls.add(chunkUrl.href);
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
    assertResponse(
      response,
      "js",
      chunkUrl,
      app.name,
      "lazy-loaded JavaScript chunk",
    );
  }

  log(
    `${app.name} served JavaScript, CSS, media, and ${lazyChunkUrls.size} lazy-loaded JavaScript chunk${lazyChunkUrls.size === 1 ? "" : "s"} successfully from ${normalizedBasePath} and nested route ${nestedPath}.`,
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
