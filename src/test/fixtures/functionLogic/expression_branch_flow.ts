/**
 * TypeScript Function Logic fixture for expression-level ternary, boolean,
 * nullish, concise-arrow, and loop short-circuit evaluation paths.
 */

declare function loadPrimary(): string;
declare function loadSecondary(): string;
declare function loadCached(): string;
declare function loadFallback(): string;
declare function accept(value: string): string;
declare function reject(): string;
declare function isOwner(user: string): boolean;
declare function canRead(user: string): boolean;
declare function loadWorkspace(): string;
declare function denyAccess(): string;
declare function isReady(value: string): boolean;
declare function canRetry(value: string): boolean;
declare function shouldSkip(value: string): boolean;
declare function next(value: string): string;
declare function consume(value: string): void;

export function chooseDelivery(ready: boolean, cached?: string): string {
  const selected = ready ? loadPrimary() : cached ?? loadFallback();
  return selected && selected.length > 2 ? accept(selected) : reject();
}

export function chooseNestedDelivery(
  primary: boolean,
  secondary: boolean,
  cached: boolean
): string {
  return primary
    ? secondary
      ? loadPrimary()
      : loadSecondary()
    : cached
      ? loadCached()
      : loadFallback();
}

export function authorizeWorkspace(
  session: boolean,
  user: string,
  blocked: boolean
): string {
  if (session && (isOwner(user) || canRead(user)) && !blocked) {
    return loadWorkspace();
  }
  return denyAccess();
}

export function drainQueue(current: string): string {
  while (current && (isReady(current) || canRetry(current))) {
    current = next(current);
    if (shouldSkip(current)) {
      continue;
    }
    consume(current);
  }
  return current;
}

export const conciseDecision = (ready: boolean): string =>
  ready ? loadPrimary() : loadFallback();

export function chooseMutable(flag: boolean): number {
  let selected = 0;
  let left = 0;
  let right = 0;
  selected = flag ? (left = 1) : (right = 2);
  return selected + left + right;
}
