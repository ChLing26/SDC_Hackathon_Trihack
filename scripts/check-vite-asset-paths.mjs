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
  String.raw`url\(\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|((?:\\(?:[0-9a-fA-F]{1,6}[\t\n\f\r ]?|[\s\S])|[^)\s])*))\s*\)`,
  "gi",
);
const cssAssetExtensionPattern = new RegExp(
  String.raw`\.(?:${assetExtensions})(?:[?#]|$)`,
  "i",
);
const cssImportReferencePattern =
  /@import\s+(?!url\s*\()\s*["']((?:\/|\.\.?\/)?[^"'\x60\s()<>;,]+?\.css(?:[?#][^"'\x60\s()<>;,]*)?)["']/gi;

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
      const rawContent = readFileSync(entryPath, "utf8");
      const isStylesheet = /\.css$/i.test(entry.name);
      const content = isStylesheet ? stripCssComments(rawContent) : rawContent;
      const seenUrls = new Set();

      if (isStylesheet) {
        for (const match of content.matchAll(cssUrlReferencePattern)) {
          const reference = createCssURLReference(match, source);
          if (!reference || seenUrls.has(reference.url)) continue;
          seenUrls.add(reference.url);
          references.push(reference);
        }
      }

      for (const match of content.matchAll(quotedAssetReferencePattern)) {
        if (seenUrls.has(match[1])) continue;
        seenUrls.add(match[1]);
        references.push({ url: match[1], source });
      }
    }
  }

  return references;
}

function collectHTMLReferences(html) {
  const references = [];
  const attributePattern =
    /\b(src|href|srcset|imagesrcset|poster)\s*=\s*["']([^"']+)["']/gi;

  for (const match of html.matchAll(attributePattern)) {
    const attribute = match[1].toLowerCase();
    const urls =
      attribute === "srcset" || attribute === "imagesrcset"
        ? collectSrcsetURLs(match[2])
        : [match[2]];

    for (const url of urls) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;
      if (attribute === "src" || attribute === "href") {
        if (
          !/(?:^|\/)assets\/|(?:^|\/)[^/]+\.(?:m?js|css|wasm|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(
            url,
          )
        ) {
          continue;
        }
      }
      references.push({ url, source: "index.html" });
    }
  }

  return references;
}

function collectInlineStyleReferences(html) {
  const references = [];
  const styleAttributePattern = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi;
  const styleBlockPattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;

  function addStyleReferences(style, sourceOffset) {
    const commentStrippedStyle = stripCssComments(style);
    for (const match of commentStrippedStyle.matchAll(cssUrlReferencePattern)) {
      const reference = createCssURLReference(
        match,
        `index.html:${lineNumberAt(html, sourceOffset + match.index)}`,
      );
      if (!reference) continue;
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference.resolvedUrl)) {
        continue;
      }
      references.push(reference);
    }

    for (const match of commentStrippedStyle.matchAll(
      cssImportReferencePattern,
    )) {
      const url = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;

      references.push({
        url,
        source: `index.html:${lineNumberAt(html, sourceOffset + match.index)}`,
      });
    }
  }

  for (const match of html.matchAll(styleAttributePattern)) {
    const styleOffset = match.index + match[0].indexOf(match[2]);
    addStyleReferences(match[2], styleOffset);
  }

  for (const match of html.matchAll(styleBlockPattern)) {
    const styleOffset = match.index + match[0].indexOf(match[1]);
    addStyleReferences(match[1], styleOffset);
  }

  return references;
}

function stripCssComments(css) {
  let result = "";
  let quote = "";
  let escaped = false;
  let inComment = false;

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    const nextCharacter = css[index + 1];

    if (inComment) {
      if (character === "*" && nextCharacter === "/") {
        result += "  ";
        index += 1;
        inComment = false;
      } else {
        result += character === "\n" || character === "\r" ? character : " ";
      }
      continue;
    }

    if (quote) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      result += character;
    } else if (character === "/" && nextCharacter === "*") {
      result += "  ";
      index += 1;
      inComment = true;
    } else {
      result += character;
    }
  }

  return result;
}

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split(/\r\n|\r|\n/).length;
}

function collectSrcsetURLs(srcset) {
  const urls = [];
  let position = 0;

  while (position < srcset.length) {
    while (position < srcset.length && /[\s,]/.test(srcset[position])) {
      position += 1;
    }
    if (position >= srcset.length) break;

    const urlStart = position;
    while (position < srcset.length && !/\s/.test(srcset[position])) {
      position += 1;
    }

    const candidate = srcset.slice(urlStart, position);
    const url = candidate.replace(/,+$/, "");
    if (url) urls.push(url);

    if (candidate.endsWith(",")) continue;

    while (position < srcset.length && srcset[position] !== ",") {
      position += 1;
    }
    if (srcset[position] === ",") position += 1;
  }

  return urls;
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
    ...collectHTMLReferences(html),
    ...collectInlineStyleReferences(html),
    ...collectBuiltCodeReferences(outputDirectory).filter(
      (reference) =>
        !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(
          reference.resolvedUrl ?? reference.url,
        ),
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

function createCssURLReference(match, source) {
  const url = match[1] ?? match[2] ?? match[3] ?? "";
  const resolvedUrl = decodeCssEscapes(url);
  if (!cssAssetExtensionPattern.test(resolvedUrl)) return null;
  return { url, resolvedUrl, source };
}

function decodeCssEscapes(value) {
  return value.replace(
    /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[\t\n\f\r ])?|(\r\n|[\n\r\f])|([\s\S]))/g,
    (_match, hex, lineContinuation, escapedCharacter) => {
      if (hex) {
        const codePoint = Number.parseInt(hex, 16);
        if (
          codePoint === 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return "\ufffd";
        }
        return String.fromCodePoint(codePoint);
      }
      return lineContinuation ? "" : (escapedCharacter ?? "");
    },
  );
}

function resolveReferenceURL({ url, resolvedUrl, source }, basePath) {
  const referenceUrl = resolvedUrl ?? url;
  const sourceBase =
    source.startsWith("index.html") || referenceUrl.startsWith("assets/")
      ? `http://preview.local${basePath}`
      : `http://preview.local${basePath}${source}`;
  return new URL(referenceUrl, sourceBase);
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
