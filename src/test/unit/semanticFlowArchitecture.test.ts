/**
 * Architecture guard for the pure SemanticFlow domain. It prevents later UI
 * work from pulling protocol, Webview, or VS Code dependencies into insights.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("SemanticFlow domain stays independent from protocol and host UI modules", async () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const moduleRoot = path.join(projectRoot, "src", "insights", "semanticFlow");
  const sourceFiles = (await readdir(moduleRoot))
    .filter((fileName) => fileName.endsWith(".ts"))
    .sort();

  assert.ok(sourceFiles.length > 0);

  for (const fileName of sourceFiles) {
    const source = await readFile(path.join(moduleRoot, fileName), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:protocol|webview|vscode)[^"']*["']/u);
  }
});
