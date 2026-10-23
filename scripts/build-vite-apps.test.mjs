import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { buildApps, readPreviewSettings } from "./build-vite-apps.mjs";

const tempRoot = mkdtempSync(join(tmpdir(), "vite-app-build-tests-"));
after(() => rmSync(tempRoot, { recursive: true, force: true }));

function writeManifest(relativePath, content) {
  const manifestPath = join(tempRoot, relativePath);
  mkdirSync(join(manifestPath, ".."), { recursive: true });
  writeFileSync(manifestPath, content);
  return relativePath;
}

function manifest({ previewPath, localPort }) {
  return `kind = "web"
previewPath = "${previewPath}"

[[services]]
localPort = ${localPort}

[services.env]
PORT = "${localPort}"
BASE_PATH = "${previewPath}"
`;
}

describe("Vite artifact build settings", () => {
  it("passes each app's manifest preview path and port to its matching build", () => {
    const appConfigs = [
      {
        name: "ProcureFlow",
        packageName: "@workspace/procurement-workspace",
        manifestPath: writeManifest("procure/artifact.toml", manifest({
          previewPath: "/procurement-preview",
          localPort: 43127,
        })),
      },
      {
        name: "Canvas",
        packageName: "@workspace/mockup-sandbox",
        manifestPath: writeManifest("canvas/artifact.toml", manifest({
          previewPath: "/canvas-preview",
          localPort: 43189,
        })),
      },
    ];
    const calls = [];

    const status = buildApps({
      appConfigs,
      cwd: tempRoot,
      env: { EXISTING_ENV: "preserved" },
      log: () => {},
      spawn: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    });

    assert.equal(status, 0);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(([command, args, options]) => ({
      command,
      packageName: args[1],
      port: options.env.PORT,
      basePath: options.env.BASE_PATH,
      preservedEnv: options.env.EXISTING_ENV,
    })), [
      {
        command: "pnpm",
        packageName: "@workspace/procurement-workspace",
        port: "43127",
        basePath: "/procurement-preview",
        preservedEnv: "preserved",
      },
      {
        command: "pnpm",
        packageName: "@workspace/mockup-sandbox",
        port: "43189",
        basePath: "/canvas-preview",
        preservedEnv: "preserved",
      },
    ]);
  });

  it("fails with a specific message when previewPath is missing", () => {
    const app = {
      name: "Broken app",
      manifestPath: writeManifest("missing-preview/artifact.toml", `
[[services]]
localPort = 43210

[services.env]
PORT = "43210"
BASE_PATH = "/"
`),
    };

    assert.throws(
      () => readPreviewSettings(app, tempRoot),
      /Expected Broken app .* to define a root previewPath/,
    );
  });

  it("fails with a specific message when services.localPort is missing", () => {
    const app = {
      name: "Broken app",
      manifestPath: writeManifest("missing-port/artifact.toml", `
previewPath = "/missing-port"

[services.env]
PORT = "43210"
BASE_PATH = "/missing-port"
`),
    };

    assert.throws(
      () => readPreviewSettings(app, tempRoot),
      /Expected Broken app .* to define services\.localPort/,
    );
  });

  it("rejects invalid root paths and out-of-range local ports", () => {
    const invalidPath = {
      name: "Invalid path app",
      manifestPath: writeManifest("invalid-path/artifact.toml", manifest({
        previewPath: "relative",
        localPort: 43210,
      })),
    };
    const invalidPort = {
      name: "Invalid port app",
      manifestPath: writeManifest("invalid-port/artifact.toml", manifest({
        previewPath: "/invalid-port",
        localPort: 70000,
      })),
    };

    assert.throws(
      () => readPreviewSettings(invalidPath, tempRoot),
      /previewPath to start with "\/"/,
    );
    assert.throws(
      () => readPreviewSettings(invalidPort, tempRoot),
      /Invalid services\.localPort .*70000/,
    );
  });
});
