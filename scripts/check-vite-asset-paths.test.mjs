import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  it("accepts Vite dependency tables and library strings without inventing asset URLs", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assets = join(outputDirectory, "assets");
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, "app.js"), `
      const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/chunk.js","assets/style.css"])))=>i.map(i=>d[i]);
      import("./chunk.js");
      const userAgent = "Node.js/";
      const viewer = options.pdfJsUrl || "examples/PDF.js/web/viewer.html";
      const pdfImage = "/Image";
      const pdfResources = "/ProcSet [/PDF /Text /ImageB /ImageC /ImageI]";
    `);
    writeFileSync(join(assets, "chunk.js"), "");
    writeFileSync(join(assets, "style.css"), "");
    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("still rejects missing Vite dependency-map chunks and stylesheets", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), `
      const __vite__mapDeps = (i, m = __vite__mapDeps, d = (m.f || (m.f = [
        "assets/missing-chunk.js", "assets/missing-style.css"
      ]))) => i.map(i => d[i]);
    `);
    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /"assets\/missing-chunk\.js" in assets\/app\.js/);
        assert.match(error.message, /"assets\/missing-style\.css" in assets\/app\.js/);
        return true;
      },
    );
  });

  it("keeps ordinary asset references separate from Vite dependency-table URLs", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assets = join(outputDirectory, "assets");
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, "shared.js"), "");
    writeFileSync(join(assets, "app.js"), `
      const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/shared.js"])))=>i.map(i=>d[i]);
      const ordinaryAsset = "assets/shared.js";
      import("./Node.js/missing.wasm");
      const image = document.createElement("img");
      image.src = "./Image";
    `);
    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /"assets\/shared\.js" in assets\/app\.js/);
        assert.match(error.message, /"\.\/Node\.js\/missing\.wasm" in assets\/app\.js/);
        assert.match(error.message, /"\.\/Image" in assets\/app\.js/);
        return true;
      },
    );
  });

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

  it("checks existing extensionless image and media sources without treating navigation links as assets", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
        <img src="/preview/media/brandmark">
        <video poster="/preview/media/poster"><source src="/preview/media/intro"></video>
        <object data="/preview/media/object-image" type="image/png"></object>
        <object data="/preview/media/object-audio" type=audio/mpeg></object>
        <link rel="preload" as="image" href="/preview/media/preloaded">
        <link rel="icon" href="/preview/media/favicon">
        <a href="/preview/products/item">Product details</a>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    mkdirSync(join(outputDirectory, "media"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");
    for (const file of [
      "brandmark",
      "poster",
      "intro",
      "object-image",
      "object-audio",
      "preloaded",
      "favicon",
    ]) {
      writeFileSync(join(outputDirectory, "media", file), "");
    }

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing extensionless image and media sources", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
        <img src="/preview/media/missing-image">
        <audio src="/preview/media/missing-audio"></audio>
        <object data="/preview/media/missing-object-image" type="image/svg+xml"></object>
        <object data="/preview/media/missing-object-video" type='video/mp4'></object>
        <object data="/preview/media/ignored-document" type="application/pdf"></object>
        <link rel="preload" as="image" href="/preview/media/missing-preload">
        <link rel="icon" href="/preview/media/missing-icon">
        <a href="/preview/products/missing-item">Product details</a>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /"\/preview\/media\/missing-image"/);
        assert.match(error.message, /"\/preview\/media\/missing-audio"/);
        assert.match(error.message, /"\/preview\/media\/missing-object-image"/);
        assert.match(error.message, /"\/preview\/media\/missing-object-video"/);
        assert.match(error.message, /"\/preview\/media\/missing-preload"/);
        assert.match(error.message, /"\/preview\/media\/missing-icon"/);
        assert.doesNotMatch(error.message, /ignored-document/);
        assert.doesNotMatch(error.message, /missing-item/);
        return true;
      },
    );
  });

  it("checks existing extensionless unquoted object media resources", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
        <object data=/preview/media/object-image type=image/png></object>
        <object data=/preview/media/object-audio type=audio/mpeg></object>
        <object data=/preview/media/object-video type=video/mp4></object>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    mkdirSync(join(outputDirectory, "media"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");
    for (const file of ["object-image", "object-audio", "object-video"]) {
      writeFileSync(join(outputDirectory, "media", file), "");
    }

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("checks unquoted resource attributes and ignores external and data URLs", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src=/preview/assets/app.js></script>
<link rel=stylesheet href=/preview/assets/site.css>
<img src=/preview/assets/photo.webp srcset=/preview/assets/photo-small.webp>
<link rel=preload as=image imagesrcset=/preview/assets/preload.webp>
<video poster=/preview/media/poster></video>
<img src=https://cdn.example.test/external.webp srcset=data:image/png;base64,AAAA>
<link href=data:text/css,body%7B%7D>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    mkdirSync(join(outputDirectory, "media"), { recursive: true });
    for (const file of [
      "app.js",
      "site.css",
      "photo.webp",
      "photo-small.webp",
      "preload.webp",
    ]) {
      writeFileSync(join(outputDirectory, "assets", file), "");
    }
    writeFileSync(join(outputDirectory, "media", "poster"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing unquoted HTML resources with their element, attribute, and line", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src=/preview/assets/app.js></script>
<img src=/preview/assets/missing-image.webp>
<link rel=stylesheet href=/preview/assets/missing-style.css>
<img srcset=/preview/assets/missing-srcset.webp>
<link rel=preload as=image imagesrcset=/preview/assets/missing-imagesrcset.webp>
<video poster=/preview/media/missing-poster></video>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        for (const [url, line, element, attribute] of [
          ["/preview/assets/missing-image.webp", 2, "img", "src"],
          ["/preview/assets/missing-style.css", 3, "link", "href"],
          ["/preview/assets/missing-srcset.webp", 4, "img", "srcset"],
          [
            "/preview/assets/missing-imagesrcset.webp",
            5,
            "link",
            "imagesrcset",
          ],
          ["/preview/media/missing-poster", 6, "video", "poster"],
        ]) {
          assert.ok(
            error.message.includes(
              `"${url}" in index.html:${line} ${element}[${attribute}]`,
            ),
          );
        }
        return true;
      },
    );
  });

  it("reports wrong preview prefixes in unquoted HTML resource attributes with their source location", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src=/preview/assets/app.js></script>
<img src=/assets/wrong-image-prefix.webp>
<link rel=stylesheet href=/assets/wrong-style-prefix.css>
<img srcset=/assets/wrong-srcset-prefix.webp>
<link rel=preload as=image imagesrcset=/assets/wrong-imagesrcset-prefix.webp>
<video poster=/media/wrong-poster-prefix></video>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        for (const [url, line, element, attribute] of [
          ["/assets/wrong-image-prefix.webp", 2, "img", "src"],
          ["/assets/wrong-style-prefix.css", 3, "link", "href"],
          ["/assets/wrong-srcset-prefix.webp", 4, "img", "srcset"],
          ["/assets/wrong-imagesrcset-prefix.webp", 5, "link", "imagesrcset"],
          ["/media/wrong-poster-prefix", 6, "video", "poster"],
        ]) {
          assert.ok(
            error.message.includes(
              `"${url}" in index.html:${line} ${element}[${attribute}]`,
            ),
          );
        }
        return true;
      },
    );
  });

  it("reports missing extensionless unquoted object media but ignores unrelated objects", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
        <object data=/preview/media/missing-object-image type=image/png></object>
        <object data=/preview/media/missing-object-audio type=audio/mpeg></object>
        <object data=/preview/media/missing-object-video type=video/mp4></object>
        <object data=/preview/media/ignored-document type=application/pdf></object>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /missing-object-image/);
        assert.match(error.message, /missing-object-audio/);
        assert.match(error.message, /missing-object-video/);
        assert.doesNotMatch(error.message, /ignored-document/);
        return true;
      },
    );
  });

  it("ignores remote and embedded URLs for typed object image, audio, and video data", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
        <object data="https://cdn.example.test/image.png" type="image/png"></object>
        <object data="data:image/png;base64,AAAA" type="image/png"></object>
        <object data="https://cdn.example.test/audio.mp3" type="audio/mpeg"></object>
        <object data="data:audio/mpeg;base64,AAAA" type="audio/mpeg"></object>
        <object data="https://cdn.example.test/video.mp4" type="video/mp4"></object>
        <object data="data:video/mp4;base64,AAAA" type="video/mp4"></object>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
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

  it("checks quoted local image-set candidates in inline CSS and ignores external, data, and unrelated strings", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<div style="background-image: image-set('/preview/assets/inline-1x.webp' 1x, 'https://cdn.example.test/inline-2x.webp' 2x, 'data:image/webp;base64,AAAA' 3x)"></div>
<style>
.hero { background-image: -webkit-image-set("/preview/assets/block-1x.avif" 1x, "data:image/avif;base64,AAAA" 2x); }
.caption::after { content: "image-set('/preview/assets/unrelated.webp' 2x)"; }
</style>`,
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    for (const file of ["app.js", "inline-1x.webp", "block-1x.avif"]) {
      writeFileSync(join(assetsDirectory, file), "");
    }

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing image-set candidates in inline CSS with their HTML source lines", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<div style="background-image: image-set('/preview/assets/missing-inline-1x.webp' 1x, '/preview/assets/missing-inline-2x.webp' 2x)"></div>
<style>
.hero { background-image: image-set("/preview/assets/missing-block.avif" 2x); }
</style>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-inline-1x\.webp" in index\.html:2/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-inline-2x\.webp" in index\.html:2/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-block\.avif" in index\.html:4/,
        );
        return true;
      },
    );
  });

  it("reports incorrect preview prefixes in image-set candidates with their HTML source line", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<style>.hero { background-image: image-set("/assets/wrong-prefix.webp" 2x); }</style>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /configured base path "\/preview\/"/);
        assert.match(
          error.message,
          /"\/assets\/wrong-prefix\.webp" in index\.html:2/,
        );
        return true;
      },
    );
  });

  it("checks local assets in unquoted HTML style attributes", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<div style=background-image:url(/preview/assets/unquoted.webp)></div>
<div style=mask-image:url(https://cdn.example.test/mask.svg)></div>`,
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    for (const file of ["app.js", "unquoted.webp"]) {
      writeFileSync(join(assetsDirectory, file), "");
    }

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing assets in unquoted HTML style attributes with their HTML line", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<div style=background:url(/preview/assets/missing-unquoted.webp)></div>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-unquoted\.webp" in index\.html:2/,
        );
        return true;
      },
    );
  });

  it("checks resource attributes after > inside a quoted HTML attribute without treating its text as a tag", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<img alt="value > <img src='/preview/assets/attribute-text.webp'>" src="/preview/assets/missing-after-quoted-greater-than.webp">`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-after-quoted-greater-than\.webp"/,
        );
        assert.doesNotMatch(error.message, /attribute-text\.webp/);
        return true;
      },
    );
  });

  it("reports incorrect preview prefixes in unquoted HTML style attributes with their HTML line", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<div style=background:url(/assets/wrong-unquoted-prefix.svg)></div>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /configured base path "\/preview\/"/);
        assert.match(
          error.message,
          /"\/assets\/wrong-unquoted-prefix\.svg" in index\.html:2/,
        );
        return true;
      },
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

  it("decodes HTML character references in inline styles and preserves their HTML locations", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<div style="background: url(&quot;/preview/assets/missing-inline.webp&quot;)"></div>
<style>
.banner { background: url(&quot;/preview/assets/missing-block.svg&quot;); }
</style>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-inline\.webp" in index\.html:2/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-block\.svg" in index\.html:4/,
        );
        return true;
      },
    );
  });

  it("reports an entity-encoded wrong preview prefix with its HTML source location", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<style>.hero { background: url(&quot;&#47;assets&#47;wrong-prefix.svg&quot;); }</style>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /configured base path "\/preview\/"/);
        assert.match(
          error.message,
          /"\/assets\/wrong-prefix\.svg" in index\.html:2/,
        );
        return true;
      },
    );
  });

  it("checks entity-encoded local style URLs while ignoring encoded external and data URLs", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<div style="background: url(&quot;&#47;preview&#47;assets&#47;inline.webp&quot;); mask: url(&quot;https&#58;&#47;&#47;cdn.example.test&#47;mask.svg&quot;); border-image: url(&quot;data&#58;image&#47;svg+xml;base64,AAAA&quot;)"></div>
<style>.hero { background: url(&quot;&#47;preview&#47;assets&#47;block.svg&quot;); }</style>`,
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    for (const file of ["app.js", "inline.webp", "block.svg"]) {
      writeFileSync(join(assetsDirectory, file), "");
    }

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("checks local assets in iframe srcdoc and ignores external and data URLs", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<iframe srcdoc="&lt;img src=&quot;/preview/assets/frame.webp&quot;&gt;
&lt;img src=&quot;assets/frame-relative.webp&quot;&gt;
&lt;link rel=&quot;stylesheet&quot; href=&quot;/preview/assets/frame.css&quot;&gt;
&lt;link rel=&quot;stylesheet&quot; href=&quot;assets/frame-relative.css&quot;&gt;
&lt;img src=&quot;https://cdn.example.test/external.webp&quot;&gt;
&lt;img src=&quot;data:image/png;base64,AAAA&quot;&gt;
&lt;style&gt;.hero { background: url('/preview/assets/frame.svg'); mask: url('https://cdn.example.test/mask.svg'); }&lt;/style&gt;"></iframe>
<iframe srcdoc="<img src='/preview/assets/raw-frame.webp'>"></iframe>`,
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    for (const file of [
      "app.js",
      "frame.webp",
      "frame-relative.webp",
      "frame.css",
      "frame-relative.css",
      "frame.svg",
      "raw-frame.webp",
    ]) {
      writeFileSync(join(assetsDirectory, file), "");
    }

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing iframe srcdoc files with the embedded HTML location and URL", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<iframe srcdoc="&lt;img src=&quot;/preview/assets/missing-frame.webp&quot;&gt;
&lt;style&gt;.hero { background: url('/preview/assets/missing-frame.svg'); }&lt;/style&gt;"></iframe>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-frame\.webp" in index\.html:2 iframe\[srcdoc\]:1/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-frame\.svg" in index\.html:2 iframe\[srcdoc\]:2/,
        );
        return true;
      },
    );
  });

  it("resolves iframe srcdoc resources using its effective inherited and declared base URL", () => {
    const { app, outputDirectory } = createApp({
      html: `<base href="/preview/frames/shared/">
<script src="/preview/assets/app.js"></script>
<iframe srcdoc="&lt;img src=&quot;frame.webp&quot;&gt;"></iframe>
<iframe srcdoc="&lt;base href=&quot;/preview/frames/declared/&quot;&gt;&lt;img src=&quot;declared.webp&quot;&gt;"></iframe>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    mkdirSync(join(outputDirectory, "frames", "shared"), { recursive: true });
    mkdirSync(join(outputDirectory, "frames", "declared"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");
    writeFileSync(
      join(outputDirectory, "frames", "shared", "frame.webp"),
      "",
    );
    writeFileSync(
      join(outputDirectory, "frames", "declared", "declared.webp"),
      "",
    );

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports incorrect iframe srcdoc prefixes with their location and URL", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<iframe srcdoc="&lt;img src=&quot;/assets/wrong-frame-prefix.webp&quot;&gt;"></iframe>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /configured base path "\/preview\/"/);
        assert.match(
          error.message,
          /"\/assets\/wrong-frame-prefix\.webp" in index\.html:2 iframe\[srcdoc\]:1/,
        );
        return true;
      },
    );
  });

  it("checks static srcdoc strings assigned by JavaScript and ignores external and data URLs", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const frame = document.querySelector("iframe");
frame.srcdoc = \`<img src="/preview/assets/generated-frame.webp">
<link rel="stylesheet" href="/preview/assets/generated-frame.css">
<img src="https://cdn.example.test/external.webp">
<img src="data:image/png;base64,AAAA">\`;
frame.setAttribute("srcdoc", '<img src="assets/relative-frame.webp">');`,
    );
    for (const file of [
      "generated-frame.webp",
      "generated-frame.css",
      "relative-frame.webp",
    ]) {
      writeFileSync(join(assetsDirectory, file), "");
    }

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing assets in JavaScript-generated srcdoc with the source location and URL", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const frame = document.querySelector("iframe");
frame.srcdoc = '<img src="/preview/assets/missing-generated.webp"><style>@import "/preview/assets/missing-generated.css"; .hero { background: url("/preview/assets/missing-generated.svg"); }</style>';`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-generated\.webp" in assets\/app\.js:2 iframe\[srcdoc\]:1 img\[src\]/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-generated\.css" in assets\/app\.js:2 iframe\[srcdoc\]:1/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-generated\.svg" in assets\/app\.js:2 iframe\[srcdoc\]:1/,
        );
        return true;
      },
    );
  });

  it("reports incorrect prefixes in JavaScript-generated srcdoc with the source location and URL", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const frame = document.querySelector("iframe");
frame.setAttribute("srcdoc", '<img src="/assets/wrong-generated-prefix.webp"><img src="https://cdn.example.test/ignored.webp"><img src="data:image/png;base64,AAAA">');`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /configured base path "\/preview\/"/);
        assert.match(
          error.message,
          /"\/assets\/wrong-generated-prefix\.webp" in assets\/app\.js:2 iframe\[srcdoc\]:1 img\[src\]/,
        );
        assert.doesNotMatch(error.message, /ignored\.webp|data:image/);
        return true;
      },
    );
  });

  it("reports missing assets in concatenated JavaScript srcdoc fragments", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const opening = '<main>';
const missingImage = '<img src="/preview/assets/missing-fragment.webp">';
const closing = '</main>';
const frame = document.querySelector("iframe");
frame.srcdoc = opening + missingImage + closing;`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /build output is missing files referenced by URLs:.*"\/preview\/assets\/missing-fragment\.webp" in assets\/app\.js:5 iframe\[srcdoc\]:1 img\[src\]/s,
        );
        return true;
      },
    );
  });

  it("reports incorrect prefixes in concatenated JavaScript srcdoc fragments", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const opening = '<main>';
const wrongPrefixImage = '<img src="/assets/wrong-fragment.webp">';
const closing = '</main>';
const frame = document.querySelector("iframe");
frame.srcdoc = opening + wrongPrefixImage + closing;`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /configured base path "\/preview\/"/);
        assert.match(
          error.message,
          /"\/assets\/wrong-fragment\.webp" in assets\/app\.js:5 iframe\[srcdoc\]:1 img\[src\]/,
        );
        return true;
      },
    );
  });

  it("checks statically composed srcdoc and ignores non-static expressions", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const image = '<img src="/preview/assets/composed-frame.webp">';
const wrapperStart = '<main>';
const wrapperEnd = '</main>';
const frame = document.querySelector("iframe");
frame.srcdoc = wrapperStart + image + wrapperEnd;
frame.setAttribute("srcdoc", \`<section>\${image}</section>\`);
frame.srcdoc = '<img src="' + getRuntimeAssetURL() + '">';`,
    );
    writeFileSync(join(assetsDirectory, "composed-frame.webp"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("checks static iframe document.write markup and ignores external and data URLs", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const frame = document.querySelector("iframe");
frame.contentDocument.write(
  '<img src="/preview/assets/written-frame.webp">',
  '<link rel="stylesheet" href="/preview/assets/written-frame.css">',
  '<img src="https://cdn.example.test/external.webp">',
  '<img src="data:image/png;base64,AAAA">'
);
frame.contentWindow.document.write('<img src="/preview/assets/second-written-frame.svg">');`,
    );
    for (const file of [
      "app.js",
      "written-frame.webp",
      "written-frame.css",
      "second-written-frame.svg",
    ]) {
      writeFileSync(join(assetsDirectory, file), "");
    }

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing iframe document.write assets with the generated frame and URL", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const frame = document.querySelector("iframe");
frame.contentDocument.write('<img src="/preview/assets/missing-written-frame.webp"><link rel="stylesheet" href="/preview/assets/missing-written-frame.css">');`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-written-frame\.webp" in assets\/app\.js:2 iframe\[document\.write\]:1 img\[src\]/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-written-frame\.css" in assets\/app\.js:2 iframe\[document\.write\]:1 link\[href\]/,
        );
        return true;
      },
    );
  });

  it("reports incorrect prefixes in iframe document.write markup with the generated frame and URL", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const frame = document.querySelector("iframe");
frame.contentWindow.document.write('<img src="/assets/wrong-written-frame.webp">');`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /configured base path "\/preview\/"/);
        assert.match(
          error.message,
          /"\/assets\/wrong-written-frame\.webp" in assets\/app\.js:2 iframe\[document\.write\]:1 img\[src\]/,
        );
        return true;
      },
    );
  });

  it("checks local assets in same-origin iframe pages relative to the iframe URL", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<iframe src="frames/embedded.html"></iframe>
<iframe src="https://external.example.test/remote.html"></iframe>`,
    });
    const assetsDirectory = join(outputDirectory, "assets");
    const framesDirectory = join(outputDirectory, "frames");
    mkdirSync(assetsDirectory, { recursive: true });
    mkdirSync(framesDirectory, { recursive: true });
    writeFileSync(join(assetsDirectory, "app.js"), "");
    writeFileSync(join(assetsDirectory, "frame-image.webp"), "");
    writeFileSync(join(assetsDirectory, "frame-style.svg"), "");
    writeFileSync(
      join(framesDirectory, "embedded.html"),
      `<img src="../assets/frame-image.webp">
<div style="background:url('../assets/frame-style.svg')"></div>`,
    );
    const messages = [];

    assert.doesNotThrow(() =>
      checkAssetPaths(app, {
        cwd: tempRoot,
        log: (message) => messages.push(message),
      }),
    );
    assert.match(messages[0], /exist in the build output/);
  });

  it("resolves iframe resources and nested iframe URLs against the same-origin base URL", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<iframe src="/preview/frames/embedded.html"></iframe>`,
    });
    const assetsDirectory = join(outputDirectory, "assets");
    const framesDirectory = join(outputDirectory, "frames");
    const sharedDirectory = join(framesDirectory, "shared");
    mkdirSync(assetsDirectory, { recursive: true });
    mkdirSync(sharedDirectory, { recursive: true });
    writeFileSync(join(assetsDirectory, "app.js"), "");
    writeFileSync(
      join(framesDirectory, "embedded.html"),
      `<base href="/preview/frames/shared/">
<img src="frame.webp">
<div style="background:url('frame.svg')"></div>
<iframe src="nested.html"></iframe>`,
    );
    writeFileSync(
      join(sharedDirectory, "nested.html"),
      `<img src="nested.webp">`,
    );
    for (const file of ["frame.webp", "frame.svg", "nested.webp"]) {
      writeFileSync(join(sharedDirectory, file), "");
    }

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("keeps missing iframe diagnostics tied to the authored URL and HTML page when a base URL applies", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<iframe src="/preview/frames/embedded.html"></iframe>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    mkdirSync(join(outputDirectory, "frames"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");
    writeFileSync(
      join(outputDirectory, "frames", "embedded.html"),
      `<base href="/preview/shared/">
<img src="missing.webp">
<iframe src="missing.html"></iframe>`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"missing\.webp" in iframe page frames\/embedded\.html:2 img\[src\]/,
        );
        assert.match(
          error.message,
          /"missing\.html" in iframe page frames\/embedded\.html:3 iframe\[src\]/,
        );
        return true;
      },
    );
  });

  it("does not treat resources resolved to an external iframe base URL as local build assets", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<iframe src="/preview/frames/external.html"></iframe>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    mkdirSync(join(outputDirectory, "frames"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");
    writeFileSync(
      join(outputDirectory, "frames", "external.html"),
      `<base href="https://cdn.example.test/pages/">
<img src="remote.webp">
<iframe src="nested.html"></iframe>
<img src="/preview/assets/also-external.webp">`,
    );

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing resources in iframe pages with the iframe page and offending URL", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<iframe src="/preview/frames/embedded.html"></iframe>`,
    });
    const assetsDirectory = join(outputDirectory, "assets");
    const framesDirectory = join(outputDirectory, "frames");
    mkdirSync(assetsDirectory, { recursive: true });
    mkdirSync(framesDirectory, { recursive: true });
    writeFileSync(join(assetsDirectory, "app.js"), "");
    writeFileSync(
      join(framesDirectory, "embedded.html"),
      `<img src="/preview/assets/missing-from-frame.webp">`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-from-frame\.webp" in iframe page frames\/embedded\.html:1 img\[src\]/,
        );
        return true;
      },
    );
  });

  it("checks extensionless iframe pages only when the emitted file is HTML", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<iframe src="/preview/frames/embedded"></iframe>
<iframe src="/preview/products/item"></iframe>
<iframe src="/preview/frames/not-a-document"></iframe>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    mkdirSync(join(outputDirectory, "frames"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");
    writeFileSync(
      join(outputDirectory, "frames", "embedded"),
      `<!doctype html>
<html><body><img src="/preview/assets/missing-from-extensionless-frame.webp"></body></html>`,
    );
    writeFileSync(
      join(outputDirectory, "frames", "not-a-document"),
      `This is a data file with an apparent <img src="/preview/assets/not-an-image.webp"> reference.`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-from-extensionless-frame\.webp" in iframe page frames\/embedded \(http:\/\/preview\.local\/preview\/frames\/embedded\):2 img\[src\]/,
        );
        assert.doesNotMatch(
          error.message,
          /products\/item|not-a-document|not-an-image/,
        );
        return true;
      },
    );
  });

  it("reports incorrect preview prefixes in iframe pages", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<iframe src="/preview/frames/embedded.html"></iframe>`,
    });
    const assetsDirectory = join(outputDirectory, "assets");
    const framesDirectory = join(outputDirectory, "frames");
    mkdirSync(assetsDirectory, { recursive: true });
    mkdirSync(framesDirectory, { recursive: true });
    writeFileSync(join(assetsDirectory, "app.js"), "");
    writeFileSync(
      join(framesDirectory, "embedded.html"),
      `<img src="/assets/wrong-frame-prefix.webp">`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /configured base path "\/preview\/"/);
        assert.match(
          error.message,
          /"\/assets\/wrong-frame-prefix\.webp" in iframe page frames\/embedded\.html:1 img\[src\]/,
        );
        return true;
      },
    );
  });

  it("reports same-origin iframe HTML pages that are missing from the build", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<iframe src="/preview/frames/missing.html"></iframe>`,
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/frames\/missing\.html" in index\.html:2 iframe\[src\]/,
        );
        return true;
      },
    );
  });

  it("reports a missing media poster with the app name and offending URL", () => {
    const { app, outputDirectory } = createApp({
      name: "Canvas",
      basePath: "/__mockup/",
      html: `<script src="/__mockup/assets/app.js"></script>
<video poster="/__mockup/assets/missing-poster.webp"></video>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /Canvas build output is missing file referenced by URL/);
        assert.match(
          error.message,
          /"\/__mockup\/assets\/missing-poster\.webp" in index\.html:2 video\[poster\]/,
        );
        return true;
      },
    );
  });

  it("reports the HTML line, element, and attribute for missing image source candidates", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<img src="/preview/assets/missing-image.webp">
<img
  srcset="/preview/assets/present.webp 1x, /preview/assets/missing-candidate.webp 2x">
<link imagesrcset="/preview/assets/missing-preload-candidate.webp 2x">`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");
    writeFileSync(join(outputDirectory, "assets", "present.webp"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-image\.webp" in index\.html:2 img\[src\]/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-candidate\.webp" in index\.html:4 img\[srcset\]/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-preload-candidate\.webp" in index\.html:5 link\[imagesrcset\]/,
        );
        return true;
      },
    );
  });

  it("decodes character references in HTML resource attributes before checking files", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview&#47;assets&#47;app.js"></script>
<img src="/preview&sol;assets&sol;missing-src.webp">
<link rel="preload" as="image" href="/preview&#47;assets&#47;missing-href.webp">
<img srcset="/preview&#47;assets&#47;missing-srcset.webp 1x">
<link imagesrcset="/preview&sol;assets&sol;missing-imagesrcset.webp 1x">
<video poster="/preview&#47;assets&#47;missing-poster.webp"></video>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-src\.webp" in index\.html:2 img\[src\]/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-href\.webp" in index\.html:3 link\[href\]/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-srcset\.webp" in index\.html:4 img\[srcset\]/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-imagesrcset\.webp" in index\.html:5 link\[imagesrcset\]/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-poster\.webp" in index\.html:6 video\[poster\]/,
        );
        return true;
      },
    );
  });

  it("decodes standard named HTML references and preserves locations while ignoring external and data URLs", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview/assets/app.js"></script>
<img src="/preview/assets/missing&NotEqualTilde;.webp">
<img srcset="/preview/assets/missing-srcset&NotEqualTilde;.webp 1x">
<img src="/preview/assets/missing&not.webp">
<img src="https&colon;&sol;&sol;cdn.example.test/external.webp">
<img src="data&colon;image&sol;png;base64,AAAA">`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing≂̸\.webp" in index\.html:2 img\[src\]/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-srcset≂̸\.webp" in index\.html:3 img\[srcset\]/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing¬\.webp" in index\.html:4 img\[src\]/,
        );
        assert.doesNotMatch(error.message, /external\.webp|data:image/);
        return true;
      },
    );
  });

  it("reports entity-encoded wrong prefixes and ignores decoded external and data URLs", () => {
    const { app, outputDirectory } = createApp({
      html: `<script src="/preview&#47;assets&#47;app.js"></script>
<img src="&#47;assets&#47;wrong-prefix.webp">
<img src="https&#58;&#47;&#47;cdn.example.test&#47;remote.webp">
<img src="data&#58;image&#47;png;base64,AAAA">`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /configured base path "\/preview\/"/);
        assert.match(
          error.message,
          /"\/assets\/wrong-prefix\.webp" in index\.html:2 img\[src\]/,
        );
        assert.doesNotMatch(error.message, /remote\.webp|data:image/);
        return true;
      },
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

  it("reports a referenced asset symlink that resolves outside the build output", () => {
    const { app, outputDirectory } = createApp({
      name: "SymlinkOutside",
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    const externalAsset = join(tempRoot, "external-app.js");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      externalAsset,
      'const hidden = "/preview/assets/missing-external-chunk.webp";',
    );
    symlinkSync(externalAsset, join(assetsDirectory, "app.js"));

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /SymlinkOutside build output references files outside its output directory: "\/preview\/assets\/app\.js"/,
        );
        assert.doesNotMatch(error.message, /build output is missing file|missing-external-chunk/);
        return true;
      },
    );
  });

  it("accepts a referenced asset symlink that resolves inside the build output", () => {
    const { app, outputDirectory } = createApp({
      name: "SymlinkInside",
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    const emittedAsset = join(assetsDirectory, "emitted-app.js");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(emittedAsset, "");
    symlinkSync(emittedAsset, join(assetsDirectory, "app.js"));

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
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

  it("checks extensionless media URLs in built JavaScript without treating route strings as assets", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const icon = "/preview/media/brandmark";
      const productRoute = "/preview/products/item";
      const productAPI = "/preview/api/products";
      const image = document.createElement("img");
      image.src = "/preview/assets/inline-logo";`,
    );
    mkdirSync(join(outputDirectory, "media"), { recursive: true });
    writeFileSync(join(outputDirectory, "media", "brandmark"), "");
    writeFileSync(join(assetsDirectory, "inline-logo"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports a missing extensionless media URL assigned in built JavaScript", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const video = document.createElement("video");
      video.poster = "/preview/assets/missing-poster";`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      /"\/preview\/assets\/missing-poster" in assets\/app\.js/,
    );
  });

  it("checks extensionless local candidates in JavaScript srcset values", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const image = document.createElement("img");
      image.srcset = "/preview/assets/thumb 1x, /preview/media/hero 2x, https://cdn.example.test/images/remote 3x, /preview/products/item 4x, /preview/api/image 5x";
      image.setAttribute("srcset", "/preview/images/brandmark 320w");`,
    );
    mkdirSync(join(outputDirectory, "media"), { recursive: true });
    mkdirSync(join(outputDirectory, "images"), { recursive: true });
    for (const [directory, file] of [
      [assetsDirectory, "thumb"],
      [join(outputDirectory, "media"), "hero"],
      [join(outputDirectory, "images"), "brandmark"],
    ]) {
      writeFileSync(join(directory, file), "");
    }

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing extensionless local candidates in JavaScript srcset values", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const image = document.createElement("img");
      image.srcset = "/preview/assets/present 1x, /preview/assets/missing-candidate 2x, https://cdn.example.test/images/remote 3x, /preview/products/item 4x, /preview/api/image 5x";`,
    );
    writeFileSync(join(assetsDirectory, "present"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /"\/preview\/assets\/missing-candidate"/);
        assert.doesNotMatch(
          error.message,
          /cdn\.example\.test|products\/item|api\/image/,
        );
        return true;
      },
    );
  });

  it("checks media URLs assembled from static JavaScript values without treating routes as files", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const mediaDirectory = "/preview/media/";
      const brandmarkName = "brandmark";
      const brandmarkURL = mediaDirectory + brandmarkName;
      const introURL = \`/preview/media/\${"intro"}\`;
      const image = document.createElement("img");
      image.src = brandmarkURL;
      image.setAttribute("src", introURL);
      const productRoute = "/preview/products/" + "item";
      const mediaAPI = "/preview/api/media/" + "lookup";
      window.location.href = productRoute;
      fetch(mediaAPI);`,
    );
    mkdirSync(join(outputDirectory, "media"), { recursive: true });
    writeFileSync(join(outputDirectory, "media", "brandmark"), "");
    writeFileSync(join(outputDirectory, "media", "intro"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports a missing media file assembled from JavaScript constants", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const mediaDirectory = "/preview/assets/";
      const missingName = "missing-cover.webp";
      const coverURL = mediaDirectory + missingName;
      const image = document.createElement("img");
      image.src = coverURL;
      const missingRouteName = "missing-route.webp";
      const productRoute = \`/preview/products/\${missingRouteName}\`;
      const missingAPIName = "missing-api.webp";
      const mediaAPI = "/preview/api/media/" + missingAPIName;
      window.location.href = productRoute;
      fetch(mediaAPI);`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-cover\.webp" in assets\/app\.js/,
        );
        assert.doesNotMatch(
          error.message,
          /missing-route|missing-api|products\/|api\/media/,
        );
        return true;
      },
    );
  });

  it("ignores missing asset paths in JavaScript comments without treating string contents as comments", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `// import("/preview/assets/missing-line.js");
      /* import("/preview/assets/missing-block.js"); */
      const commentMarker = "/*";
      import("/preview/assets/present.js");`,
    );
    writeFileSync(join(assetsDirectory, "present.js"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("still reports active missing JavaScript asset references", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `/* import("/preview/assets/missing-comment.js"); */
      const commentMarker = "/*";
      import("/preview/assets/missing-active.js");`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      /missing-active\.js.*assets\/app\.js/,
    );
  });

  it("decodes escaped JavaScript asset URLs before checking emitted files", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      String.raw`const image = "\x2fpreview\x2fassets\x2fmissing\u002ewebp";
      const icon = "\u{2f}preview\u{2f}assets\u{2f}missing-icon\u{2e}svg";`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\/preview\/assets\/missing\.webp" in assets\/app\.js/,
        );
        assert.match(
          error.message,
          /"\/preview\/assets\/missing-icon\.svg" in assets\/app\.js/,
        );
        return true;
      },
    );
  });

  it("checks existing escaped JavaScript assets while ignoring routes and external URLs", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      String.raw`const image = "\x2fpreview\u002fassets\x2fpresent\u002ewebp";
      const route = "\x2fpreview\x2fproducts\x2fitem";
      const external = "https:\x2f\x2fcdn.example.test/missing.webp";
      const embedded = "data:image/png;base64,AAAA";`,
    );
    writeFileSync(join(assetsDirectory, "present.webp"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("does not let comment-like slashes in regular expressions hide later assets", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const slashPattern = /[//]/;
      const escapedSlashPattern = /https?:\\/\\//;
      if (enabled) /[//]/.test("comment-like slashes");
      import("/preview/assets/missing-after-regex.js");`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      /missing-after-regex\.js.*assets\/app\.js/,
    );
  });

  it("preserves JavaScript template strings and strips comments inside their expressions", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "app.js"),
      `const example = \`// ignored text
        \${/* import("/preview/assets/missing-expression.js"); */ "/preview/assets/present.js"}\`;
      import("/preview/assets/present.js");`,
    );
    writeFileSync(join(assetsDirectory, "present.js"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
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

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("resolves present image and font URLs from an imported nested stylesheet", () => {
    const { app, outputDirectory } = createApp({
      name: "Nested CSS Present",
      html: '<link rel="stylesheet" href="/preview/assets/styles.css"><script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    const nestedStylesheetDirectory = join(assetsDirectory, "css", "themes");
    mkdirSync(join(assetsDirectory, "css", "images"), { recursive: true });
    mkdirSync(join(assetsDirectory, "css", "fonts"), { recursive: true });
    mkdirSync(nestedStylesheetDirectory, { recursive: true });
    writeFileSync(join(assetsDirectory, "styles.css"), '@import url("./css/themes/dark.css");');
    writeFileSync(
      join(nestedStylesheetDirectory, "dark.css"),
      '.hero { background-image: url("../images/hero.webp"); } @font-face { src: url("../fonts/display.woff2"); }',
    );
    writeFileSync(join(assetsDirectory, "css", "images", "hero.webp"), "");
    writeFileSync(join(assetsDirectory, "css", "fonts", "display.woff2"), "");
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing image and font URLs with their nested stylesheet lines", () => {
    const { app, outputDirectory } = createApp({
      name: "Nested CSS Missing",
      basePath: "/__mockup/",
      html: '<link rel="stylesheet" href="/__mockup/assets/styles.css"><script src="/__mockup/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    const nestedStylesheetDirectory = join(assetsDirectory, "css", "themes");
    mkdirSync(nestedStylesheetDirectory, { recursive: true });
    writeFileSync(join(assetsDirectory, "styles.css"), '@import url("./css/themes/dark.css");');
    writeFileSync(
      join(nestedStylesheetDirectory, "dark.css"),
      `.hero {
  background-image: url("../images/missing-hero.webp");
}
@font-face {
  src: url("../fonts/missing-display.woff2");
}`,
    );
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\.\.\/images\/missing-hero\.webp" in assets\/css\/themes\/dark\.css:2/,
        );
        assert.match(
          error.message,
          /"\.\.\/fonts\/missing-display\.woff2" in assets\/css\/themes\/dark\.css:5/,
        );
        return true;
      },
    );
  });

  it("checks local CSS files imported with url() while ignoring external imports", () => {
    const { app, outputDirectory } = createApp({
      html: '<link rel="stylesheet" href="/preview/assets/styles.css"><script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      `@import url("./theme.css");
      @import url("assets/nested.css");
      @import url("/preview/assets/layout.css");
      @import url("https://cdn.example.test/external.css");`,
    );
    writeFileSync(join(assetsDirectory, "theme.css"), "");
    writeFileSync(join(assetsDirectory, "layout.css"), "");
    mkdirSync(join(assetsDirectory, "assets"), { recursive: true });
    writeFileSync(join(assetsDirectory, "assets", "nested.css"), "");
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("checks cache-busted CSS imports by their emitted file path and ignores external imports", () => {
    const { app, outputDirectory } = createApp({
      html: '<link rel="stylesheet" href="/preview/assets/styles.css"><script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      `@import "./theme.css?cache=123";
      @import url("./layout.css#dark");
      @import "https://cdn.example.test/external.css?cache=456";
      @import url("https://cdn.example.test/external-url.css#theme");`,
    );
    writeFileSync(join(assetsDirectory, "theme.css"), "");
    writeFileSync(join(assetsDirectory, "layout.css"), "");
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports the original cache-busted CSS import URL and source stylesheet when missing", () => {
    const { app, outputDirectory } = createApp({
      name: "Canvas",
      basePath: "/__mockup/",
      html: '<link rel="stylesheet" href="/__mockup/assets/styles.css"><script src="/__mockup/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      `@import "./missing-theme.css?cache=123";
      @import url("./missing-layout.css#dark");`,
    );
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\.\/missing-theme\.css\?cache=123" in assets\/styles\.css/,
        );
        assert.match(
          error.message,
          /"\.\/missing-layout\.css#dark" in assets\/styles\.css/,
        );
        return true;
      },
    );
  });

  it("reports missing CSS files imported with url() and their stylesheet source", () => {
    const { app, outputDirectory } = createApp({
      name: "Canvas",
      basePath: "/__mockup/",
      html: '<link rel="stylesheet" href="/__mockup/assets/styles.css"><script src="/__mockup/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      `@import url("./missing-theme.css");
      @import url("/__mockup/assets/missing-layout.css");`,
    );
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\.\/missing-theme\.css" in assets\/styles\.css/,
        );
        assert.match(
          error.message,
          /"\/__mockup\/assets\/missing-layout\.css" in assets\/styles\.css/,
        );
        return true;
      },
    );
  });

  it("resolves CSS-escaped filenames relative to the emitted stylesheet", () => {
    const { app, outputDirectory } = createApp({
      html: '<link rel="stylesheet" href="/preview/assets/styles.css"><script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      '.hero{background-image:url("./hero\\20 image.webp")} @font-face{src:url("./font\\20 regular.woff2")}',
    );
    writeFileSync(join(assetsDirectory, "hero image.webp"), "");
    writeFileSync(join(assetsDirectory, "font regular.woff2"), "");
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("resolves image and font filenames continued across CSS lines", () => {
    const { app, outputDirectory } = createApp({
      html: '<link rel="stylesheet" href="/preview/assets/styles.css"><script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    const lineFeedContinuation = "\\\n";
    const carriageReturnContinuation = "\\\r\n";
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      `.hero{background-image:url("./hero-${lineFeedContinuation}photo.webp")} @font-face{src:url(./font-${carriageReturnContinuation}regular.woff2)}`,
    );
    writeFileSync(join(assetsDirectory, "hero-photo.webp"), "");
    writeFileSync(join(assetsDirectory, "font-regular.woff2"), "");
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("resolves escaped punctuation and non-ASCII filenames in CSS", () => {
    const { app, outputDirectory } = createApp({
      html: '<link rel="stylesheet" href="/preview/assets/styles.css"><script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      '.hero{background-image:url("./hero\\(dark\\).webp")} @font-face{src:url("./caf\\e9 .woff2")}',
    );
    writeFileSync(join(assetsDirectory, "hero(dark).webp"), "");
    writeFileSync(join(assetsDirectory, "café.woff2"), "");
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("resolves percent-encoded image and font filenames in CSS", () => {
    const { app, outputDirectory } = createApp({
      html: '<link rel="stylesheet" href="/preview/assets/styles.css"><script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      '.hero{background-image:url("./hero%20photo%20%28wide%29.webp")} @font-face{src:url("./caf%C3%A9.woff2")}',
    );
    writeFileSync(join(assetsDirectory, "hero photo (wide).webp"), "");
    writeFileSync(join(assetsDirectory, "café.woff2"), "");
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing percent-encoded CSS image and font URLs with their stylesheet", () => {
    const { app, outputDirectory } = createApp({
      name: "Canvas",
      basePath: "/__mockup/",
      html: '<link rel="stylesheet" href="/__mockup/assets/styles.css"><script src="/__mockup/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      '.hero{background-image:url("./missing%20hero%20%28wide%29.webp")} @font-face{src:url("./missing-caf%C3%A9.woff2")}',
    );
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /Canvas build output is missing files referenced by URLs/,
        );
        assert.match(
          error.message,
          /"\.\/missing%20hero%20%28wide%29\.webp" in assets\/styles\.css/,
        );
        assert.match(
          error.message,
          /"\.\/missing-caf%C3%A9\.woff2" in assets\/styles\.css/,
        );
        return true;
      },
    );
  });

  it("reports the app and authored escaped URL when a CSS-escaped asset is missing", () => {
    const { app, outputDirectory } = createApp({
      name: "Canvas",
      basePath: "/__mockup/",
      html: '<link rel="stylesheet" href="/__mockup/assets/styles.css"><script src="/__mockup/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      '.hero{background-image:url("./missing\\20 image.webp")}',
    );
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /Canvas build output is missing file referenced by URL/,
        );
        assert.match(
          error.message,
          /"\.\/missing\\20 image\.webp" in assets\/styles\.css/,
        );
        return true;
      },
    );
  });

  it("reports missing CSS assets with continued URLs exactly as authored", () => {
    const { app, outputDirectory } = createApp({
      name: "Canvas",
      basePath: "/__mockup/",
      html: '<link rel="stylesheet" href="/__mockup/assets/styles.css"><script src="/__mockup/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    const lineFeedContinuation = "\\\n";
    const carriageReturnContinuation = "\\\r\n";
    const missingImageURL = `./missing-${lineFeedContinuation}photo.webp`;
    const missingFontURL = `./missing-${carriageReturnContinuation}regular.woff2`;
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      `.hero{background-image:url("${missingImageURL}")} @font-face{src:url("${missingFontURL}")}`,
    );
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /Canvas build output is missing files referenced by URLs/,
        );
        assert.ok(
          error.message.includes(`"${missingImageURL}" in assets/styles.css`),
        );
        assert.ok(
          error.message.includes(`"${missingFontURL}" in assets/styles.css`),
        );
        return true;
      },
    );
  });

  it("reports missing escaped punctuation and non-ASCII assets with their authored URLs and stylesheet", () => {
    const { app, outputDirectory } = createApp({
      name: "Canvas",
      basePath: "/__mockup/",
      html: '<link rel="stylesheet" href="/__mockup/assets/styles.css"><script src="/__mockup/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(
      join(assetsDirectory, "styles.css"),
      '.hero{background-image:url("./missing\\(dark\\).webp")} @font-face{src:url("./missing-caf\\e9 .woff2")}',
    );
    writeFileSync(join(assetsDirectory, "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /"\.\/missing\\\(dark\\\)\.webp" in assets\/styles\.css/,
        );
        assert.match(
          error.message,
          /"\.\/missing-caf\\e9 \.woff2" in assets\/styles\.css/,
        );
        return true;
      },
    );
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

  it("reports missing local image, stylesheet, and font resources in emitted SVGs", () => {
    const { app, outputDirectory } = createApp({
      name: "Canvas",
      basePath: "/__mockup/",
      html: '<script src="/__mockup/assets/app.js"></script><img src="/__mockup/assets/illustration.svg">',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(join(assetsDirectory, "app.js"), "");
    writeFileSync(
      join(assetsDirectory, "illustration.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg">
        <image href="./images/missing-image.webp"/>
        <image xlink:href="./images/missing-xlink-image.webp"/>
        <link rel="stylesheet" href="./styles/missing.css"/>
        <style>@font-face { src: url("./fonts/missing.woff2"); }</style>
      </svg>`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /Canvas build output is missing files/);
        assert.match(
          error.message,
          /"\.\/images\/missing-image\.webp" in assets\/illustration\.svg image\[href\]/,
        );
        assert.match(
          error.message,
          /"\.\/images\/missing-xlink-image\.webp" in assets\/illustration\.svg image\[xlink:href\]/,
        );
        assert.match(
          error.message,
          /"\.\/styles\/missing\.css" in assets\/illustration\.svg link\[href\]/,
        );
        assert.match(error.message, /"\.\/fonts\/missing\.woff2" in assets\/illustration\.svg/);
        return true;
      },
    );
  });

  it("checks SVG resources relative to their emitted file and allows external and data URLs", () => {
    const { app, outputDirectory } = createApp({
      html: '<script src="/preview/assets/app.js"></script><img src="/preview/assets/illustration.svg">',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(join(assetsDirectory, "images"), { recursive: true });
    mkdirSync(join(assetsDirectory, "styles"), { recursive: true });
    mkdirSync(join(assetsDirectory, "fonts"), { recursive: true });
    writeFileSync(join(assetsDirectory, "app.js"), "");
    writeFileSync(join(assetsDirectory, "images", "existing.webp"), "");
    writeFileSync(join(assetsDirectory, "images", "absolute.webp"), "");
    writeFileSync(join(assetsDirectory, "styles", "site.css"), "");
    writeFileSync(join(assetsDirectory, "fonts", "site.woff2"), "");
    writeFileSync(
      join(assetsDirectory, "illustration.svg"),
      `<?xml-stylesheet type="text/css" href="./styles/site.css"?>
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <image href="./images/existing.webp"/>
        <rect fill="url(./images/existing.webp#paint)"/>
        <g
          filter="url('./images/existing.webp#blur')"
          mask="url(./images/existing.webp#mask)"
          clip-path="url(./images/existing.webp#clip)"
        />
        <image data-href="./images/ignored.webp"/>
        <image xlink:href="/preview/assets/images/absolute.webp"/>
        <image href="https://cdn.example.test/missing.webp"/>
        <image href="data:image/png;base64,AAAA"/>
        <use href="#local-symbol"/>
        <rect
          fill="url(#local-gradient)"
          stroke="url(https://cdn.example.test/paint.svg#paint)"
          filter="url(data:image/svg+xml;base64,AAAA)"
        />
        <link rel="stylesheet" href="./styles/site.css"/>
        <style>
          @font-face { src: url("./fonts/site.woff2"); }
          .remote { background: url("https://cdn.example.test/missing.woff2"); }
          .embedded { background: url("data:font/woff2;base64,AAAA"); }
        </style>
      </svg>`,
    );

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing local SVG presentation-attribute resources with their source element", () => {
    const { app, outputDirectory } = createApp({
      name: "SVGPaintMissing",
      basePath: "/__mockup/",
      html: '<script src="/__mockup/assets/app.js"></script><img src="/__mockup/assets/illustration.svg">',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(join(assetsDirectory, "app.js"), "");
    writeFileSync(
      join(assetsDirectory, "illustration.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg">
        <rect fill="url(./paint/missing-fill.svg#gradient)"/>
        <path filter="url('./filters/missing-filter.svg#blur')" mask="url(./masks/missing-mask.svg#mask)" clip-path="url(./clips/missing-clip.svg#clip)"/>
        <circle fill="url(#local-gradient)" stroke="url(https://cdn.example.test/missing.svg#paint)" filter="url(data:image/svg+xml;base64,AAAA)"/>
      </svg>`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /SVGPaintMissing build output is missing files/,
        );
        assert.match(
          error.message,
          /"\.\/paint\/missing-fill\.svg#gradient" in assets\/illustration\.svg rect\[fill\]/,
        );
        assert.match(
          error.message,
          /"\.\/filters\/missing-filter\.svg#blur" in assets\/illustration\.svg path\[filter\]/,
        );
        assert.match(
          error.message,
          /"\.\/masks\/missing-mask\.svg#mask" in assets\/illustration\.svg path\[mask\]/,
        );
        assert.match(
          error.message,
          /"\.\/clips\/missing-clip\.svg#clip" in assets\/illustration\.svg path\[clip-path\]/,
        );
        assert.doesNotMatch(
          error.message,
          /local-gradient|cdn\.example|data:image/,
        );
        return true;
      },
    );
  });

  it("reports incorrect preview prefixes in SVG presentation attributes with their source element", () => {
    const { app, outputDirectory } = createApp({
      name: "SVGPaintPrefix",
      basePath: "/__mockup/",
      html: '<script src="/__mockup/assets/app.js"></script><img src="/__mockup/assets/illustration.svg">',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(join(assetsDirectory, "app.js"), "");
    writeFileSync(
      join(assetsDirectory, "illustration.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(/assets/paint.svg#gradient)"/></svg>',
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /local assets do not use configured base path/,
        );
        assert.match(
          error.message,
          /"\/assets\/paint\.svg#gradient" in assets\/illustration\.svg rect\[fill\]/,
        );
        return true;
      },
    );
  });

  it("checks existing inline SVG resources against the configured base path and allows external and data URLs", () => {
    const { app, outputDirectory } = createApp({
      name: "InlineSVGExisting",
      basePath: "/__mockup/",
      html: `<script src="/__mockup/assets/app.js"></script>
        <svg xmlns="http://www.w3.org/2000/svg">
          <image href="./assets/images/existing.webp"/>
          <rect fill="url(./assets/images/existing.webp#inline-paint)"/>
          <link rel="stylesheet" href="./assets/styles/site.css"/>
          <style>@font-face { src: url("./assets/fonts/site.woff2"); }</style>
          <image href="https://cdn.example.test/external.webp"/>
          <image href="data:image/png;base64,AAAA"/>
          <image href="#local-symbol"/>
        </svg>
        <iframe srcdoc='<svg xmlns="http://www.w3.org/2000/svg"><image href="/__mockup/assets/images/frame.webp"/></svg>'></iframe>`,
    });
    mkdirSync(join(outputDirectory, "assets", "images"), { recursive: true });
    mkdirSync(join(outputDirectory, "assets", "styles"), { recursive: true });
    mkdirSync(join(outputDirectory, "assets", "fonts"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");
    writeFileSync(
      join(outputDirectory, "assets", "images", "existing.webp"),
      "",
    );
    writeFileSync(join(outputDirectory, "assets", "images", "frame.webp"), "");
    writeFileSync(join(outputDirectory, "assets", "styles", "site.css"), "");
    writeFileSync(join(outputDirectory, "assets", "fonts", "site.woff2"), "");

    assert.doesNotThrow(() =>
      checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
    );
  });

  it("reports missing inline SVG images, stylesheets, and fonts with the app and URLs", () => {
    const { app, outputDirectory } = createApp({
      name: "InlineSVGMissing",
      basePath: "/__mockup/",
      html: `<script src="/__mockup/assets/app.js"></script>
        <svg xmlns="http://www.w3.org/2000/svg">
          <image href="./assets/images/missing.webp"/>
          <rect fill="url(./assets/images/missing-paint.svg#inline-paint)"/>
          <link rel="stylesheet" href="./assets/styles/missing.css"/>
          <style>@font-face { src: url("./assets/fonts/missing.woff2"); }</style>
        </svg>`,
    });
    mkdirSync(join(outputDirectory, "assets"), { recursive: true });
    writeFileSync(join(outputDirectory, "assets", "app.js"), "");

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(
          error.message,
          /InlineSVGMissing build output is missing files/,
        );
        assert.match(error.message, /"\.\/assets\/images\/missing\.webp"/);
        assert.match(
          error.message,
          /"\.\/assets\/images\/missing-paint\.svg#inline-paint" in index\.html rect\[fill\]/,
        );
        assert.match(error.message, /"\.\/assets\/styles\/missing\.css"/);
        assert.match(error.message, /"\.\/assets\/fonts\/missing\.woff2"/);
        return true;
      },
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

  it("scans JavaScript and CSS symlinks that resolve inside the build output", () => {
    for (const { file, target, content } of [
      {
        file: "linked.js",
        target: "javascript.bundle",
        content: 'const image = "/preview/assets/missing-from-linked-js.webp";',
      },
      {
        file: "linked.css",
        target: "styles.bundle",
        content:
          '.hero { background-image: url("/preview/assets/missing-from-linked-css.svg"); }',
      },
    ]) {
      const { app, outputDirectory } = createApp({
        name: `SymlinkInside-${file}`,
        html:
          '<script src="/preview/assets/app.js"></script>' +
          (file.endsWith(".css")
            ? '<link rel="stylesheet" href="/preview/assets/linked.css">'
            : '<script src="/preview/assets/linked.js"></script>'),
      });
      const assetsDirectory = join(outputDirectory, "assets");
      const chunksDirectory = join(outputDirectory, "chunks");
      mkdirSync(assetsDirectory, { recursive: true });
      mkdirSync(chunksDirectory, { recursive: true });
      writeFileSync(join(assetsDirectory, "app.js"), "");
      const targetPath = join(chunksDirectory, target);
      writeFileSync(targetPath, content);
      symlinkSync(
        targetPath,
        join(assetsDirectory, file),
      );

      assert.throws(
        () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
        (error) => {
          const missingAsset =
            file === "linked.js"
              ? "missing-from-linked-js.webp"
              : "missing-from-linked-css.svg";
          assert.match(error.message, new RegExp(missingAsset));
          assert.match(error.message, new RegExp(`assets/${file}`));
          return true;
        },
      );
    }
  });
});
