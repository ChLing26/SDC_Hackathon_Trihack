import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, describe, it } from "node:test";

import { checkAssetPaths } from "./check-vite-asset-paths.mjs";

const tempRoot = mkdtempSync(join(tmpdir(), "vite-asset-path-tests-"));
after(() => rmSync(tempRoot, { recursive: true, force: true }));

function createApp({ name = "ProcureFlow", basePath = "/preview/", html }) {
  const artifactDirectory = join(tempRoot, name);
  const outputDirectory = join(artifactDirectory, "dist");
  const manifestPath = join(artifactDirectory, "artifact.toml");
  const indexPath = join(outputDirectory, "index.html");

  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    manifestPath,
    `previewPath = "${basePath.slice(0, -1)}"

[services.env]
BASE_PATH = "${basePath.slice(0, -1)}"
`,
  );
  writeFileSync(indexPath, html);

  return {
    app: {
      name,
      manifestPath: manifestPath.slice(tempRoot.length + 1),
      indexPath: indexPath.slice(tempRoot.length + 1),
    },
    outputDirectory,
  };
}

describe("Vite preview asset paths", () => {
  it("accepts prefixed HTML asset URLs when their files exist in the build output", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script><link href="/preview/favicon.svg">',
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");
    writeFileSync(join(outputDirectory, "favicon.svg"), "");
    const messages = [];

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: (message) => messages.push(message) }),
    );
    assert.match(messages[0], /ProcureFlow/);
    assert.match(messages[0], /exist in the build output/);
  });

  it("checks comma-separated srcset and imagesrcset candidates while ignoring external and data URLs", () => {
    const { app, outputDirectory } = createApp({
      html: `
        <script src="/preview/assets/app.js"></script>
        <img srcset="/preview/assets/small.webp 1x, /preview/assets/large.webp 2x, https://cdn.example.test/image.webp 3x, data:image/png;base64,AAAA 4x">
        <link imagesrcset="/preview/assets/preload-small.webp 1x, /preview/assets/preload-large.webp 2x">
      `,
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    for (const file of [
      "app.js",
      "small.webp",
      "large.webp",
      "preload-small.webp",
      "preload-large.webp",
    ]) {
      writeFileSync(join(assetsDirectory, file), "");
    }

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("checks local assets in HTML style attributes and style blocks while ignoring external and data URLs", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<div style="background-image: url('/preview/assets/inline.webp'); mask-image: url(https://cdn.example.test/mask.svg); border-image: url(data:image/svg+xml;base64,AAAA)"></div>
<style>
@import "/preview/assets/theme.css";
@import "https://cdn.example.test/external.css";
.hero { background-image: url("/preview/assets/block.svg"); }
</style>`,
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    for (const file of ["app.js", "inline.webp", "theme.css", "block.svg"]) {
      writeFileSync(join(assetsDirectory, file), "");
    }

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing inline-style assets with their HTML line and URL", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<div style="background: url('/preview/assets/missing-inline.webp')"></div>
<style>
@import "/preview/assets/missing-import.css";
.hero { background: url('/preview/assets/missing-block.svg'); }
</style>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /"\/preview\/assets\/missing-inline\.webp" in index\.html:2/);
        assert.match(error.message, /"\/preview\/assets\/missing-import\.css" in index\.html:4/);
        assert.match(error.message, /"\/preview\/assets\/missing-block\.svg" in index\.html:5/);
        return true;
      },
    );
  });

  it("reports wrong base paths in inline styles with their HTML source location and URL", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<style>.hero { background: url("/assets/wrong-prefix.svg"); }</style>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /configured base path "\/preview\/"/);
        assert.match(error.message, /"\/assets\/wrong-prefix\.svg" in index\.html:2/);
        return true;
      },
    );
  });

  it("reports a missing media poster with the app name and offending URL", () => {
    const { app, outputDirectory } = createApp({
      name: "Canvas",
      basePath: "/__mockup/",
      html: '<script src="/__mockup/assets/app.js"></script><video poster="/__mockup/assets/missing-poster.webp"></video>',
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      /Canvas build output is missing file referenced by URL: "\/__mockup\/assets\/missing-poster\.webp"/,
    );
  });

  it("names the app and missing URL when a referenced file was not emitted", () => {
    const { app } = createApp({
      name: "Canvas",
      basePath: "/__mockup/",
      html: '<script src="/__mockup/assets/missing.js"></script>',
    });

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      /Canvas build output is missing file referenced by URL: "\/__mockup\/assets\/missing\.js"/,
    );
  });

  it("rejects references that escape the app build output", () => {
    const { app } = createApp({
      html: '<script src="/preview/assets/%2e%2e/%2e%2e/outside.js"></script>',
    });

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /\/preview\/assets\/%2e%2e\/%2e%2e\/outside\.js/);
        assert.match(
          error.message,
          /do not use configured base path|build output is missing file/,
        );
        return true;
      },
    );
  });

  it("checks lazy-loaded JavaScript and CSS asset URLs", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      'import("./lazy.js"); import("/preview/assets/secondary.js");',
    );
    writeFileSync(join(assetsDirectory, "lazy.js"), "");
    writeFileSync(join(assetsDirectory, "secondary.js"), "");
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      '@font-face{src:url("/preview/assets/font.woff2")} .hero{background:url(/preview/assets/hero.svg)}',
    );
    writeFileSync(join(assetsDirectory, "font.woff2"), "");
    writeFileSync(join(assetsDirectory, "hero.svg"), "");
    const messages = [];

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: (message) => messages.push(message) }),
    );
    assert.match(messages[0], /use configured prefix/);
  });

  it("accepts present local images and fonts referenced by linked CSS", () => {
    const { app, outputDirectory } = createApp({
      html: '<link rel="stylesheet" href="/preview/assets/styles.css"><script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(join(assetsDirectory, "styles.css"), `
      @font-face { src: url("./font.woff2"); }
      .hero { background-image: url("/preview/assets/hero.webp"); }
      .external { background-image: url("https://cdn.example.test/image.svg"); }
      .embedded { background-image: url("data:image/png;base64,AAAA"); }
      .icon { background-image: url(#icon); }
    `);
    writeFileSync(join(assetsDirectory, "font.woff2"), "");
    writeFileSync(join(assetsDirectory, "hero.webp"), "");
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.doesNotThrow(() => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }));
  });

  it("reports the app and URL when a linked CSS asset is missing", () => {
    const { app, outputDirectory } = createApp({
      name: "Canvas",
      basePath: "/__mockup/",
      html: '<link rel="stylesheet" href="/__mockup/assets/styles.css"><script src="/__mockup/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      '@font-face{src:url("./missing-font.woff2")}',
    );
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      /Canvas build output is missing file referenced by URL: "\.\/missing-font\.woff2" in assets\/styles\.css/,
    );
  });

  it("ignores image and font URLs in CSS comments but validates active URLs", () => {
    const { app, outputDirectory } = createApp({
      html: `<link rel="stylesheet" href="/preview/assets/styles.css"><script src="/preview/assets/app.js"></script>
        <div style="background-image: url('/preview/assets/inline.webp'); /* url('/preview/assets/missing-inline.webp') */"></div>
        <style>/* @import "/preview/assets/missing-import.css"; */ .banner { background: url("/preview/assets/banner.webp"); }</style>`,
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    const stylesPath = join(assetsDirectory, "styles.css");
    writeFileSync(
      stylesPath,
      `/*
        .example { background-image: url("/preview/assets/missing-image.webp"); }
        @font-face { src: url("/preview/assets/missing-font.woff2"); }
      */
      .hero { background-image: url("/preview/assets/hero.webp"); }`,
    );
    writeFileSync(join(assetsDirectory, "app.js"), "");
    writeFileSync(join(assetsDirectory, "hero.webp"), "");
    writeFileSync(join(assetsDirectory, "inline.webp"), "");
    writeFileSync(join(assetsDirectory, "banner.webp"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );

    writeFileSync(
      stylesPath,
      '/* url("/preview/assets/missing-comment.webp") */ .hero { background-image: url("/preview/assets/missing-active.webp"); }',
    );
    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      /missing-active\.webp.*assets\/styles\.css/,
    );
  });

  it("reports wrong prefixes in lazy JavaScript chunks and stylesheets", () => {
    for (const { file, content, expectedSource } of [
      {
        file: "lazy.js",
        content: 'import("/assets/lazy.js");',
        expectedSource: /assets\/lazy\.js/,
      },
      {
        file: "styles.css",
        content: ".hero{background:url(/assets/hero.svg)}",
        expectedSource: /assets\/styles\.css/,
      },
    ]) {
      const { app, outputDirectory } = createApp({
        html: '<script src="/preview/assets/app.js"></script>',
      });
      const assetsDirectory = join(outputDirectory, "assets");
      mkdirSync(assetsDirectory, { recursive: true });
      writeFileSync(join(assetsDirectory, "app.js"), "");
      writeFileSync(join(assetsDirectory, file), content);

      assert.throws(
        () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
        (error) => {
          assert.match(error.message, /configured base path "\/preview\/"/);
          assert.match(error.message, expectedSource);
          return true;
        },
      );
    }
  });
});
