/** Removes unused, empty TypeScript emit artifacts while preserving every statically required module. */
import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Scans generated JavaScript only. A runtime value or side effect always preserves the module. */
export async function pruneTypeOnlyOutput(directory) {
  const queue = [directory]; const sources = new Map(); const referenced = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    for (const entry of await readdir(queue[index], { withFileTypes: true })) {
      const file = path.join(queue[index], entry.name);
      if (entry.isDirectory()) queue.push(file);
      else if (entry.isFile() && file.endsWith(".js")) sources.set(file, await readFile(file, "utf8"));
    }
  }
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/\brequire\(["'](\.[^"']+)["']\)/gu)) {
      const target = path.resolve(path.dirname(file), match[1]);
      referenced.add(target.endsWith(".js") ? target : target + ".js");
      referenced.add(path.join(target, "index.js"));
    }
  }
  const removed = [];
  for (const [file, source] of sources) {
    const executable = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/[^\n]*$/gmu, "").trim();
    if (!referenced.has(file) && /^"use strict";\s*Object\.defineProperty\(exports, "__esModule", \{ value: true \}\);$/u.test(executable)) {
      await unlink(file); removed.push(path.relative(directory, file));
    }
  }
  return removed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const removed = await pruneTypeOnlyOutput(path.join(projectRoot, "out"));
  console.log(`Omitted ${removed.length} unused type-only JavaScript artifacts.`);
}
