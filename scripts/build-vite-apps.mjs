import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const apps = [
  {
    packageName: "@workspace/procurement-workspace",
    manifestPath: "artifacts/procurement-workspace/.replit-artifact/artifact.toml",
  },
  {
    packageName: "@workspace/mockup-sandbox",
    manifestPath: "artifacts/mockup-sandbox/.replit-artifact/artifact.toml",
  },
];

function readPreviewSettings(manifestPath) {
  const manifest = readFileSync(resolve(manifestPath), "utf8");
  let section = "";
  let previewPath;
  let portValue;

  for (const line of manifest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("[")) {
      section = trimmed === "[[services]]" ? "services" : "";
      continue;
    }

    if (section === "") {
      previewPath ??= trimmed.match(/^previewPath\s*=\s*"([^"]+)"\s*$/)?.[1];
    } else if (section === "services") {
      portValue ??= trimmed.match(/^localPort\s*=\s*(\d+)\s*$/)?.[1];
    }
  }

  if (!previewPath || !previewPath.startsWith("/") || !portValue) {
    throw new Error(
      `Expected ${manifestPath} to define a root previewPath and a services.localPort.`,
    );
  }

  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid services.localPort in ${manifestPath}: ${portValue}`);
  }

  return { port, basePath: previewPath };
}

for (const app of apps) {
  const { port, basePath } = readPreviewSettings(app.manifestPath);
  console.log(`Building ${app.packageName} with PORT=${port} BASE_PATH=${basePath}`);

  const result = spawnSync(
    "pnpm",
    ["--filter", app.packageName, "run", "build"],
    {
      stdio: "inherit",
      env: { ...process.env, PORT: String(port), BASE_PATH: basePath },
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
