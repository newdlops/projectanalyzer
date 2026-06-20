/**
 * Hash helpers for source snapshots and cache keys. Centralizing hashing keeps
 * workspace scans and current-file GUI actions consistent.
 */

import * as crypto from "node:crypto";

/**
 * Computes a SHA-256 hash for source content.
 */
export function createContentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
