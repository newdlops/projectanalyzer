/**
 * Stages the current platform's release analyzer binary for VSIX packaging.
 * Cargo target output stays a development artifact and is never packaged.
 */

import { chmod, copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineRoot = path.join(projectRoot, "engine", "analyzer");
const binaryName = process.platform === "win32"
  ? "project-analyzer-engine.exe"
  : "project-analyzer-engine";
const sourceBinary = path.join(engineRoot, "target", "release", binaryName);
const runtimeRoot = path.join(engineRoot, "bin");
const runtimeDirectory = path.join(runtimeRoot, `${process.platform}-${process.arch}`);
const runtimeBinary = path.join(runtimeDirectory, binaryName);

/** Copies one verified release executable into the platform-specific runtime directory. */
async function stageRuntimeEngine() {
  const sourceStat = await stat(sourceBinary).catch(() => undefined);

  if (!sourceStat?.isFile() || sourceStat.size === 0) {
    throw new Error(`Release analyzer binary is missing: ${sourceBinary}`);
  }

  // The directory is generated. Clearing it prevents stale binaries for other
  // platforms from silently turning a target-specific VSIX into a mixed package.
  await rm(runtimeRoot, { force: true, recursive: true });
  await mkdir(runtimeDirectory, { recursive: true });
  await copyFile(sourceBinary, runtimeBinary);

  if (process.platform !== "win32") {
    await chmod(runtimeBinary, 0o755);
  }

  const runtimeStat = await stat(runtimeBinary);
  process.stdout.write(
    `Staged ${path.relative(projectRoot, runtimeBinary)} (${runtimeStat.size} bytes)\n`
  );
}

await stageRuntimeEngine();
