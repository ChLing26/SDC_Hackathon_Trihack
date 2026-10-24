import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = mkdtempSync(join(tmpdir(), "vite-asset-build-tests-"));
after(() => rmSync(tempRoot, { recursive: true, force: true }));

function writeEmittedApp({ artifactPath, outputPath, previewPath, html }) {
  const artifactRoot = join(tempRoot, artifactPath);
  const outputDirectory = join(tempRoot, outputPath);
  const indexPath = join(outputDirectory, "index.html");
  const manifestPath = join(artifactRoot, ".replit-artifact", "artifact.toml");

  mkdirSync(dirname(manifestPath), { recursive: true });
  mkdirSync(join(outputDirectory, "assets"), { recursive: true });
  writeFileSync(
    manifestPath,
    `previewPath = "${previewPath}"

[services.env]
BASE_PATH = "${previewPath}"
`,
  );
  writeFileSync(indexPath, html);
  writeFileSync(join(outputDirectory, "assets", "app.js"), "");
}

describe("root build preview asset gate", () => {
  it("fails the root build asset check for a missing responsive image", () => {
    const packageJson = JSON.parse(
      readFileSync(join(repositoryRoot, "package.json"), "utf8"),
    );
    const buildCommand = packageJson.scripts.build;

    assert.equal(
      packageJson.scripts["check:preview-assets"],
      "node scripts/check-vite-asset-paths.mjs",
      "the root asset-check script should run the asset checker",
    );
    assert.match(
      buildCommand,
      /node scripts\/build-vite-apps\.mjs && pnpm run check:preview-assets &&/,
      "the root build should stop on asset errors after emitting Vite app output",
    );

    writeEmittedApp({
      artifactPath: "artifacts/procurement-workspace",
      outputPath: "artifacts/procurement-workspace/dist/public",
      previewPath: "/",
      html: '<script src="/assets/app.js"></script><img srcset="/assets/missing-responsive.webp 2x">',
    });
    writeEmittedApp({
      artifactPath: "artifacts/mockup-sandbox",
      outputPath: "artifacts/mockup-sandbox/dist",
      previewPath: "/__mockup",
      html: '<script src="/__mockup/assets/app.js"></script>',
    });

    const result = spawnSync(
      process.execPath,
      [join(repositoryRoot, "scripts/check-vite-asset-paths.mjs")],
      { cwd: tempRoot, encoding: "utf8" },
    );

    assert.notEqual(
      result.status,
      0,
      "the root asset-check command should fail",
    );
    assert.match(result.stderr, /ProcureFlow/);
    assert.match(result.stderr, /\/assets\/missing-responsive\.webp/);
  });
});
