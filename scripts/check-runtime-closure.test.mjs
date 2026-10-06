/** Runtime packaging must keep executable dependencies while excluding genuinely dormant modules. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateRuntimeClosure } from "./check-runtime-closure.mjs";

test("shipped entry resolves file, directory and JSON dependencies without needing dormant outputs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "function-analysis-closure-"));
  try {
    await mkdir(path.join(directory, "feature"));
    const sources = {
      "entry.js": 'require("./helper"); require("./feature"); require("./config.json"); require("node:fs");',
      "helper.js": 'const text = "require(unknown)"; // require("./unused")\nexports.text = text;',
      "feature/index.js": 'module.exports = { active: true };',
      "dormant.js": 'require("./not-shipped");'
    };
    for (const [name, source] of Object.entries(sources)) await writeFile(path.join(directory, name), source);
    const entries = ["entry.js", "helper.js", "feature/index.js", "config.json"].map(name => ({ path: "extension/out/" + name }));
    assert.deepEqual(await validateRuntimeClosure(entries, directory), []);
    const missing = await validateRuntimeClosure(entries.filter(entry => !entry.path.endsWith("helper.js")), directory);
    assert.deepEqual(missing, ["missing runtime dependency: extension/out/entry.js -> ./helper"]);
    await writeFile(path.join(directory, "entry.js"), "require(process.env.MODULE_PATH);");
    assert.deepEqual(await validateRuntimeClosure(entries, directory), ["unverifiable dynamic require in extension/out/entry.js"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
