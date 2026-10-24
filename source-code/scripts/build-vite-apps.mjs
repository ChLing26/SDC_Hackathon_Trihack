import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const apps = [
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

export function readPreviewSettings(app, cwd = process.cwd()) {
  const { name, manifestPath } = app;
  const artifact = `${name} (${manifestPath})`;
  const manifest = readFileSync(resolve(cwd, manifestPath), "utf8");
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
      portValue ??= trimmed.match(/^localPort\s*=\s*(.*?)\s*$/)?.[1];
    } else if (section === "services.env") {
      configuredPort ??= trimmed.match(/^PORT\s*=\s*"([^"]+)"\s*$/)?.[1];
      configuredBasePath ??= trimmed.match(/^BASE_PATH\s*=\s*"([^"]+)"\s*$/)?.[1];
    }
  }

  if (!previewPath) {
    throw new Error(`Expected ${artifact} to define a root previewPath.`);
  }
  if (!previewPath.startsWith("/")) {
    throw new Error(`Expected ${artifact} previewPath to start with "/": "${previewPath}".`);
  }
  if (portValue === undefined) {
    throw new Error(`Expected ${artifact} to define services.localPort.`);
  }
  if (!configuredPort || !configuredBasePath) {
    throw new Error(
      `Expected ${artifact} to define [services.env].PORT and [services.env].BASE_PATH.`,
    );
  }

  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
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

export function buildApps({
  appConfigs = apps,
  cwd = process.cwd(),
  spawn = spawnSync,
  env = process.env,
  log = console.log,
  checkOnly = false,
} = {}) {
  // Validate every artifact before starting any build, so a later mismatch cannot
  // be discovered only after an earlier artifact has already produced output.
  const configuredApps = appConfigs.map((app) => ({
    ...app,
    ...readPreviewSettings(app, cwd),
  }));

  if (checkOnly) {
    for (const app of configuredApps) {
      log(`${app.name} preview settings match its manifest.`);
    }
    return 0;
  }

  for (const app of configuredApps) {
    log(`Building ${app.packageName} with PORT=${app.port} BASE_PATH=${app.basePath}`);

    const result = spawn(
      "pnpm",
      ["--filter", app.packageName, "run", "build"],
      {
        stdio: "inherit",
        env: { ...env, PORT: String(app.port), BASE_PATH: app.basePath },
      },
    );

    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(buildApps({ checkOnly: process.argv.includes("--check-only") }));
}
