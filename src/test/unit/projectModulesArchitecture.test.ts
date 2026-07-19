/**
 * Architecture guards for the pure project-module insight.
 * They prevent UI, protocol, Extension Host, and filesystem concerns from
 * entering boundary inference or relation aggregation.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("project modules stay independent from application and host UI modules", async () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const moduleRoot = path.join(projectRoot, "src", "insights", "projectModules");
  const sourceFiles = (await readdir(moduleRoot))
    .filter((fileName) => fileName.endsWith(".ts"))
    .sort();

  assert.ok(sourceFiles.length >= 5);

  for (const fileName of sourceFiles) {
    const source = await readFile(path.join(moduleRoot, fileName), "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:application|extension|protocol|webview|vscode)[^"']*["']/u
    );
    assert.doesNotMatch(source, /from\s+["'][^"']*projectReadingGuide[^"']*["']/u);
  }
});

test("module ownership and descendant aggregation use explicit iterative guards", async () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const boundarySource = await readFile(
    path.join(projectRoot, "src", "insights", "projectModules", "moduleBoundaries.ts"),
    "utf8"
  );
  const indexSource = await readFile(
    path.join(projectRoot, "src", "insights", "projectModules", "projectModuleIndex.ts"),
    "utf8"
  );

  assert.match(boundarySource, /while \(!visited\.has\(currentKey\)\)/u);
  assert.match(indexSource, /while \(parentModuleId && !visited\.has\(parentModuleId\)\)/u);
});
