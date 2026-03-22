#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";

const cwd = process.cwd();

function parseEnv(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function runOrExit(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveComposeRunner() {
  const plugin = spawnSync("docker", ["compose", "version"], { stdio: "pipe", encoding: "utf8", shell: true });
  if (plugin.status === 0) {
    return { command: "docker", baseArgs: ["compose"] };
  }
  const legacy = spawnSync("docker-compose", ["version"], { stdio: "pipe", encoding: "utf8", shell: true });
  if (legacy.status === 0) {
    return { command: "docker-compose", baseArgs: [] };
  }
  return null;
}

function readEnv() {
  const envPath = path.join(cwd, ".env.local");
  if (!fs.existsSync(envPath)) return {};
  return parseEnv(fs.readFileSync(envPath, "utf8"));
}

function startDevServer() {
  console.log("\n==> Starting dev server");
  const child = spawn("npm", ["run", "dev"], {
    stdio: "inherit",
    shell: true
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function main() {
  runOrExit("Running preflight", "node", ["scripts/preflight.mjs"]);

  const env = readEnv();
  const dbProvider = (env.DB_PROVIDER || "sqlite").toLowerCase();
  const searchProvider = (env.SEARCH_PROVIDER || (dbProvider === "postgres" ? "postgres" : "sqlite")).toLowerCase();
  const needsDocker = dbProvider === "postgres" || searchProvider === "typesense";

  if (needsDocker) {
    const compose = resolveComposeRunner();
    if (!compose) {
      console.error("\nNo Docker Compose command found. Install Docker Desktop and ensure either `docker compose` or `docker-compose` works.");
      process.exit(1);
    }
    runOrExit("Starting local infra", compose.command, [...compose.baseArgs, "up", "-d"]);
  } else {
    console.log("\n==> Skipping docker infra (SQLite mode)");
  }

  runOrExit("Initializing database", "npm", ["run", "db:init"]);
  runOrExit("Seeding sample data", "npm", ["run", "db:seed"]);
  startDevServer();
}

main();
