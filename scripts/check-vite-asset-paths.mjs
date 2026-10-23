import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
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
const quotedLocalURLPattern =
  /(["'\x60])((?:\/|\.\.?\/)[^"'\x60\s()<>;,]+)\1/g;
const directMediaURLAssignmentPattern =
  /(?:\.\s*(?:src|poster)\s*=\s*|\.setAttribute\s*\(\s*["'](?:src|poster)["']\s*,\s*|(?:src|poster)\s*:\s*)(?:new\s+URL\s*\(\s*)?$/i;
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
      const content = isStylesheet
        ? stripCssComments(rawContent)
        : stripJavaScriptComments(rawContent);
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

      if (!isStylesheet) {
        for (const match of content.matchAll(quotedLocalURLPattern)) {
          const url = match[2];
          if (
            seenUrls.has(url) ||
            !isExtensionlessMediaURL(url) ||
            (!isMediaDirectoryURL(url) &&
              !directMediaURLAssignmentPattern.test(
                content.slice(Math.max(0, match.index - 120), match.index),
              ))
          ) {
            continue;
          }
          seenUrls.add(url);
          references.push({ url, source });
        }
      }
    }
  }

  return references;
}

function collectBuiltSVGReferences(outputDirectory) {
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
      if (!entry.isFile() || !/\.svg$/i.test(entry.name)) continue;

      const source = relative(outputDirectory, entryPath).split(sep).join("/");
      references.push(
        ...collectSVGReferences(readFileSync(entryPath, "utf8"), source),
      );
    }
  }

  return references;
}

