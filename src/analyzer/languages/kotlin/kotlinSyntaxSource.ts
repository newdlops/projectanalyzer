/** Lazy Kotlin parser composition and an eight-snapshot, two-MiB source-text LRU. */
import * as path from "node:path";
import { createContentHash } from "../../../shared/hash";
import { collectKotlinLineStarts } from "./kotlinSyntaxTree";
import type { KotlinSource } from "./kotlinSyntaxTypes";

/** Grammar identity is part of every snapshot fingerprint and cache key. */
export const KOTLIN_GRAMMAR_REVISION = "0f762a2314a9304e4b3fc386b1aceef1d56c7e4c";
const MAX_CACHE_ENTRIES = 8;
const MAX_CACHE_SOURCE_BYTES = 2 * 1024 * 1024;
const snapshots = new Map<string, { fingerprint: string; source: KotlinSource; bytes: number }>();
let sourceBytes = 0;
let parseCount = 0;
let parserLoads = 0;
/** A selected editor/root path wins eviction ties; no source/tree is retained outside the LRU. */
let preferredPath: string | undefined;
let parserRuntime: typeof import("./internal/kotlinParserRuntime") | undefined;

/** Parses or reuses an immutable dirty-editor snapshot; ANTLR loads only on first Kotlin use. */
export function parseKotlinSource(text: string, filePath = "<anonymous>.kt"): KotlinSource {
  const normalizedPath = normalizeKotlinPath(filePath);
  const script = normalizedPath.toLowerCase().endsWith(".kts");
  const fingerprint = createContentHash(`${normalizedPath}\0${createContentHash(text)}\0${KOTLIN_GRAMMAR_REVISION}\0${script ? "script" : "kotlinFile"}`);
  const cached = snapshots.get(normalizedPath);
  if (cached?.fingerprint === fingerprint) {
    snapshots.delete(normalizedPath);
    snapshots.set(normalizedPath, cached);
    return cached.source;
  }
  if (cached) removeSnapshot(normalizedPath);
  if (!parserRuntime) {
    // A type-only import above keeps generated ATN tables and the ANTLR runtime
    // out of extension startup and all non-Kotlin language sessions.
    parserRuntime = require("./internal/kotlinParserRuntime") as typeof import("./internal/kotlinParserRuntime");
    parserLoads += 1;
  }
  const parsed = parserRuntime.parseKotlinSyntax(text, script);
  parseCount += 1;
  const source: KotlinSource = Object.freeze({
    text, ...parsed, lineStarts: collectKotlinLineStarts(text), fingerprint,
    grammarRevision: KOTLIN_GRAMMAR_REVISION
  });
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= MAX_CACHE_SOURCE_BYTES) {
    snapshots.set(normalizedPath, { fingerprint, source, bytes });
    sourceBytes += bytes;
    while (snapshots.size > MAX_CACHE_ENTRIES || sourceBytes > MAX_CACHE_SOURCE_BYTES) {
      const oldest = [...snapshots.keys()].find((key) => key !== preferredPath)
        ?? snapshots.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      removeSnapshot(oldest);
    }
  }
  return source;
}

/** Evicts changed/deleted workspace paths; omit the path when the workspace is replaced. */
export function invalidateKotlinSyntaxCache(filePath?: string): void {
  if (filePath === undefined) disposeKotlinSyntaxCache();
  else {
    const normalizedPath = normalizeKotlinPath(filePath);
    removeSnapshot(normalizedPath);
    if (preferredPath === normalizedPath) preferredPath = undefined;
  }
}

/** Prioritizes the currently selected editor/root snapshot without increasing either cache budget. */
export function setKotlinSyntaxCachePreferredPath(filePath?: string): void {
  preferredPath = filePath === undefined ? undefined : normalizeKotlinPath(filePath);
}

/** Releases source snapshots at extension shutdown; generated code owns no external process. */
export function disposeKotlinSyntaxCache(): void {
  snapshots.clear();
  sourceBytes = 0;
  preferredPath = undefined;
}

/** Reports retained source-text budgets and lifetime parse counts for diagnostics/measurement. */
export function getKotlinSyntaxCacheStats(): Readonly<{ entries: number; sourceBytes: number; parseCount: number; parserLoads: number }> {
  return Object.freeze({ entries: snapshots.size, sourceBytes, parseCount, parserLoads });
}

/** Canonicalizes editor paths without filesystem reads or case-folding distinct Linux files. */
function normalizeKotlinPath(filePath: string): string {
  return path.resolve(filePath.replace(/\\/gu, "/"));
}

/** Removes one LRU entry while preserving the exact byte-budget invariant. */
function removeSnapshot(key: string): void {
  const cached = snapshots.get(key);
  if (!cached) return;
  snapshots.delete(key);
  sourceBytes -= cached.bytes;
}
