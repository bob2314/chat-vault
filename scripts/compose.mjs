#!/usr/bin/env node
import { spawnSync, spawn } from "node:child_process";

function hasDockerComposePlugin() {
  const result = spawnSync("docker", ["compose", "version"], { stdio: "pipe", encoding: "utf8" });
  return result.status === 0;
}

function hasDockerComposeLegacy() {
  const result = spawnSync("docker-compose", ["version"], { stdio: "pipe", encoding: "utf8" });
  return result.status === 0;
}

function resolveComposeCommand() {
  if (hasDockerComposePlugin()) {
    return { command: "docker", baseArgs: ["compose"] };
  }
  if (hasDockerComposeLegacy()) {
    return { command: "docker-compose", baseArgs: [] };
  }
  return null;
}

function main() {
  const action = process.argv[2];
  const passthrough = process.argv.slice(3);
  if (!action) {
    console.error("Usage: node scripts/compose.mjs <up|down|logs|...> [args]");
    process.exit(1);
  }

  const resolved = resolveComposeCommand();
  if (!resolved) {
    console.error("Neither `docker compose` nor `docker-compose` is available in PATH.");
    process.exit(1);
  }

  const args = [...resolved.baseArgs, action, ...passthrough];
  const shouldStream = action === "logs";
  const child = shouldStream
    ? spawn(resolved.command, args, { stdio: "inherit", shell: true })
    : spawnSync(resolved.command, args, { stdio: "inherit", shell: true });

  if (shouldStream) {
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  process.exit(child.status ?? 1);
}

main();
