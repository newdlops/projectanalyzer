/** Process-local retention of owner-requested cleanup across cache and gate lifecycles. */
type PendingCleanup = { cleanup: () => Promise<void>; attempt?: Promise<void> };
// Scope is the exact lease/gate path; the opaque token identifies one actual owner.
// Active owners never enter this registry, and no model buffers are retained.
const pendingScopes = new Map<string, Map<string, PendingCleanup>>();

export function hasPendingCleanup(scope: string, token: string): boolean {
  return pendingScopes.get(scope)?.has(token) === true;
}

/** Retain the original callback until actual success; concurrent callers share its attempt. */
export function retainCleanup(scope: string, token: string, cleanup: () => Promise<void>): Promise<void> {
  let entries = pendingScopes.get(scope);
  if (!entries) { entries = new Map(); pendingScopes.set(scope, entries); }
  if (!entries.has(token)) entries.set(token, { cleanup });
  return retryCleanup(scope, token);
}

/** Retry only a cleanup its actual owner already requested, preserving failed ownership. */
export async function retryCleanup(scope: string, token: string): Promise<void> {
  const entries = pendingScopes.get(scope), pending = entries?.get(token);
  if (!entries || !pending) return;
  if (pending.attempt) return pending.attempt;
  const attempt = Promise.resolve().then(pending.cleanup).then(() => {
    if (entries.get(token) === pending) entries.delete(token);
    if (!entries.size && pendingScopes.get(scope) === entries) pendingScopes.delete(scope);
  });
  pending.attempt = attempt;
  try { await attempt; }
  finally { if (pending.attempt === attempt) pending.attempt = undefined; }
}

/** Gate cleanup uses only unique owner paths, so it can be retried before a new contender joins. */
export async function retryPendingCleanups(scope: string): Promise<void> {
  for (const token of [...(pendingScopes.get(scope)?.keys() ?? [])]) await retryCleanup(scope, token);
}
