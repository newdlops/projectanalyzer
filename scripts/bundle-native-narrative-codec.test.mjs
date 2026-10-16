/** Real relocated CommonJS bundles keep their locked validator, JSON semantics and bounded cycle/depth behavior. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { bundleNativeNarrativeCodec } from './bundle-native-narrative-codec.mjs';

test('relocated native bundle validates with no physical vendor tree and preserves JSON prototype-named data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-codec-bundle-'));
  try {
    const entry = path.join(directory, 'index.js');
    await writeFile(entry, 'const Ajv=require("ajv"); const data=require("./data.json"); const validate=new Ajv({strict:false}).compile({type:"object",properties:{value:{type:"integer"}},required:["value"],additionalProperties:false});module.exports={validate,data};');
    await writeFile(path.join(directory, 'data.json'), '{"__proto__":{"literal":true},"source":"whole 😀\\r\\n"}');
    const report = await bundleNativeNarrativeCodec(entry); assert.ok(report.vendorModules > 0); assert.ok(report.bytes < 1024 * 1024);
    const relocated = path.join(directory, 'isolated'); await mkdir(relocated); await writeFile(path.join(relocated, 'index.js'), await readFile(entry));
    const loaded = createRequire(import.meta.url)(path.join(relocated, 'index.js'));
    assert.equal(loaded.validate({ value: 4 }), true); assert.equal(loaded.validate({ value: '4' }), false); assert.equal(loaded.validate({ value: 4, extra: true }), false);
    assert.equal(Object.hasOwn(loaded.data, '__proto__'), true); assert.equal(loaded.data.__proto__.literal, true); assert.equal(loaded.data.source, 'whole 😀\r\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('native bundle cache preserves CommonJS cycle termination and independent modules', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-codec-cycle-'));
  try {
    const entry = path.join(directory, 'index.js'); await writeFile(entry, 'exports.name="first";exports.second=require("./second").name;');
    await writeFile(path.join(directory, 'second.js'), 'exports.name="second";exports.first=require("./index").name;');
    await bundleNativeNarrativeCodec(entry); const loaded = createRequire(import.meta.url)(entry); assert.deepEqual(loaded, { name: 'first', second: 'second' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('native bundle rejects a dependency chain beyond its explicit CommonJS depth bound', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-codec-depth-'));
  try {
    for (let index = 0; index < 130; index++) await writeFile(path.join(directory, index === 0 ? 'index.js' : 'part' + index + '.js'), index === 129 ? 'module.exports=1;' : 'module.exports=require("./part' + (index + 1) + '");');
    const entry = path.join(directory, 'index.js'); await bundleNativeNarrativeCodec(entry); assert.throws(() => createRequire(import.meta.url)(entry), /CommonJS depth limit/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
