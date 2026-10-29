/** Distribution bundling must preserve public exports, module caching and Node boundaries after private files are omitted. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
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

test('packaged directory helpers retain nested Node boundaries after their source tree is omitted', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'narrative-directory-bundle-'));
  const runtime = path.join(directory, 'runtime'), captured = path.join(runtime, 'captured'), entry = path.join(runtime, 'index.js');
  try {
    await mkdir(captured, { recursive: true });
    await writeFile(path.join(directory, 'shared.cjs'), 'exports.value=37;');
    await writeFile(path.join(runtime, 'context.js'), 'exports.value=5;');
    await writeFile(entry, 'const one=require("./captured");module.exports={one,same:one===require("./captured/index.js")};');
    await writeFile(path.join(captured, 'index.js'), 'module.exports={value:require("./plan").value,dirname:__dirname,filename:__filename};');
    await writeFile(path.join(captured, 'plan.js'), 'exports.value=require("../../shared.cjs").value+require("../context").value;');
    const result = await bundleLocalNarrativeRuntime(entry);
    assert.equal(result.modules, 4);
    await rm(captured, { recursive: true });
    await rm(path.join(runtime, 'context.js'));
    const originalDirectory = path.join(await realpath(runtime), 'captured');
    assert.deepEqual(require(entry), { one: { value: 42, dirname: originalDirectory, filename: path.join(originalDirectory, 'index.js') }, same: true });
  } finally { delete require.cache[entry]; await rm(directory, { recursive: true, force: true }); }
});

test('multiple packaged public facades retain one shared internal module identity', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'narrative-facade-bundle-'));
  const entry = path.join(directory, 'index.js'), syntax = path.join(directory, 'syntax.js');
  const bundle = path.join(directory, '__bundle.js');
  try {
    await writeFile(entry, 'exports.shared=require("./shared");exports.syntax=require("./syntax");');
    await writeFile(syntax, 'exports.shared=require("./shared");');
    await writeFile(path.join(directory, 'shared.js'), 'module.exports={marker:"one instance"};');
    const result = await bundleLocalNarrativeRuntime(entry, { additionalEntries: [syntax], sharedBundleFile: '__bundle.js' });
    assert.equal(result.modules, 3); assert.equal(result.entrypoints, 2);
    await rm(path.join(directory, 'shared.js'));
    const one = require(entry), two = require(syntax);
    assert.equal(one.shared, two.shared);
    assert.equal(one.syntax, two);
    assert.equal(one.shared.marker, 'one instance');
  } finally {
    for (const file of [entry, syntax, bundle]) delete require.cache[file];
    await rm(directory, { recursive: true, force: true });
  }
});
