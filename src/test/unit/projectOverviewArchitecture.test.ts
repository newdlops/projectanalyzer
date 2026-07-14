/**
 * Architecture guard for the pure Project Overview domain.
 * It prevents UI/protocol dependencies and recursive self-calls from entering
 * the bounded insight implementation.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Project Overview stays independent from application, protocol, and host UI modules", async () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const moduleRoot = path.join(projectRoot, "src", "insights", "projectOverview");
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
  }
});

test("Project Overview does not rebuild the supplied SemanticFlowIndex", async () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const moduleRoot = path.join(projectRoot, "src", "insights", "projectOverview");
  const sourceFiles = (await readdir(moduleRoot))
    .filter((fileName) => fileName.endsWith(".ts"));
  const sources = await Promise.all(sourceFiles.map((fileName) =>
    readFile(path.join(moduleRoot, fileName), "utf8")
  ));

  assert.equal(sources.some((source) => source.includes("createSemanticFlowIndex")), false);
});
