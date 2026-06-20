/**
 * Time utilities used by graph generation and cache metadata. Keeping them in a
 * small module makes tests deterministic when a clock is injected later.
 */

/**
 * Returns an ISO timestamp for persisted graph metadata.
 */
export function nowIso(): string {
  return new Date().toISOString();
}
