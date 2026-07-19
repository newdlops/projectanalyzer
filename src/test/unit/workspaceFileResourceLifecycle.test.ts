/** Tests for transient workspace reads used by full project analysis. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { inferSourceLanguageId } from "../../vscode/sourceLanguage";

test("infers analyzer language IDs without loading VS Code TextDocuments", () => {
  assert.equal(inferSourceLanguageId("/workspace/View.TSX"), "typescriptreact");
  assert.equal(inferSourceLanguageId("/workspace/widget.jsx"), "javascriptreact");
  assert.equal(inferSourceLanguageId("/workspace/service.py"), "python");
  assert.equal(inferSourceLanguageId("/workspace/Main.java"), "java");
  assert.equal(inferSourceLanguageId("/workspace/Pipeline.FSX"), "fsharp");
  assert.equal(inferSourceLanguageId("/workspace/pipeline.ml"), "ocaml");
  assert.equal(inferSourceLanguageId("/workspace/pipeline.exs"), "elixir");
  assert.equal(inferSourceLanguageId("/workspace/README"), "plaintext");
});

test("reads unopened saved files transiently and preserves already-open documents", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/vscode/workspaceFileSystem.ts"),
    "utf8"
  );

  assert.match(source, /vscode\.workspace\.fs\.readFile\(uri\)/u);
  assert.match(source, /vscode\.workspace\.textDocuments/u);
  assert.match(source, /openDocument\.getText\(\)/u);
  assert.doesNotMatch(source, /workspace\.openTextDocument/u);
});

test("streams analyzer input and disposes owned child processes with extension services", () => {
  const backend = readFileSync(
    resolve(process.cwd(), "src/analyzer/rust/rustAnalyzerBackend.ts"),
    "utf8"
  );
  const services = readFileSync(
    resolve(process.cwd(), "src/extension/extensionServices.ts"),
    "utf8"
  );

  assert.match(backend, /createWorkspaceSourceManifestInput\(sourceFiles\)/u);
  assert.match(backend, /Readable\.from\(stdin, \{ objectMode: false \}\)/u);
  assert.match(backend, /inputStream\?\.destroy\(\)/u);
  assert.match(backend, /for \(const process of this\.activeProcesses\)/u);
  assert.match(services, /context\.subscriptions\.push\(analyzer\)/u);
  assert.match(services, /context\.subscriptions\.push\(moduleVisualizerPanelProvider\)/u);
});
