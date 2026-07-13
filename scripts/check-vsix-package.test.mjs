/**
 * Unit tests for the dependency-free VSIX allowlist and budget checker. Synthetic
 * package entries keep tests fast and independent of a locally built Rust binary.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  isAllowedPackagePath,
  PACKAGE_BUDGET,
  readVsixEntries,
  validateVsixPackage
} from "./check-vsix-package.mjs";

const REQUIRED_ENTRIES = [
  entry("extension.vsixmanifest", 1_000),
  entry("[Content_Types].xml", 1_000),
  entry("extension/package.json", 4_000),
  entry("extension/out/extension/activate.js", 2_000),
  entry("extension/engine/analyzer/bin/darwin-arm64/project-analyzer-engine", 1_200_000)
];

test("accepts the intended runtime package surface", () => {
  const entries = [
    ...REQUIRED_ENTRIES,
    entry("extension/readme.md", 2_000),
    entry("extension/media/project-analyzer.svg", 500),
    entry("extension/out/graph/graphStore.js", 8_000),
    entry("extension/node_modules/typescript/lib/typescript.js", 9_000_000)
  ];

  const result = validateVsixPackage(entries, 4_000_000);

  assert.deepEqual(result.errors, []);
  assert.equal(result.fileCount, entries.length);
});

test("rejects development files and undeclared runtime dependencies", () => {
  assert.equal(isAllowedPackagePath("extension/engine/analyzer/src/main.rs"), false);
  assert.equal(isAllowedPackagePath("extension/engine/analyzer/target/debug/project-analyzer-engine"), false);
  assert.equal(isAllowedPackagePath("extension/node_modules/left-pad/index.js"), false);
  assert.equal(isAllowedPackagePath("extension/node_modules/typescript/lib/lib.dom.d.ts"), false);
  assert.equal(isAllowedPackagePath("extension/out/test/unit/example.test.js"), false);

  const result = validateVsixPackage(
    [...REQUIRED_ENTRIES, entry("extension/engine/analyzer/src/main.rs", 2_000)],
    2_000_000
  );
  assert.match(result.errors.join("\n"), /unexpected package file: extension\/engine\/analyzer\/src\/main\.rs/);
});

test("reports archive, unpacked, single-file, and file-count budget violations", () => {
  const tinyBudget = {
    archiveBytes: 100,
    unpackedBytes: 100,
    fileCount: 2,
    singleFileBytes: 100
  };
  const result = validateVsixPackage(REQUIRED_ENTRIES, 101, tinyBudget);
  const errors = result.errors.join("\n");

  assert.match(errors, /archive size/);
  assert.match(errors, /file count/);
  assert.match(errors, /single file/);
  assert.match(errors, /unpacked size/);
});

test("requires the extension entrypoint and one release analyzer binary", () => {
  const result = validateVsixPackage(
    [entry("extension.vsixmanifest", 1), entry("[Content_Types].xml", 1), entry("extension/package.json", 1)],
    3
  );
  const errors = result.errors.join("\n");

  assert.match(errors, /extension\/out\/extension\/activate\.js/);
  assert.match(errors, /staged analyzer binary is missing/);
});

test("rejects packages containing native binaries for multiple targets", () => {
  const result = validateVsixPackage(
    [
      ...REQUIRED_ENTRIES,
      entry("extension/engine/analyzer/bin/linux-x64/project-analyzer-engine", 1_200_000)
    ],
    3_000_000
  );

  assert.match(result.errors.join("\n"), /expected one staged analyzer binary, found 2/);
});

test("keeps enough headroom for the known TypeScript runtime payload", () => {
  assert.equal(PACKAGE_BUDGET.archiveBytes, 15 * 1024 * 1024);
  assert.equal(PACKAGE_BUDGET.unpackedBytes, 35 * 1024 * 1024);
});

test("reads ZIP central-directory metadata without extracting payloads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "project-analyzer-vsix-test-"));
  const fixturePath = join(directory, "fixture.vsix");

  try {
    await writeFile(fixturePath, centralDirectoryOnlyArchive([
      entry("extension/package.json", 4_000),
      entry("extension/out/extension/activate.js", 2_000)
    ]));

    assert.deepEqual(await readVsixEntries(fixturePath), [
      entry("extension/package.json", 4_000),
      entry("extension/out/extension/activate.js", 2_000)
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

/** Creates one synthetic central-directory entry shape. */
function entry(path, uncompressedBytes) {
  return { compressedBytes: Math.ceil(uncompressedBytes / 2), path, uncompressedBytes };
}

/** Builds the metadata portion needed to exercise the central-directory parser. */
function centralDirectoryOnlyArchive(entries) {
  const records = entries.map((item) => {
    const fileName = Buffer.from(item.path, "utf8");
    const record = Buffer.alloc(46 + fileName.length);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt32LE(item.compressedBytes, 20);
    record.writeUInt32LE(item.uncompressedBytes, 24);
    record.writeUInt16LE(fileName.length, 28);
    fileName.copy(record, 46);
    return record;
  });
  const centralDirectory = Buffer.concat(records);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(0, 16);
  return Buffer.concat([centralDirectory, eocd]);
}
