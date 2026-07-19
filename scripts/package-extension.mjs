/**
 * Builds a target-specific VSIX and enforces the production package budget.
 * The VS Code prepublish hook stages the matching native analyzer beforehand.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const target = getVsceTarget(process.platform, process.arch);
const outputPath = path.resolve(
  projectRoot,
  process.argv[2] ?? `project-analyzer-${packageJson.version}-${target}.vsix`
);

run(process.platform === "win32" ? "vsce.cmd" : "vsce", [
  "package",
  "--allow-missing-repository",
  "--target",
  target,
  "--out",
  outputPath
]);
run(process.execPath, [path.join(projectRoot, "scripts", "check-vsix-package.mjs"), outputPath]);

/** Maps the native Node runtime pair to a VS Code Marketplace target name. */
function getVsceTarget(platform, arch) {
  const targets = {
    "darwin-arm64": "darwin-arm64",
    "darwin-x64": "darwin-x64",
    "linux-arm": "linux-armhf",
    "linux-arm64": "linux-arm64",
    "linux-x64": "linux-x64",
    "win32-arm64": "win32-arm64",
    "win32-ia32": "win32-ia32",
    "win32-x64": "win32-x64"
  };
  const runtimeKey = `${platform}-${arch}`;
  const target = targets[runtimeKey];

  if (!target) {
    throw new Error(`Unsupported VSIX runtime target: ${runtimeKey}`);
  }

  return target;
}

/** Runs one packaging phase with inherited output and stable failure handling. */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
  }
}
