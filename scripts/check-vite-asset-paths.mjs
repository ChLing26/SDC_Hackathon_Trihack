import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const apps = [
  {
    name: "ProcureFlow",
    manifestPath: "artifacts/procurement-workspace/.replit-artifact/artifact.toml",
    indexPath: "artifacts/procurement-workspace/dist/public/index.html",
  },
  {
    name: "Canvas",
    manifestPath: "artifacts/mockup-sandbox/.replit-artifact/artifact.toml",
    indexPath: "artifacts/mockup-sandbox/dist/index.html",
  },
];

const assetExtensions =
  "m?js|css|wasm|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot";
const quotedAssetReferencePattern = new RegExp(
  String.raw`["'\x60]((?:[a-z][a-z\d+.-]*:)?(?://)?(?:/|\.\.?/)?[^"'\x60\s()<>;,]+?\.(?:${assetExtensions})(?:[?#][^"'\x60\s()<>;,]*)?)["'\x60]`,
  "gi",
);
const cssUrlReferencePattern = new RegExp(
  String.raw`url\(\s*["']?((?:/|\.\.?/)?[^"'\x60\s()<>;,]+?\.(?:${assetExtensions})(?:[?#][^"'\x60\s()<>;,]*)?)["']?\s*\)`,
  "gi",
);

function readManifestPaths(manifestPath, cwd = process.cwd()) {
  const manifest = readFileSync(resolve(cwd, manifestPath), "utf8");
  let section = "";
  let previewPath;
  let configuredBasePath;

  for (const line of manifest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sectionMatch = trimmed.match(/^\[+([^\]]+)\]+$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    if (section === "") {
      previewPath ??= trimmed.match(/^previewPath\s*=\s*"([^"]+)"\s*$/)?.[1];
    } else if (section === "services.env") {
      configuredBasePath ??= trimmed.match(/^BASE_PATH\s*=\s*"([^"]+)"\s*$/)?.[1];
    }
  }

  if (!previewPath || !configuredBasePath) {
    throw new Error(
      `Expected ${manifestPath} to define previewPath and [services.env].BASE_PATH.`,
    );
  }

  if (!previewPath.startsWith("/") || !configuredBasePath.startsWith("/")) {
    throw new Error(
      `Expected ${manifestPath} previewPath and BASE_PATH to be absolute paths.`,
    );
  }

  if (previewPath !== configuredBasePath) {
    throw new Error(
      `${manifestPath} declares previewPath="${previewPath}" but BASE_PATH="${configuredBasePath}". These paths must match.`,
    );
  }

  const basePath = configuredBasePath.endsWith("/")
    ? configuredBasePath
    : `${configuredBasePath}/`;
  return { basePath, assetPrefix: `${basePath}assets/` };
}

function collectBuiltCodeReferences(outputDirectory) {
  const references = [];
  const pendingDirectories = [outputDirectory];

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }

      if (!entry.isFile() || !/\.(?:m?js|css)$/i.test(entry.name)) continue;

      const source = relative(outputDirectory, entryPath).split(sep).join("/");
      const content = readFileSync(entryPath, "utf8");
      const patterns =
        entry.name.endsWith(".css")
          ? [quotedAssetReferencePattern, cssUrlReferencePattern]
          : [quotedAssetReferencePattern];
      const seenUrls = new Set();
      for (const pattern of patterns) {
        for (const match of content.matchAll(pattern)) {
          if (seenUrls.has(match[1])) continue;
          seenUrls.add(match[1]);
          references.push({ url: match[1], source });
        }
      }
    }
  }

  return references;
}

export function checkAssetPaths(app, {
  cwd = process.cwd(),
  log = console.log,
} = {}) {
  const { basePath, assetPrefix } = readManifestPaths(app.manifestPath, cwd);
  const indexPath = resolve(cwd, app.indexPath);
  const outputDirectory = dirname(indexPath);
  let html;

  try {
    html = readFileSync(indexPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `${app.name} build output is missing ${app.indexPath}. Run its build before checking preview asset paths.`,
      );
    }
    throw error;
  }

  const references = [
    ...[...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
      .map((match) => ({ url: match[1], source: "index.html" }))
      .filter(({ url }) => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url))
      .filter(({ url }) =>
        /(?:^|\/)assets\/|(?:^|\/)[^/]+\.(?:m?js|css|wasm|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(
          url,
        ),
      ),
    ...collectBuiltCodeReferences(outputDirectory).filter(
      ({ url }) => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url),
    ),
  ];

  if (references.length === 0) {
    throw new Error(
      `${app.name} build output has no local asset references to validate in ${app.indexPath}.`,
    );
  }

  const invalidReferences = references.filter(
    (reference) => !resolveReferenceURL(reference, basePath).pathname.startsWith(basePath),
  );
  if (invalidReferences.length > 0) {
    throw new Error(
      `${app.name} local assets do not use configured base path "${basePath}". Invalid URL${invalidReferences.length === 1 ? "" : "s"}: ${invalidReferences.map(formatReference).join(", ")}`,
    );
  }

  if (
    !references.some(
      (reference) => resolveReferenceURL(reference, basePath).pathname.startsWith(assetPrefix),
    )
  ) {
    throw new Error(
      `${app.name} build output has no bundled assets under configured prefix "${assetPrefix}".`,
    );
  }

  const missingReferences = [];
  for (const reference of references) {
    const { url, source } = reference;
    let assetPath;
    try {
      const decodedPath = decodeURIComponent(
        resolveReferenceURL(reference, basePath).pathname,
      );
      assetPath = resolve(outputDirectory, decodedPath.slice(basePath.length));
    } catch {
      missingReferences.push(reference);
      continue;
    }

    const relativePath = relative(outputDirectory, assetPath);
    const escapesOutputDirectory =
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      resolve(outputDirectory, relativePath) !== assetPath;

    if (
      escapesOutputDirectory ||
      !existsSync(assetPath) ||
      !statSync(assetPath).isFile()
    ) {
      missingReferences.push({ url, source });
    }
  }

  if (missingReferences.length > 0) {
    throw new Error(
      `${app.name} build output is missing file${missingReferences.length === 1 ? "" : "s"} referenced by URL${missingReferences.length === 1 ? "" : "s"}: ${missingReferences.map(formatReference).join(", ")}`,
    );
  }

  log(`${app.name} assets use configured prefix "${assetPrefix}" and exist in the build output.`);
}

function resolveReferenceURL({ url, source }, basePath) {
  const sourceBase =
    source === "index.html" || url.startsWith("assets/")
      ? `http://preview.local${basePath}`
      : `http://preview.local${basePath}${source}`;
  return new URL(url, sourceBase);
}

function formatReference({ url, source }) {
  return source === "index.html" ? `"${url}"` : `"${url}" in ${source}`;
}

export function checkAllAssetPaths({ appConfigs = apps, cwd, log } = {}) {
  for (const app of appConfigs) {
    checkAssetPaths(app, { cwd, log });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkAllAssetPaths();
}