function collectSVGReferences(svg, source) {
  const references = [];
  const resourceElements =
    /^(?:image|feimage|use|script|link|font-face-uri|mpath|textpath|tref|lineargradient|radialgradient|pattern|filter|mask|marker|clippath|symbol|view)$/i;
  const tagPattern = /<([a-z][a-z\d:-]*)\b([^>]*)>/gi;
  const hrefPattern =
    /(?:^|\s)(?:xlink:)?(?:href|src)\s*=\s*(["'])([\s\S]*?)\1/gi;

  for (const tagMatch of svg.matchAll(tagPattern)) {
    if (!resourceElements.test(tagMatch[1])) continue;
    for (const match of tagMatch[2].matchAll(hrefPattern)) {
      const url = match[2].trim();
      const resolvedUrl = decodeHtmlCharacterReferences(url).value;
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(resolvedUrl)) continue;
      references.push({ url, resolvedUrl, source });
    }
  }

  // SVG files can attach a stylesheet outside the root element.
  const stylesheetInstructionPattern =
    /<\?xml-stylesheet\b[^>]*\bhref\s*=\s*(["'])([\s\S]*?)\1[^>]*\?>/gi;
  for (const match of svg.matchAll(stylesheetInstructionPattern)) {
    const url = match[2].trim();
    const resolvedUrl = decodeHtmlCharacterReferences(url).value;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(resolvedUrl)) continue;
    references.push({ url, resolvedUrl, source });
  }

  const cssContents = [];
  for (const match of svg.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    cssContents.push(match[2]);
  }
  for (const match of svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    cssContents.push(match[1]);
  }

  for (const css of cssContents) {
    const commentStrippedCSS = stripCssComments(css);
    for (const match of commentStrippedCSS.matchAll(cssUrlReferencePattern)) {
      const reference = createCssURLReference(match, source);
      if (
        reference &&
        !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(
          reference.resolvedUrl ?? reference.url,
        )
      ) {
        references.push(reference);
      }
    }
    for (const match of commentStrippedCSS.matchAll(
      cssImportReferencePattern,
    )) {
      const url = match[1];
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;
      references.push({ url, resolvedUrl: decodeCssEscapes(url), source });
    }
  }

  return references;
}

function isExtensionlessMediaURL(url) {
  try {
    const pathname = new URL(url, "http://preview.local/").pathname;
    const filename = pathname.slice(pathname.lastIndexOf("/") + 1);
    return Boolean(filename) && !filename.includes(".");
  } catch {
    return false;
  }
}

function isMediaDirectoryURL(url) {
  try {
    return /(?:^|\/)(?:media|images?|img|audio|video|icons?)(?:\/|$)/i.test(
      new URL(url, "http://preview.local/").pathname,
    );
  } catch {
    return false;
  }
}

function collectHTMLReferences(html, sourcePrefix) {
  const references = [];
  const tagPattern = /<([a-z][a-z\d:-]*)\b([^>]*)>/gi;
  const attributePattern =
    /\b(src|href|srcset|imagesrcset|poster|data)\s*=\s*["']([^"']+)["']/gi;

  for (const tagMatch of html.matchAll(tagPattern)) {
    const element = tagMatch[1].toLowerCase();
    for (const match of tagMatch[2].matchAll(attributePattern)) {
      const attribute = match[1].toLowerCase();
      const urls =
        attribute === "srcset" || attribute === "imagesrcset"
          ? collectSrcsetURLs(match[2])
          : [match[2]];

      for (const url of urls) {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;
        const attributeOffset =
          tagMatch.index + tagMatch[0].indexOf(tagMatch[2]) + match.index;
        if (
          attribute === "src" ||
          attribute === "href" ||
          (attribute === "data" && element === "object")
        ) {
          const isKnownAssetPath =
            /(?:^|\/)assets\/|(?:^|\/)[^/]+\.(?:m?js|css|wasm|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(
              url,
            );
          const isMediaReference = isMediaResourceAttribute(
            element,
            attribute,
            tagMatch[2],
          );

          if (!isKnownAssetPath && !isMediaReference) continue;
        }

        references.push({
          url,
          source: `${sourcePrefix ?? "index.html"}:${lineNumberAt(html, attributeOffset)} ${element}[${attribute}]`,
        });
      }
    }
  }

  return references;
}

function collectIframeSrcdocReferences(html, documentSource = "index.html") {
  const references = [];
  const iframeStartPattern = /<iframe\b/gi;

  for (const iframeMatch of html.matchAll(iframeStartPattern)) {
    const tagStart = iframeMatch.index;
    let quote;
    let tagEnd = tagStart + iframeMatch[0].length;

    for (; tagEnd < html.length; tagEnd += 1) {
      const character = html[tagEnd];
      if (quote) {
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }

    if (tagEnd >= html.length) continue;
    const tag = html.slice(tagStart, tagEnd + 1);
    const srcdocMatch = tag.match(/\bsrcdoc\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!srcdocMatch) continue;

    const embeddedHtml = decodeHtmlCharacterReferences(srcdocMatch[2]).value;
    const iframeSource =
      `${documentSource}:${lineNumberAt(html, tagStart)} iframe[srcdoc]`;
    references.push(
      ...collectHTMLReferences(embeddedHtml, iframeSource),
      ...collectInlineStyleReferences(embeddedHtml, iframeSource),
      ...collectIframeSrcdocReferences(embeddedHtml, iframeSource),
    );
  }

  return references;
}

function isMediaResourceAttribute(element, attribute, tagAttributes) {
  if (attribute === "data" && element === "object") {
    const typeMatch = tagAttributes.match(
      /\btype\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i,
    );
    const mimeType = (typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? "")
      .trim()
      .toLowerCase();
    return /^(?:image|audio|video)\//.test(mimeType);
  }

  if (
    attribute === "src" &&
    /^(?:img|video|audio|source|track|embed)$/.test(element)
  ) {
    return true;
  }
  if (attribute !== "href" || element !== "link") return false;

  const rel =
    tagAttributes.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
  const as =
    tagAttributes.match(/\bas\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
  const relTokens = rel.toLowerCase().split(/\s+/);

  return (
    relTokens.some((token) =>
      /^(?:icon|apple-touch-icon|mask-icon)$/.test(token),
    ) ||
    (relTokens.includes("preload") &&
      /^(?:image|audio|video|track)$/i.test(as))
  );
}

function collectInlineStyleReferences(html, sourcePrefix) {
  const references = [];
  const styleAttributePattern = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi;
  const styleBlockPattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;

  function addStyleReferences(style, sourceOffset) {
    const { value: decodedStyle, sourceOffsets } =
      decodeHtmlCharacterReferences(style);
    const commentStrippedStyle = stripCssComments(decodedStyle);
    const sourceOffsetAt = (styleOffset) =>
      sourceOffset + (sourceOffsets[styleOffset] ?? style.length);
    for (const match of commentStrippedStyle.matchAll(cssUrlReferencePattern)) {
      const reference = createCssURLReference(
        match,
        sourcePrefix
          ? `${sourcePrefix}:${lineNumberAt(html, sourceOffsetAt(match.index))}`
          : `index.html:${lineNumberAt(html, sourceOffsetAt(match.index))}`,
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
        source: sourcePrefix
          ? `${sourcePrefix}:${lineNumberAt(html, sourceOffsetAt(match.index))}`
          : `index.html:${lineNumberAt(html, sourceOffsetAt(match.index))}`,
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

const htmlCharacterReferences = {
  AMP: "&",
  apos: "'",
  ast: "*",
  colon: ":",
  commat: "@",
  dollar: "$",
  equals: "=",
  excl: "!",
  gt: ">",
  GT: ">",
  hyphen: "-",
  lpar: "(",
  lt: "<",
  LT: "<",
  lowbar: "_",
  num: "#",
  percnt: "%",
  period: ".",
  plus: "+",
  quest: "?",
  quot: '"',
  rpar: ")",
  semi: ";",
  sol: "/",
  Tab: "\t",
  NewLine: "\n",
  amp: "&",
};

function decodeHtmlCharacterReferences(value) {
  const sourceOffsets = [];
  let decoded = "";
  let sourceOffset = 0;
  const characterReferencePattern =
    /&(?:#(?:[xX][\da-fA-F]+|\d+)|[a-zA-Z][a-zA-Z\d]+);/g;

  for (const match of value.matchAll(characterReferencePattern)) {
    const precedingText = value.slice(sourceOffset, match.index);
    decoded += precedingText;
    for (let index = sourceOffset; index < match.index; index += 1) {
      sourceOffsets.push(index);
    }

    const reference = match[0];
    const numericMatch = reference.match(/^&#(?:[xX]([\da-fA-F]+)|(\d+));$/);
    const namedReference = reference.slice(1, -1);
    let replacement = Object.hasOwn(htmlCharacterReferences, namedReference)
      ? htmlCharacterReferences[namedReference]
      : undefined;
    if (numericMatch) {
      let codePoint = Number.parseInt(
        numericMatch[1] ?? numericMatch[2],
        numericMatch[1] ? 16 : 10,
      );
      if (
        codePoint === 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        codePoint = 0xfffd;
      } else if (codePoint >= 0x80 && codePoint <= 0x9f) {
        codePoint = [
          0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6,
          0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019,
          0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a,
          0x153, 0x9d, 0x17e, 0x178,
        ][codePoint - 0x80];
      }
      replacement = String.fromCodePoint(codePoint);
    }

    if (replacement === undefined) {
      decoded += reference;
      for (let index = 0; index < reference.length; index += 1) {
        sourceOffsets.push(match.index + index);
      }
    } else {
      decoded += replacement;
      for (let index = 0; index < replacement.length; index += 1) {
        sourceOffsets.push(match.index);
      }
    }
    sourceOffset = match.index + reference.length;
  }

  const trailingText = value.slice(sourceOffset);
  decoded += trailingText;
  for (let index = sourceOffset; index < value.length; index += 1) {
    sourceOffsets.push(index);
  }

  return { value: decoded, sourceOffsets };
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

function stripJavaScriptComments(source) {
  const result = source.split("");
  const contexts = [{ type: "code", templateExpression: false, braceDepth: 0 }];
  const maskComment = (start, end) => {
    for (let index = start; index < end; index += 1) {
      if (source[index] !== "\n" && source[index] !== "\r") result[index] = " ";
    }
  };

  let index = 0;
  while (index < source.length) {
    const context = contexts.at(-1);
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (context.type === "template") {
      if (character === "\\") {
        index += 2;
      } else if (character === "`") {
        contexts.pop();
        index += 1;
      } else if (character === "$" && nextCharacter === "{") {
        contexts.push({
          type: "code",
          templateExpression: true,
          braceDepth: 0,
        });
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      const quote = character;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
        } else if (source[index] === quote) {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }

    if (character === "`") {
      contexts.push({ type: "template" });
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      const start = index;
      index += 2;
      while (
        index < source.length &&
        source[index] !== "\n" &&
        source[index] !== "\r"
      ) {
        index += 1;
      }
      maskComment(start, index);
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      const start = index;
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1;
      }
      index = Math.min(source.length, index + 2);
      maskComment(start, index);
      continue;
    }

    if (context.templateExpression) {
      if (character === "{") {
        context.braceDepth += 1;
      } else if (character === "}") {
        if (context.braceDepth === 0) {
          contexts.pop();
        } else {
          context.braceDepth -= 1;
        }
      }
    }
    index += 1;
  }

  return result.join("");
}

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split(/\r\n|\r|\n/).length;
}

export function collectSrcsetURLs(srcset) {
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
  const realOutputDirectory = realpathSync(outputDirectory);

  const references = [
    ...collectHTMLReferences(html),
    ...collectInlineStyleReferences(html),
    ...collectIframeSrcdocReferences(html),
    ...collectBuiltCodeReferences(outputDirectory).filter(
      (reference) =>
        !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(
          reference.resolvedUrl ?? reference.url,
        ),
    ),
    ...collectBuiltSVGReferences(outputDirectory),
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

    if (escapesOutputDirectory || !existsSync(assetPath)) {
      missingReferences.push({ url, source });
      continue;
    }

    try {
      if (!statSync(assetPath).isFile()) {
        missingReferences.push({ url, source });
        continue;
      }

      const realAssetPath = realpathSync(assetPath);
      const realRelativePath = relative(realOutputDirectory, realAssetPath);
      if (
        realRelativePath === ".." ||
        realRelativePath.startsWith(`..${sep}`)
      ) {
        missingReferences.push({ url, source });
      }
    } catch {
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
    source.startsWith("index.html")
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
