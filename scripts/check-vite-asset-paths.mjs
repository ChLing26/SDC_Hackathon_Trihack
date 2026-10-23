import { existsSync, readFileSync, statSync } from "node:fs";
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

  const references = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((url) => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url))
    .filter((url) => /(?:^|\/)assets\/|(?:^|\/)[^/]+\.(?:js|mjs|css|wasm|png|jpe?g|gif|svg|webp|woff2?|ttf|otf)(?:[?#]|$)/i.test(url));

  if (references.length === 0) {
    throw new Error(
      `${app.name} build output has no local asset references to validate in ${app.indexPath}.`,
    );
  }

  const invalidReferences = references.filter((url) => !url.startsWith(basePath));
  if (invalidReferences.length > 0) {
    throw new Error(
      `${app.name} local assets do not use configured base path "${basePath}". Invalid URL${invalidReferences.length === 1 ? "" : "s"}: ${invalidReferences.join(", ")}`,
    );
  }

  if (!references.some((url) => url.startsWith(assetPrefix))) {
    throw new Error(
      `${app.name} build output has no bundled assets under configured prefix "${assetPrefix}".`,
    );
  }

  const missingReferences = [];
  for (const url of references) {
    let assetPath;
    try {
      const pathname = new URL(url, "http://preview.local").pathname;
      const decodedPath = decodeURIComponent(pathname);
      assetPath = resolve(outputDirectory, decodedPath.slice(basePath.length));
    } catch {
      missingReferences.push(url);
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
      missingReferences.push(url);
    }
  }

  if (missingReferences.length > 0) {
    throw new Error(
      `${app.name} build output is missing file${missingReferences.length === 1 ? "" : "s"} referenced by URL${missingReferences.length === 1 ? "" : "s"}: ${missingReferences.map((url) => `"${url}"`).join(", ")}`,
    );
  }

  log(`${app.name} assets use configured prefix "${assetPrefix}" and exist in the build output.`);
}

export function checkAllAssetPaths({ appConfigs = apps, cwd, log } = {}) {
  for (const app of appConfigs) {
    checkAssetPaths(app, { cwd, log });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkAllAssetPaths();
}
