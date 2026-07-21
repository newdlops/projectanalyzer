/**
 * Language-neutral object-field target formatting. Language adapters keep raw
 * source evidence, while this module gives nested keys one stable graph label.
 */

/** Appends a decoded property key with dot notation when that remains readable. */
export function appendObjectFieldTarget(
  owner: string,
  key: string | number
): string {
  if (typeof key === "string" && /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(key)) {
    return `${owner}.${key}`;
  }
  return `${owner}[${JSON.stringify(key)}]`;
}

/** Appends a parser-proven string/number literal without evaluating source. */
export function appendObjectFieldLiteralTarget(
  owner: string,
  literal: string
): string {
  return `${owner}[${literal.trim()}]`;
}

/** Rejects destructuring/call results that cannot own a stable field path. */
export function isStableObjectFieldOwner(target: string): boolean {
  return /^[\p{L}_$][\p{L}\p{N}_$]*(?:(?:\.[\p{L}_$][\p{L}\p{N}_$]*)|(?:\[[^\]\r\n]+\]))*$/u
    .test(target.trim());
}

/** Accepts only source literals whose identity is visible without execution. */
export function isStaticObjectFieldKeyLiteral(value: string): boolean {
  const literal = value.trim();
  return /^(?:[+-]?(?:\d+(?:\.\d+)?|\.\d+)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/u
    .test(literal);
}
