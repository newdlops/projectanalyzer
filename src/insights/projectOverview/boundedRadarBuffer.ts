/**
 * Fixed-size accumulation helpers for Project Risk Radar internals.
 * These helpers keep deterministic minima and top-K values without retaining
 * input-sized arrays; the module is intentionally absent from the public API.
 */

import type { SourceRange } from "../../shared/types";
import { PROJECT_RISK_EVIDENCE_IDENTITY_LIMIT, type ProjectRiskLocation } from "./types";

/** Finds one deterministic minimum without copying or sorting the iterable. */
export function getBestValue<T>(
  values: Iterable<T>,
  compare: (left: T, right: T) => number
): T | undefined {
  let best: T | undefined;

  for (const value of values) {
    if (best === undefined || compare(value, best) < 0) {
      best = value;
    }
  }

  return best;
}

/** Inserts one value into a deterministic sorted fixed-size top-K buffer. */
export function retainTopValue<T>(
  values: T[],
  candidate: T,
  limit: number,
  compare: (left: T, right: T) => number
): void {
  if (limit === 0) {
    return;
  }

  values.push(candidate);
  values.sort(compare);

  if (values.length > limit) {
    values.pop();
  }
}

/** Keeps the lexicographically smallest unique identities under the public cap. */
export function retainSmallestString(values: string[], value: string): void {
  if (values.includes(value)) {
    return;
  }

  values.push(value);
  values.sort(compareText);

  if (values.length > PROJECT_RISK_EVIDENCE_IDENTITY_LIMIT) {
    values.pop();
  }
}

/** Keeps the numerically smallest unique diagnostic indexes under the cap. */
export function retainSmallestNumber(values: number[], value: number): void {
  if (values.includes(value)) {
    return;
  }

  values.push(value);
  values.sort((left, right) => left - right);

  if (values.length > PROJECT_RISK_EVIDENCE_IDENTITY_LIMIT) {
    values.pop();
  }
}

/** Keeps the deterministic first source location without retaining a list. */
export function retainFirstLocation(
  current: ProjectRiskLocation | undefined,
  candidate: ProjectRiskLocation
): ProjectRiskLocation {
  return !current || compareLocations(candidate, current) < 0 ? candidate : current;
}

/** Orders call-site and diagnostic locations without locale dependence. */
function compareLocations(left: ProjectRiskLocation, right: ProjectRiskLocation): number {
  return compareText(left.filePath, right.filePath)
    || compareOptionalRanges(left.range, right.range);
}

/** Orders optional ranges with present evidence first. */
function compareOptionalRanges(
  left: SourceRange | undefined,
  right: SourceRange | undefined
): number {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  return left.startLine - right.startLine
    || left.startCharacter - right.startCharacter
    || left.endLine - right.endLine
    || left.endCharacter - right.endCharacter;
}

/** Locale-independent comparison used for bounded identity ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
