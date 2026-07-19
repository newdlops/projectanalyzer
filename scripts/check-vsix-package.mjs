/**
 * VSIX package boundary and size-budget checker. It reads ZIP metadata with only
 * Node.js built-ins so packaging regressions can fail CI without a new dependency.
 */

import { open, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MEBIBYTE = 1024 * 1024;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY_SIGNATURE = 0x02014b50;
const MAX_ZIP_COMMENT_BYTES = 65_535;

/** Release-package limits, including ZIP metadata and unpacked extension files. */
export const PACKAGE_BUDGET = Object.freeze({
  archiveBytes: 15 * MEBIBYTE,
  unpackedBytes: 35 * MEBIBYTE,
  fileCount: 400,
  singleFileBytes: 12 * MEBIBYTE
});

const REQUIRED_PATHS = Object.freeze([
  "extension.vsixmanifest",
  "[Content_Types].xml",
  "extension/package.json",
  "extension/out/extension/activate.js"
]);

const NATIVE_ENGINE_PATH_PATTERN =
  /^extension\/engine\/analyzer\/bin\/(?:darwin|linux|win32)-(?:arm64|x64|arm|ia32)\/project-analyzer-engine(?:\.exe)?$/;

const TYPESCRIPT_RUNTIME_PATHS = new Set([
  "extension/node_modules/typescript/package.json",
  "extension/node_modules/typescript/LICENSE.txt",
  "extension/node_modules/typescript/ThirdPartyNoticeText.txt",
  "extension/node_modules/typescript/lib/typescript.js"
]);

const LEZER_RUNTIME_PATH_PATTERN =
  /^extension\/node_modules\/@lezer\/(?:common|highlight|java|lr|python)\/(?:package\.json|LICENSE|dist\/index\.cjs)$/;

/**
 * Reads central-directory entries from a VSIX without inflating file contents.
 * The resulting sizes are the values VS Code sees while downloading/installing.
 */
export async function readVsixEntries(vsixPath) {
  const file = await open(vsixPath, "r");

  try {
    const metadata = await file.stat();
    const tailLength = Math.min(metadata.size, MAX_ZIP_COMMENT_BYTES + 22);
    const tail = Buffer.alloc(tailLength);
    await readExactly(file, tail, metadata.size - tailLength);
    const eocdOffset = findEndOfCentralDirectory(tail);

    if (eocdOffset < 0) {
      throw new Error("End-of-central-directory record was not found; the VSIX is not a supported ZIP archive.");
    }

    const entryCount = tail.readUInt16LE(eocdOffset + 10);
    const directoryBytes = tail.readUInt32LE(eocdOffset + 12);
    const directoryOffset = tail.readUInt32LE(eocdOffset + 16);

    if (entryCount === 0xffff || directoryBytes === 0xffffffff || directoryOffset === 0xffffffff) {
      throw new Error("ZIP64 VSIX archives are not supported by the package budget checker.");
    }

    const directory = Buffer.alloc(directoryBytes);
    await readExactly(file, directory, directoryOffset);
    return parseCentralDirectory(directory, entryCount);
  } finally {
    await file.close();
  }
}

/**
 * Validates a parsed VSIX against the runtime-file allowlist and explicit budgets.
 * It returns every category of violation so one packaging run is enough to diagnose.
 */
export function validateVsixPackage(entries, archiveBytes, budget = PACKAGE_BUDGET) {
  const errors = [];
  const files = entries.filter((entry) => !entry.path.endsWith("/"));
  const paths = new Set();
  let unpackedBytes = 0;

  if (archiveBytes > budget.archiveBytes) {
    errors.push(`archive size ${formatBytes(archiveBytes)} exceeds ${formatBytes(budget.archiveBytes)}`);
  }
  if (files.length > budget.fileCount) {
    errors.push(`file count ${files.length} exceeds ${budget.fileCount}`);
  }

  for (const entry of entries) {
    if (!isSafeArchivePath(entry.path, entry.path.endsWith("/"))) {
      errors.push(`unsafe archive path: ${entry.path}`);
    }
  }

  for (const entry of files) {
    unpackedBytes += entry.uncompressedBytes;

    if (paths.has(entry.path)) {
      errors.push(`duplicate archive path: ${entry.path}`);
    }
    paths.add(entry.path);

    if (isSafeArchivePath(entry.path, false) && !isAllowedPackagePath(entry.path)) {
      errors.push(`unexpected package file: ${entry.path}`);
    }

    if (entry.uncompressedBytes > budget.singleFileBytes) {
      errors.push(
        `single file ${entry.path} is ${formatBytes(entry.uncompressedBytes)}; limit is ${formatBytes(budget.singleFileBytes)}`
      );
    }
  }

  if (unpackedBytes > budget.unpackedBytes) {
    errors.push(`unpacked size ${formatBytes(unpackedBytes)} exceeds ${formatBytes(budget.unpackedBytes)}`);
  }

  for (const requiredPath of REQUIRED_PATHS) {
    if (!paths.has(requiredPath)) {
      errors.push(`required package file is missing: ${requiredPath}`);
    }
  }
  const nativeEnginePaths = [...paths].filter((archivePath) =>
    NATIVE_ENGINE_PATH_PATTERN.test(archivePath)
  );
  if (nativeEnginePaths.length === 0) {
    errors.push("required staged analyzer binary is missing");
  } else if (nativeEnginePaths.length > 1) {
    errors.push(`expected one staged analyzer binary, found ${nativeEnginePaths.length}`);
  }

  return {
    archiveBytes,
    errors,
    fileCount: files.length,
    unpackedBytes
  };
}

/** Defines the intentionally narrow production surface shipped to VS Code. */
export function isAllowedPackagePath(archivePath) {
  if (REQUIRED_PATHS.includes(archivePath) || NATIVE_ENGINE_PATH_PATTERN.test(archivePath)) {
    return true;
  }

  if (/^extension\/(?:readme|changelog|license)(?:\.[^/]+)?$/i.test(archivePath)) {
    return true;
  }
  if (/^extension\/media\/[^/]+\.(?:svg|png|webp)$/i.test(archivePath)) {
    return true;
  }
  if (/^extension\/out\/(?!test\/).+\.(?:js|json)$/i.test(archivePath)) {
    return true;
  }
  if (LEZER_RUNTIME_PATH_PATTERN.test(archivePath)) {
    return true;
  }

  // TypeScript remains a self-contained runtime module. Compiler binaries,
  // declarations, translations, and server files are packaging waste.
  return TYPESCRIPT_RUNTIME_PATHS.has(archivePath);
}

/** Parses all fixed-size and variable-size central-directory records. */
function parseCentralDirectory(directory, expectedEntryCount) {
  const entries = [];
  let offset = 0;

  while (offset < directory.length && entries.length < expectedEntryCount) {
    if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY_SIGNATURE) {
      throw new Error(`Invalid central-directory entry at byte ${offset}.`);
    }

    const flags = directory.readUInt16LE(offset + 8);
    const compressedBytes = directory.readUInt32LE(offset + 20);
    const uncompressedBytes = directory.readUInt32LE(offset + 24);
    const fileNameBytes = directory.readUInt16LE(offset + 28);
    const extraBytes = directory.readUInt16LE(offset + 30);
    const commentBytes = directory.readUInt16LE(offset + 32);
    const recordBytes = 46 + fileNameBytes + extraBytes + commentBytes;

    if (offset + recordBytes > directory.length) {
      throw new Error(`Truncated central-directory entry at byte ${offset}.`);
    }
    if ((flags & 0x1) !== 0) {
      throw new Error("Encrypted VSIX entries are not supported.");
    }
    if (compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) {
      throw new Error("ZIP64 VSIX entries are not supported by the package budget checker.");
    }

    entries.push({
      compressedBytes,
      path: directory.subarray(offset + 46, offset + 46 + fileNameBytes).toString("utf8"),
      uncompressedBytes
    });
    offset += recordBytes;
  }

  if (entries.length !== expectedEntryCount || offset !== directory.length) {
    throw new Error(
      `Central-directory entry count mismatch: expected ${expectedEntryCount}, parsed ${entries.length}.`
    );
  }

  return entries;
}

