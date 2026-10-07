/** Distribution bundling must preserve public exports, module caching and Node boundaries after private files are omitted. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { bundleLocalNarrativeRuntime } from './bundle-local-narrative-runtime.mjs';
const require = createRequire(import.meta.url);

test('packaged helpers preserve cyclic cache, external require and original directory after omission', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'narrative-bundle-'));
  const entry = path.join(directory, 'index.js');
  try {
    await writeFile(entry, 'exports.marker="ready"; const helper=require("./helper"); module.exports={marker:helper.marker,second:require("./helper").marker,dirname:helper.dirname,basename:helper.basename};');
    await writeFile(path.join(directory, 'helper.js'), 'const entry=require("./index"); exports.marker=entry.marker;exports.dirname=__dirname;exports.basename=require("node:path").basename(__filename);');
    const result = await bundleLocalNarrativeRuntime(entry);
    assert.equal(result.modules, 2);
    await rm(path.join(directory, 'helper.js'));
    assert.deepEqual(require(entry), { marker: 'ready', second: 'ready', dirname: await realpath(directory), basename: 'helper.js' });
  } finally { delete require.cache[entry]; await rm(directory, { recursive: true, force: true }); }
});
