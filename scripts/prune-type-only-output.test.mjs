/** Packaging cleanup must retain runtime values, side effects and required empty-module compatibility. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pruneTypeOnlyOutput } from "./prune-type-only-output.mjs";

test("omits unused type emit without removing runtime exports, effects or required modules", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "function-analysis-package-"));
  const empty = '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n';
  try {
    for (const [name, source] of Object.entries({
      "types.js": empty + "/** Source contracts only. */\n//# sourceMappingURL=types.js.map\n",
      "compatibility.js": empty,
      "entry.js": 'require("./compatibility"); module.exports = { ready: true };',
      "runtime.js": empty + "exports.supported = true;",
      "effect.js": empty + "globalThis.registered = true;"
    })) await writeFile(path.join(directory, name), source);
    assert.deepEqual(await pruneTypeOnlyOutput(directory), ["types.js"]);
    assert.deepEqual((await readdir(directory)).sort(), ["compatibility.js", "effect.js", "entry.js", "runtime.js"]);
    assert.deepEqual(await pruneTypeOnlyOutput(directory), [], "repeat cleanup must preserve its runtime surface");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
