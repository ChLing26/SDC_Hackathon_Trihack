import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const apps = [
  {
    name: "ProcureFlow",
    packageName: "@workspace/procurement-workspace",
    manifestPath: "artifacts/procurement-workspace/.replit-artifact/artifact.toml",
  },
  {
    name: "Canvas",
    packageName: "@workspace/mockup-sandbox",
    manifestPath: "artifacts/mockup-sandbox/.replit-artifact/artifact.toml",
  },
];

function readPreviewSettings(app) {
  const { name, manifestPath } = app;
  const artifact = `${name} (${manifestPath})`;
  const manifest = readFileSync(resolve(manifestPath), "utf8");
  let section = "";
  let previewPath;
  let portValue;
  let configuredPort;
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
    } else if (section === "services") {
      portValue ??= trimmed.match(/^localPort\s*=\s*(\d+)\s*$/)?.[1];
    } else if (section === "services.env") {
      configuredPort ??= trimmed.match(/^PORT\s*=\s*"([^"]+)"\s*$/)?.[1];
      configuredBasePath ??= trimmed.match(/^BASE_PATH\s*=\s*"([^"]+)"\s*$/)?.[1];
    }
  }

  if (!previewPath || !previewPath.startsWith("/") || !portValue) {
    throw new Error(
      `Expected ${artifact} to define a root previewPath and a services.localPort.`,
    );
  }
  if (!configuredPort || !configuredBasePath) {
    throw new Error(
      `Expected ${artifact} to define [services.env].PORT and [services.env].BASE_PATH.`,
    );
  }

  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid services.localPort in ${artifact}: ${portValue}`);
  }

  if (configuredPort !== String(port)) {
    throw new Error(
      `${artifact} declares services.localPort=${port} but [services.env].PORT="${configuredPort}". These ports must match.`,
    );
  }
  if (configuredBasePath !== previewPath) {
    throw new Error(
      `${artifact} declares previewPath="${previewPath}" but [services.env].BASE_PATH="${configuredBasePath}". These paths must match.`,
    );
  }

  return { port, basePath: previewPath };
}

// Validate every artifact before starting any build, so a later mismatch cannot
// be discovered only after an earlier artifact has already produced output.
const configuredApps = apps.map((app) => ({
  ...app,
  ...readPreviewSettings(app),
}));

if (process.argv.includes("--check-only")) {
  for (const app of configuredApps) {
    console.log(`${app.name} preview settings match its manifest.`);
  }
  process.exit(0);
}

for (const app of configuredApps) {
  console.log(`Building ${app.packageName} with PORT=${app.port} BASE_PATH=${app.basePath}`);

  const result = spawnSync(
    "pnpm",
    ["--filter", app.packageName, "run", "build"],
    {
      stdio: "inherit",
      env: { ...process.env, PORT: String(app.port), BASE_PATH: app.basePath },
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
