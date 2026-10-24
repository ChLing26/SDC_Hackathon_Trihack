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
const assetURLCapturePattern = String.raw`((?:[a-z][a-z\d+.-]*:)?(?://)?(?:/|\.\.?/)?[^"'\x60\s()<>;,]+?\.(?:${assetExtensions})(?:[?#][^"'\x60\s()<>;,]*)?)`;
const quotedAssetReferencePattern = new RegExp(
  String.raw`["'\x60]${assetURLCapturePattern}["'\x60]`,
  "gi",
);
const quotedLocalURLPattern =
  /(["'\x60])((?:\/|\.\.?\/)[^"'\x60\s()<>;,]+)\1/g;
const directMediaURLAssignmentPattern =
  /(?:\.\s*(?:src|poster)\s*=\s*|\.setAttribute\s*\(\s*["'](?:src|poster)["']\s*,\s*|(?:src|poster)\s*:\s*)(?:new\s+URL\s*\(\s*)?$/i;
const directSrcsetAssignmentPattern =
  /(?:\.\s*srcset\s*=\s*|\.setAttribute\s*\(\s*["']srcset["']\s*,\s*|["']srcset["']\s*:\s*)$/i;
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

function collectBuiltCodeReferences(outputDirectory, basePath) {
  const references = [];
  const pendingDirectories = [outputDirectory];
  const realOutputDirectory = realpathSync(outputDirectory);

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }

      if (!/\.(?:m?js|css)$/i.test(entry.name)) continue;
      if (!entry.isFile()) {
        if (!entry.isSymbolicLink()) continue;

        try {
          const realEntryPath = realpathSync(entryPath);
          const relativeEntryPath = relative(
            realOutputDirectory,
            realEntryPath,
          );
          if (
            relativeEntryPath === ".." ||
            relativeEntryPath.startsWith(`..${sep}`) ||
            !statSync(realEntryPath).isFile()
          ) {
            continue;
          }
        } catch {
          continue;
        }
      }

      const source = relative(outputDirectory, entryPath).split(sep).join("/");
      const rawContent = readFileSync(entryPath, "utf8");
      const isStylesheet = /\.css$/i.test(entry.name);
      const content = isStylesheet
        ? stripCssComments(rawContent)
        : stripJavaScriptComments(rawContent);
      const seenUrls = new Set();
      const embeddedDocuments = isStylesheet
        ? []
        : collectStaticJavaScriptSrcdoc(content, source);
      const javaScriptStringReferences = isStylesheet
        ? { references: [], ranges: [] }
        : collectJavaScriptStringAssetReferences(content);

      if (isStylesheet) {
        for (const match of content.matchAll(cssUrlReferencePattern)) {
          const reference = createCssURLReference(match, source);
          if (!reference || seenUrls.has(reference.url)) continue;
          seenUrls.add(reference.url);
          references.push(reference);
        }
      }

      for (const match of content.matchAll(quotedAssetReferencePattern)) {
        if (
          javaScriptStringReferences.ranges.some(
            ({ start, end }) => match.index >= start && match.index < end,
          )
        ) {
          continue;
        }
        if (
          embeddedDocuments.some(
            (document) =>
              match.index >= document.start && match.index < document.end,
          )
        ) {
          continue;
        }
        if (seenUrls.has(match[1])) continue;
        seenUrls.add(match[1]);
        references.push({ url: match[1], source });
      }

      for (const reference of javaScriptStringReferences.references) {
        if (
          embeddedDocuments.some(
            (document) =>
              reference.index >= document.start &&
              reference.index < document.end,
          ) ||
          seenUrls.has(reference.url)
        ) {
          continue;
        }
        seenUrls.add(reference.url);
        references.push({ url: reference.url, source });
      }

      if (!isStylesheet) {
        for (const match of content.matchAll(quotedLocalURLPattern)) {
          const url = match[2];
          if (
            embeddedDocuments.some(
              (document) =>
                match.index >= document.start && match.index < document.end,
            ) ||
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

        const resolveFrom = new URL(basePath, "http://preview.local").href;
        for (const document of embeddedDocuments) {
          references.push(
            ...collectHTMLReferences(
              document.html,
              document.source,
              resolveFrom,
            ),
            ...collectInlineStyleReferences(
              document.html,
              document.source,
              resolveFrom,
            ),
            ...collectIframeSrcdocReferences(
              document.html,
              document.source,
              resolveFrom,
            ),
          );
        }
      }
    }
  }

  return references;
}

function collectJavaScriptStringAssetReferences(source) {
  const references = [];
  const ranges = [];
  const stringPattern =
    /(["'\x60])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g;
  const staticStringBindings = collectStaticJavaScriptStringBindings(source);

  for (const literal of source.matchAll(stringPattern)) {
    // An interpolated template can contain runtime values, so keep its
    // existing raw-text handling rather than treating it as a static URL.
    if (literal[1] === "`" && literal[2].includes("${")) continue;

    ranges.push({
      start: literal.index,
      end: literal.index + literal[0].length,
    });

    const decodedValue = decodeJavaScriptString(literal[2]);
    for (const match of decodedValue.matchAll(
      new RegExp(assetURLCapturePattern, "gi"),
    )) {
      references.push({ url: match[1], index: literal.index });
    }

    if (
      directSrcsetAssignmentPattern.test(
        source.slice(Math.max(0, literal.index - 120), literal.index),
      )
    ) {
      for (const url of collectSrcsetURLs(decodedValue)) {
        if (
          isExtensionlessMediaURL(url) &&
          isSrcsetImageDirectoryURL(url) &&
          !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)
        ) {
          references.push({ url, index: literal.index });
        }
      }
    }
  }

  const constructedReferences = collectConstructedJavaScriptMediaReferences(
    source,
    staticStringBindings,
  );
  const constructedStringRanges = [
    ...constructedReferences.flatMap(({ literalRanges }) => literalRanges),
    ...collectNonMediaConstructedStringRanges(source, staticStringBindings),
  ];
  references.push(...constructedReferences);

  return {
    references: references.filter(
      (reference) =>
        !constructedStringRanges.some(
          ({ start, end }) => reference.index >= start && reference.index < end,
        ),
    ),
    ranges,
  };
}

function collectStaticJavaScriptStringBindings(source) {
  const bindings = new Map();
  const declarationNames = new Set();
  const codeMask = maskJavaScriptLiterals(source);
  const declarationPattern = /\bconst\s+([$A-Z_a-z][$\w]*)\s*=/g;

  for (const declaration of codeMask.matchAll(declarationPattern)) {
    const name = declaration[1];
    if (declarationNames.has(name)) {
      bindings.delete(name);
      continue;
    }
    declarationNames.add(name);

    let expressionStart = declaration.index + declaration[0].length;
    while (
      /\s/.test(source[expressionStart] ?? "") &&
      expressionStart < source.length
    ) {
      expressionStart += 1;
    }
    const expression = parseStaticJavaScriptStringExpression(
      source,
      expressionStart,
      bindings,
    );
    if (
      !expression ||
      !isStaticJavaScriptExpressionBoundary(source, expression.end)
    ) {
      continue;
    }
    bindings.set(name, expression);
  }

  return bindings;
}

function collectConstructedJavaScriptMediaReferences(source, bindings) {
  const references = [];
  const codeMask = maskJavaScriptLiterals(source);
  const assignmentPattern =
    /(?:\.\s*(?:src|poster)\s*=\s*|\.\s*setAttribute\s*\(\s*["'](?:src|poster)["']\s*,\s*|\b(?:src|poster)\s*:\s*)/gi;

  for (const assignment of source.matchAll(assignmentPattern)) {
    if (codeMask[assignment.index] === " ") continue;

    const expressionStart = assignment.index + assignment[0].length;
    const expression = parseStaticJavaScriptStringExpression(
      source,
      expressionStart,
      bindings,
    );
    if (
      !expression ||
      !isStaticJavaScriptExpressionBoundary(source, expression.end) ||
      !isConstructedMediaURL(expression.value)
    ) {
      continue;
    }

    references.push({
      url: expression.value,
      index: assignment.index,
      literalRanges: expression.literalRanges,
    });
  }

  return references;
}

function collectNonMediaConstructedStringRanges(source, bindings) {
  const ranges = [];

  for (const binding of bindings.values()) {
    if (binding.literalRanges.length > 1 && isJavaScriptAPIURL(binding.value)) {
      ranges.push(...binding.literalRanges);
    }
  }

  const codeMask = maskJavaScriptLiterals(source);
  const nonMediaURLPatterns = [
    /\b(?:window\.)?location(?:\.(?:href|pathname))?\s*=\s*/gi,
    /\b(?:window\.)?location\.(?:assign|replace)\s*\(\s*/gi,
    /\b(?:window\.)?open\s*\(\s*/gi,
    /\b(?:router\.)?(?:navigate|push|replace|redirect)\s*\(\s*/gi,
    /\bhistory\.(?:pushState|replaceState)\s*\(\s*[^,]*,\s*[^,]*,\s*/gi,
    /\bfetch\s*\(\s*/gi,
    /\baxios\.(?:get|post|put|patch|delete)\s*\(\s*/gi,
  ];

  for (const pattern of nonMediaURLPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (codeMask[match.index] === " ") continue;
      const expression = parseStaticJavaScriptStringExpression(
        source,
        match.index + match[0].length,
        bindings,
      );
      if (
        !expression ||
        !isStaticJavaScriptExpressionBoundary(source, expression.end) ||
        expression.literalRanges.length < 2
      ) {
        continue;
      }
      if (
        isJavaScriptAPIURL(expression.value) ||
        (/^(?:\/|\.{1,2}\/)/.test(expression.value) &&
          !isConstructedMediaURL(expression.value))
      ) {
        ranges.push(...expression.literalRanges);
      }
    }
  }

  return ranges;
}

function parseStaticJavaScriptStringExpression(source, start, bindings) {
  let position = start;
  const skipWhitespace = () => {
    while (/\s/.test(source[position] ?? "") && position < source.length) {
      position += 1;
    }
  };

  const parsePrimary = () => {
    skipWhitespace();
    const character = source[position];

    if (character === "'" || character === '"') {
      const literal = parseStaticJavaScriptString(source, position);
      if (!literal) return null;
      const start = position;
      position = literal.end;
      return {
        value: literal.value,
        literalRanges: [{ start, end: position }],
      };
    }

    if (character === "`") {
      const literal = parseStaticJavaScriptTemplate(source, position, bindings);
      if (!literal) return null;
      position = literal.end;
      return literal;
    }

    if (character === "(") {
      position += 1;
      const nested = parseExpression();
      if (nested === null) return null;
      skipWhitespace();
      if (source[position] !== ")") return null;
      position += 1;
      return nested;
    }

    const identifier = source.slice(position).match(/^[$A-Z_a-z][$\w]*/)?.[0];
    if (!identifier || !bindings.has(identifier)) return null;
    position += identifier.length;
    const binding = bindings.get(identifier);
    return {
      value: binding.value,
      literalRanges: binding.literalRanges,
    };
  };

  const parseExpression = () => {
    let result = parsePrimary();
    if (result === null) return null;

    while (true) {
      skipWhitespace();
      if (source[position] !== "+") return result;
      position += 1;
      const next = parsePrimary();
      if (next === null) return null;
      result = {
        value: result.value + next.value,
        literalRanges: [...result.literalRanges, ...next.literalRanges],
      };
    }
  };

  const expression = parseExpression();
  return expression === null ? null : { ...expression, end: position };
}

function parseStaticJavaScriptTemplate(source, start, bindings) {
  let position = start + 1;
  let chunkStart = position;
  let value = "";
  const literalRanges = [];

  while (position < source.length) {
    if (source[position] === "\\") {
      position += 2;
      continue;
    }
    if (source[position] === "`") {
      value += decodeJavaScriptString(source.slice(chunkStart, position));
      return {
        value,
        end: position + 1,
        literalRanges: [{ start, end: position + 1 }, ...literalRanges],
      };
    }
    if (source[position] === "$" && source[position + 1] === "{") {
      value += decodeJavaScriptString(source.slice(chunkStart, position));
      const expression = parseStaticJavaScriptStringExpression(
        source,
        position + 2,
        bindings,
      );
      if (!expression) return null;
      position = expression.end;
      while (/\s/.test(source[position] ?? "") && position < source.length) {
        position += 1;
      }
      if (source[position] !== "}") return null;
      value += expression.value;
      literalRanges.push(...expression.literalRanges);
      position += 1;
      chunkStart = position;
      continue;
    }
    position += 1;
  }

  return null;
}

function isJavaScriptAPIURL(url) {
  try {
    return /(?:^|\/)api(?:\/|$)/i.test(
      new URL(url, "http://preview.local/").pathname,
    );
  } catch {
    return false;
  }
}

function isStaticJavaScriptExpressionBoundary(source, end) {
  let position = end;
  let crossedLineBreak = false;
  while (/\s/.test(source[position] ?? "") && position < source.length) {
    if (source[position] === "\n" || source[position] === "\r") {
      crossedLineBreak = true;
    }
    position += 1;
  }

  if (position >= source.length || /[;,)}\]]/.test(source[position])) {
    return true;
  }
  return crossedLineBreak && !/[.+\-*/%&|?=<>]/.test(source[position]);
}

function isConstructedMediaURL(url) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) return false;

  try {
    const pathname = new URL(url, "http://preview.local/").pathname;
    if (/(?:^|\/)api(?:\/|$)/i.test(pathname)) return false;
    if (
      !/(?:^|\/)(?:assets|media|images?|img|audio|video|icons?)(?:\/|$)/i.test(
        pathname,
      )
    ) {
      return false;
    }

    const filename = pathname.slice(pathname.lastIndexOf("/") + 1);
    if (!filename) return false;
    if (!filename.includes(".")) return true;
    return /\.(?:png|jpe?g|gif|svg|webp|avif|ico|mp3|mp4|m4a|m4v|mov|webm|wav|ogg|oga|opus|aac|flac|aiff?|avi|mpeg|mpg|3gp)$/i.test(
      filename,
    );
  } catch {
    return false;
  }
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

function isSrcsetImageDirectoryURL(url) {
  try {
    const pathname = new URL(url, "http://preview.local/").pathname;
    return (
      !/(?:^|\/)api(?:\/|$)/i.test(pathname) &&
      /(?:^|\/)(?:assets|media|images?|img)(?:\/|$)/i.test(pathname)
    );
  } catch {
    return false;
  }
}

function collectHTMLReferences(html, sourcePrefix, resolveFrom) {
  const references = [];
  const tagPattern = /<([a-z][a-z\d:-]*)\b([^>]*)>/gi;
  const attributePattern =
    /\b(src|href|srcset|imagesrcset|poster|data)\s*=\s*["']([^"']+)["']/gi;

  for (const tagMatch of html.matchAll(tagPattern)) {
    const element = tagMatch[1].toLowerCase();
    const tagAttributes = tagMatch[2];
    for (const match of tagAttributes.matchAll(attributePattern)) {
      const attribute = match[1].toLowerCase();
      const decodedValue = decodeHtmlCharacterReferences(match[2]).value;
      const urls =
        attribute === "srcset" || attribute === "imagesrcset"
          ? collectSrcsetURLs(decodedValue)
          : [decodedValue];

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
          ...(resolveFrom ? { resolveFrom } : {}),
        });
      }
    }

    if (
      element === "object" &&
      isMediaResourceAttribute(element, "data", tagAttributes)
    ) {
      const unquotedDataPattern = /(?:^|\s)data\s*=\s*([^\s"'`=<>]+)/gi;
      for (const match of tagAttributes.matchAll(unquotedDataPattern)) {
        const url = decodeHtmlCharacterReferences(match[1]).value;
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;

        const attributeOffset =
          tagMatch.index +
          tagMatch[0].indexOf(tagAttributes) +
          match.index +
          match[0].lastIndexOf(match[1]);
        references.push({
          url,
          source: `${sourcePrefix ?? "index.html"}:${lineNumberAt(html, attributeOffset)} ${element}[data]`,
          ...(resolveFrom ? { resolveFrom } : {}),
        });
      }
    }
  }

  return references;
}

function collectIframeSrcdocReferences(
  html,
  documentSource = "index.html",
  resolveFrom,
) {
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
      ...collectHTMLReferences(embeddedHtml, iframeSource, resolveFrom),
      ...collectInlineStyleReferences(embeddedHtml, iframeSource, resolveFrom),
      ...collectIframeSrcdocReferences(
        embeddedHtml,
        iframeSource,
        resolveFrom,
      ),
    );
  }

  return references;
}

function collectStaticJavaScriptSrcdoc(source, codeSource) {
  const codeMask = maskJavaScriptLiterals(source);
  const assignmentPatterns = [
    /(?:\.\s*srcdoc\s*=\s*|\[\s*["']srcdoc["']\s*\]\s*=\s*)/gi,
    /\.\s*setAttribute\s*\(\s*["']srcdoc["']\s*,\s*/gi,
  ];
  const documents = [];
  const seenAssignments = new Set();

  for (const pattern of assignmentPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (
        seenAssignments.has(match.index) ||
        /\s/.test(codeMask[match.index] ?? " ")
      ) {
        continue;
      }
      seenAssignments.add(match.index);

      const valueStart = match.index + match[0].length;
      const literal = parseStaticJavaScriptString(source, valueStart);
      if (!literal) continue;

      const line = lineNumberAt(source, match.index);
      documents.push({
        html: literal.value,
        start: valueStart,
        end: literal.end,
        source: `${codeSource}:${line} iframe[srcdoc]`,
      });
    }
  }

  return documents;
}

function maskJavaScriptLiterals(source) {
  const result = source.split("");
  const mask = (start, end) => {
    for (let index = start; index < end; index += 1) {
      if (source[index] !== "\n" && source[index] !== "\r") result[index] = " ";
    }
  };

  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === "'" || character === '"') {
      const quote = character;
      const start = index;
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
      mask(start, Math.min(index, source.length));
    } else if (character === "`") {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
        } else if (source[index] === "`") {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      mask(start, Math.min(index, source.length));
    } else {
      index += 1;
    }
  }

  return result.join("");
}

function parseStaticJavaScriptString(source, start) {
  let position = start;
  while (/\s/.test(source[position] ?? "") && position < source.length) {
    position += 1;
  }

  const quote = source[position];
  if (quote !== "'" && quote !== '"' && quote !== "`") return null;

  const contentStart = position + 1;
  position = contentStart;
  while (position < source.length) {
    if (source[position] === "\\") {
      position += 2;
    } else if (
      quote === "`" &&
      source[position] === "$" &&
      source[position + 1] === "{"
    ) {
      return null;
    } else if (source[position] === quote) {
      return {
        value: decodeJavaScriptString(source.slice(contentStart, position)),
        end: position + 1,
      };
    } else if (
      quote !== "`" &&
      (source[position] === "\n" || source[position] === "\r")
    ) {
      return null;
    } else {
      position += 1;
    }
  }

  return null;
}

function decodeJavaScriptString(value) {
  const simpleEscapes = {
    0: "\0",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
  };
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "\\") {
      decoded += value[index];
      continue;
    }

    const escaped = value[++index];
    if (escaped === undefined) break;
    if (escaped === "\n") continue;
    if (escaped === "\r") {
      if (value[index + 1] === "\n") index += 1;
      continue;
    }

    if (Object.hasOwn(simpleEscapes, escaped)) {
      decoded += simpleEscapes[escaped];
    } else if (
      escaped === "x" &&
      /^[\da-fA-F]{2}$/.test(value.slice(index + 1, index + 3))
    ) {
      decoded += String.fromCharCode(
        Number.parseInt(value.slice(index + 1, index + 3), 16),
      );
      index += 2;
    } else if (escaped === "u") {
      const bracedUnicode = value.slice(index + 1).match(/^\{([\da-fA-F]+)\}/);
      if (bracedUnicode) {
        const codePoint = Number.parseInt(bracedUnicode[1], 16);
        if (codePoint <= 0x10ffff) decoded += String.fromCodePoint(codePoint);
        else decoded += "\ufffd";
        index += bracedUnicode[0].length;
      } else {
        const unicode = value.slice(index + 1, index + 5);
        if (/^[\da-fA-F]{4}$/.test(unicode)) {
          decoded += String.fromCharCode(Number.parseInt(unicode, 16));
          index += 4;
        } else {
          decoded += "u";
        }
      }
    } else {
      decoded += escaped;
    }
  }
  return decoded;
}

function collectIframePageReferences(
  html,
  { outputDirectory, basePath },
) {
  const references = [];
  const pendingDocuments = [
    {
      html,
      source: "index.html",
      url: new URL(basePath, "http://preview.local"),
      includeReferences: false,
    },
  ];
  const visitedDocuments = new Set([resolve(outputDirectory, "index.html")]);

  while (pendingDocuments.length > 0) {
    const document = pendingDocuments.pop();
    if (document.includeReferences) {
      references.push(
        ...collectHTMLReferences(
          document.html,
          document.source,
          document.url.href,
        ),
        ...collectInlineStyleReferences(
          document.html,
          document.source,
          document.url.href,
        ),
        ...collectIframeSrcdocReferences(
          document.html,
          document.source,
          document.url.href,
        ),
      );
    }

    for (const match of document.html.matchAll(/<iframe\b/gi)) {
      const tagStart = match.index;
      let quote;
      let tagEnd = tagStart + match[0].length;

      for (; tagEnd < document.html.length; tagEnd += 1) {
        const character = document.html[tagEnd];
        if (quote) {
          if (character === quote) quote = undefined;
        } else if (character === '"' || character === "'") {
          quote = character;
        } else if (character === ">") {
          break;
        }
      }
      if (tagEnd >= document.html.length) continue;

      const tag = document.html.slice(tagStart, tagEnd + 1);
      const srcMatch = tag.match(
        /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/i,
      );
      if (!srcMatch) continue;

      const url = decodeHtmlCharacterReferences(
        srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? "",
      ).value;
      if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;

      let pageURL;
      try {
        pageURL = new URL(url, document.url);
      } catch {
        continue;
      }
      if (pageURL.origin !== "http://preview.local") continue;
      const isHTMLPage =
        /\.html?$/i.test(pageURL.pathname) || pageURL.pathname.endsWith("/");
      if (!isHTMLPage) continue;

      const source =
        `${document.source}:${lineNumberAt(document.html, tagStart)} iframe[src]`;
      const reference = { url, source, resolveFrom: document.url.href };
      references.push(reference);

      if (!pageURL.pathname.startsWith(basePath)) continue;

      let decodedPath;
      try {
        decodedPath = decodeURIComponent(pageURL.pathname);
      } catch {
        continue;
      }

      const relativePath = decodedPath.slice(basePath.length);
      let pagePath = resolve(outputDirectory, relativePath);
      if (pageURL.pathname.endsWith("/")) {
        pagePath = resolve(pagePath, "index.html");
      }
      const relativePagePath = relative(outputDirectory, pagePath);
      if (
        relativePagePath === ".." ||
        relativePagePath.startsWith(`..${sep}`) ||
        resolve(outputDirectory, relativePagePath) !== pagePath ||
        !existsSync(pagePath)
      ) {
        continue;
      }

      try {
        if (!statSync(pagePath).isFile()) continue;
        const realPagePath = realpathSync(pagePath);
        const realRelativePagePath = relative(
          realpathSync(outputDirectory),
          realPagePath,
        );
        if (
          realRelativePagePath === ".." ||
          realRelativePagePath.startsWith(`..${sep}`)
        ) {
          continue;
        }
      } catch {
        continue;
      }

      const documentKey = resolve(pagePath);
      if (visitedDocuments.has(documentKey)) continue;
      visitedDocuments.add(documentKey);
      pendingDocuments.push({
        html: readFileSync(pagePath, "utf8"),
        source: `iframe page ${relativePagePath.split(sep).join("/")}`,
        url: pageURL,
        includeReferences: true,
      });
    }
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

function collectInlineStyleReferences(html, sourcePrefix, resolveFrom) {
  const references = [];
  const styleAttributePattern =
    /\sstyle\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|([^\s"'`=<>]+))/gi;
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
      references.push(resolveFrom ? { ...reference, resolveFrom } : reference);
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
        ...(resolveFrom ? { resolveFrom } : {}),
      });
    }
  }

  for (const match of html.matchAll(styleAttributePattern)) {
    const style = match[1] ?? match[2] ?? match[3];
    const styleOffset = match.index + match[0].indexOf(style);
    addStyleReferences(style, styleOffset);
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
  const expressionPrefixKeywords = new Set([
    "await",
    "case",
    "delete",
    "do",
    "else",
    "in",
    "instanceof",
    "new",
    "of",
    "return",
    "throw",
    "typeof",
    "void",
    "yield",
  ]);
  const controlStatementKeywords = new Set([
    "catch",
    "for",
    "if",
    "switch",
    "while",
    "with",
  ]);
  const maskComment = (start, end) => {
    for (let index = start; index < end; index += 1) {
      if (source[index] !== "\n" && source[index] !== "\r") result[index] = " ";
    }
  };
  const skipRegularExpression = (start) => {
    let inCharacterClass = false;
    for (let cursor = start + 1; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (character === "\n" || character === "\r") return start + 1;
      if (character === "\\") {
        cursor += 1;
      } else if (character === "[") {
        inCharacterClass = true;
      } else if (character === "]") {
        inCharacterClass = false;
      } else if (character === "/" && !inCharacterClass) {
        cursor += 1;
        while (/[a-z]/i.test(source[cursor] ?? "")) cursor += 1;
        return cursor;
      }
    }
    return start + 1;
  };

  let index = 0;
  let canStartRegularExpression = true;
  let pendingControlParen = false;
  const parenContexts = [];
  while (index < source.length) {
    const context = contexts.at(-1);
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (context.type === "template") {
      if (character === "\\") {
        index += 2;
      } else if (character === "`") {
        contexts.pop();
        canStartRegularExpression = false;
        index += 1;
      } else if (character === "$" && nextCharacter === "{") {
        contexts.push({
          type: "code",
          templateExpression: true,
          braceDepth: 0,
        });
        canStartRegularExpression = true;
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
      canStartRegularExpression = false;
      pendingControlParen = false;
      continue;
    }

    if (character === "`") {
      contexts.push({ type: "template" });
      canStartRegularExpression = false;
      pendingControlParen = false;
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

    if (character === "/" && canStartRegularExpression) {
      const expressionEnd = skipRegularExpression(index);
      if (expressionEnd > index + 1) {
        maskComment(index, expressionEnd);
        index = expressionEnd;
        canStartRegularExpression = false;
        pendingControlParen = false;
        continue;
      }
    }

    if (/[a-z_$]/i.test(character) || character.charCodeAt(0) > 0x7f) {
      const start = index;
      index += 1;
      while (index < source.length && /[\w$]/.test(source[index])) index += 1;
      const identifier = source.slice(start, index);
      canStartRegularExpression = expressionPrefixKeywords.has(identifier);
      pendingControlParen = controlStatementKeywords.has(identifier);
      continue;
    }

    if (/\d/.test(character)) {
      index += 1;
      while (index < source.length && /[\w.]/.test(source[index])) index += 1;
      canStartRegularExpression = false;
      pendingControlParen = false;
      continue;
    }

    if (context.templateExpression) {
      if (character === "{") {
        context.braceDepth += 1;
      } else if (character === "}") {
        if (context.braceDepth === 0) {
          contexts.pop();
          canStartRegularExpression = false;
        } else {
          context.braceDepth -= 1;
        }
      }
    }

    if (character === "(") {
      parenContexts.push(pendingControlParen);
      pendingControlParen = false;
      canStartRegularExpression = true;
    } else if (character === ")") {
      canStartRegularExpression = parenContexts.pop() ?? false;
      pendingControlParen = false;
    } else if (character === "]" || character === "}") {
      canStartRegularExpression = false;
      pendingControlParen = false;
    } else if (character === ".") {
      if (source.slice(index, index + 3) === "...") {
        canStartRegularExpression = true;
        pendingControlParen = false;
        index += 3;
        continue;
      }
      canStartRegularExpression = false;
      pendingControlParen = false;
    } else if (/[({[,:;?=+\-*%&|^~<>!]/.test(character)) {
      canStartRegularExpression = true;
      pendingControlParen = false;
    } else if (character === "/") {
      canStartRegularExpression = true;
      pendingControlParen = false;
      if (nextCharacter === "=") index += 1;
    } else if (!/\s/.test(character)) {
      pendingControlParen = false;
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

export function collectBuiltWasmReferences(outputDirectory) {
  return collectBuiltCodeReferences(outputDirectory, "/").filter(
    ({ source, url, resolvedUrl }) =>
      /\.m?js$/i.test(source) &&
      /\.wasm(?:[?#]|$)/i.test(resolvedUrl ?? url) &&
      !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(resolvedUrl ?? url),
  );
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
    ...collectIframePageReferences(html, {
      outputDirectory,
      basePath,
      documentURL: new URL(basePath, "http://preview.local").href,
    }),
    ...collectBuiltCodeReferences(outputDirectory, basePath).filter(
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
  const outsideOutputReferences = [];
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

    if (escapesOutputDirectory) {
      outsideOutputReferences.push({ url, source });
      continue;
    }

    if (!existsSync(assetPath)) {
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
        outsideOutputReferences.push({ url, source });
      }
    } catch {
      missingReferences.push({ url, source });
    }
  }

  const assetErrors = [];
  if (outsideOutputReferences.length > 0) {
    assetErrors.push(
      `${app.name} build output references files outside its output directory: ${outsideOutputReferences.map(formatReference).join(", ")}`,
    );
  }
  if (missingReferences.length > 0) {
    assetErrors.push(
      `${app.name} build output is missing file${missingReferences.length === 1 ? "" : "s"} referenced by URL${missingReferences.length === 1 ? "" : "s"}: ${missingReferences.map(formatReference).join(", ")}`,
    );
  }
  if (assetErrors.length > 0) {
    throw new Error(assetErrors.join(" "));
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

function resolveReferenceURL(
  { url, resolvedUrl, source, resolveFrom },
  basePath,
) {
  const referenceUrl = resolvedUrl ?? url;
  const sourceBase = resolveFrom ??
    (source.startsWith("index.html")
      ? `http://preview.local${basePath}`
      : `http://preview.local${basePath}${source}`);
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