/** Finds the last valid EOCD signature because a ZIP comment may contain the same bytes. */
function findEndOfCentralDirectory(tail) {
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (
      tail.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE &&
      offset + 22 + tail.readUInt16LE(offset + 20) === tail.length
    ) {
      return offset;
    }
  }
  return -1;
}

/** Reads the requested buffer fully, rejecting truncated/corrupt archives. */
async function readExactly(file, buffer, position) {
  let bytesRead = 0;

  while (bytesRead < buffer.length) {
    const result = await file.read(buffer, bytesRead, buffer.length - bytesRead, position + bytesRead);
    if (result.bytesRead === 0) {
      throw new Error("Unexpected end of VSIX archive.");
    }
    bytesRead += result.bytesRead;
  }
}

/** Rejects traversal, platform separators, absolute paths, and ambiguous names. */
function isSafeArchivePath(archivePath, isDirectory) {
  const pathToInspect = isDirectory ? archivePath.slice(0, -1) : archivePath;
  return (
    pathToInspect.length > 0 &&
    !pathToInspect.startsWith("/") &&
    !pathToInspect.includes("\\") &&
    !pathToInspect.includes("\0") &&
    !pathToInspect.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

/** Formats byte counts for concise local and CI diagnostics. */
function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < MEBIBYTE) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / MEBIBYTE).toFixed(2)} MiB`;
}

/** Runs the checker as a command-line program. */
async function main() {
  const vsixPath = process.argv[2];
  if (!vsixPath) {
    throw new Error("Usage: node scripts/check-vsix-package.mjs <extension.vsix>");
  }

  const [entries, metadata] = await Promise.all([readVsixEntries(vsixPath), stat(vsixPath)]);
  const result = validateVsixPackage(entries, metadata.size);
  const summary =
    `${vsixPath}: ${result.fileCount} files, ${formatBytes(result.archiveBytes)} archive, ` +
    `${formatBytes(result.unpackedBytes)} unpacked`;

  if (result.errors.length > 0) {
    const visibleErrors = result.errors.slice(0, 20);
    const omitted = result.errors.length - visibleErrors.length;
    console.error(`VSIX package check failed: ${summary}`);
    for (const error of visibleErrors) {
      console.error(`- ${error}`);
    }
    if (omitted > 0) {
      console.error(`- ... ${omitted} more violation(s)`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`VSIX package check passed: ${summary}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
