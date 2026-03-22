#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const envExamplePath = path.join(cwd, ".env.example");
const envLocalPath = path.join(cwd, ".env.local");
const legacyEnvLocalPath = path.join(cwd, "env.local");

function parseEnv(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function run(command, args) {
  return spawnSync(command, args, { stdio: "pipe", encoding: "utf8" });
}

function hasDocker() {
  const plugin = run("docker", ["compose", "version"]);
  if (plugin.status === 0) return true;
  const legacy = run("docker-compose", ["version"]);
  return legacy.status === 0;
}

function ensureEnvFile(messages) {
  if (fs.existsSync(envLocalPath)) {
    return envLocalPath;
  }

  if (fs.existsSync(legacyEnvLocalPath)) {
    fs.copyFileSync(legacyEnvLocalPath, envLocalPath);
    messages.push("Created `.env.local` from existing `env.local`.");
    return envLocalPath;
  }

  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envLocalPath);
    messages.push("Created `.env.local` from `.env.example`.");
    return envLocalPath;
  }

  return null;
}

function main() {
  const info = [];
  const warnings = [];
  const errors = [];

  const major = Number(process.versions.node.split(".")[0] || "0");
  if (major !== 20) {
    errors.push(`Node ${process.version} detected. This project expects Node 20.x.`);
  } else {
    info.push(`Node ${process.version} OK.`);
  }

  const envPath = ensureEnvFile(info);
  if (!envPath) {
    errors.push("No `.env.local`, `env.local`, or `.env.example` found.");
  }

  let env = {};
  if (envPath) {
    env = parseEnv(fs.readFileSync(envPath, "utf8"));
  }

  const dbProvider = (env.DB_PROVIDER || "sqlite").toLowerCase();
  const searchProvider = (env.SEARCH_PROVIDER || (dbProvider === "postgres" ? "postgres" : "sqlite")).toLowerCase();
  const needsDocker = dbProvider === "postgres" || searchProvider === "typesense";

  if (dbProvider === "postgres" && !env.DATABASE_URL) {
    errors.push("`DB_PROVIDER=postgres` requires `DATABASE_URL` in `.env.local`.");
  }

  if (needsDocker) {
    if (!hasDocker()) {
      errors.push(
        "Docker Compose is required for current settings. Install Docker Desktop, then verify either `docker compose version` or `docker-compose version`."
      );
    } else {
      info.push("Docker + Compose OK.");
    }
  } else {
    warnings.push("Docker not required for current settings (SQLite mode).");
  }

  console.log("Preflight check:");
  for (const line of info) console.log(`- ${line}`);
  for (const line of warnings) console.log(`- Warning: ${line}`);

  if (errors.length) {
    for (const line of errors) console.error(`- Error: ${line}`);
    process.exit(1);
  }
}

main();
