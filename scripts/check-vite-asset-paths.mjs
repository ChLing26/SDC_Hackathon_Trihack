import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

function readManifestPaths(manifestPath) {
  const manifest = readFileSync(resolve(manifestPath), "utf8");
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

function checkAssetPaths(app) {
  const { basePath, assetPrefix } = readManifestPaths(app.manifestPath);
  let html;

  try {
    html = readFileSync(resolve(app.indexPath), "utf8");
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

  console.log(`${app.name} assets use configured prefix "${assetPrefix}".`);
}

for (const app of apps) {
  checkAssetPaths(app);
}
