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

  it("rejects a referenced asset symlink that resolves outside the build output", () => {
    const { app, outputDirectory } = createApp({
      name: "SymlinkOutside",
      html: '<script src="/preview/assets/app.js"></script>',
    });
    const assetsDirectory = join(outputDirectory, "assets");
    const externalAsset = join(tempRoot, "external-app.js");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(externalAsset, "");
    symlinkSync(externalAsset, join(assetsDirectory, "app.js"));

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      /build output is missing file referenced by URL: "\/preview\/assets\/app\.js"/,
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
        <link rel="stylesheet" href="./styles/missing.css"/>
        <style>@font-face { src: url("./fonts/missing.woff2"); }</style>
      </svg>`,
    );

    assert.throws(
      () => checkAssetPaths(app, { cwd: tempRoot, log: () => {} }),
      (error) => {
        assert.match(error.message, /Canvas build output is missing files/);
        assert.match(error.message, /"\.\/images\/missing-image\.webp" in assets\/illustration\.svg/);
        assert.match(error.message, /"\.\/styles\/missing\.css" in assets\/illustration\.svg/);
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
        <image data-href="./images/ignored.webp"/>
        <image xlink:href="/preview/assets/images/absolute.webp"/>
        <image href="https://cdn.example.test/missing.webp"/>
        <image href="data:image/png;base64,AAAA"/>
        <use href="#local-symbol"/>
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
