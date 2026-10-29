/** Read exact primitive data from a single owned write without evaluating source.
 * Full declarations/direct assignments and already-lowered literal operands are
 * recognized; calls, accesses, chains, unsupported aliases/suffixes stay unknown.
 */

/** One source-owned primitive literal, with its existing portable JSON encoding. */
export interface SourcePrimitiveWrite {
  value: number | boolean | null;
  json: string;
}

const identifier = "[\\p{L}_$][\\p{L}\\p{N}_$]*";
const assignment = new RegExp(`^(?:(?:val|var|let|const)\\s+)?(${identifier})(?:\\s*:\\s*([^=]+?))?\\s*=\\s*(.+?)\\s*;?$`, "u");
const jsonPrimitive = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/u;

/** Match only explicit primitive annotations; aliases never acquire a JSON kind. */
function supportedAnnotation(language: string, annotation: string): boolean {
  const value = annotation.replace(/\s/gu, "");
  if (language === "kotlin") return /^(?:kotlin\.)?(?:Int|Long|Short|Byte|Double|Float|Boolean)\??$/u.test(value);
  if (language === "typescript" || language === "javascript") return /^(?:number|boolean)(?:\|null)?$/u.test(value);
  return false;
}

/** Extract only an exact owned literal; zero/false/null remain distinguishable.
 * The owner name must match the whole left side. This never resolves properties,
 * invokes code, infers an alias, or changes any explanation/response string.
 */
export function readSourcePrimitiveWrite(language: string, code: string, targetName: string): SourcePrimitiveWrite | undefined {
  let expression = code.trim();
  if (!jsonPrimitive.test(expression)) {
    if (!["kotlin", "typescript", "javascript"].includes(language)) return undefined;
    const match = assignment.exec(expression);
    if (!match || match[1] !== targetName || match[2] && !supportedAnnotation(language, match[2])) return undefined;
    expression = match[3].replace(/;$/u, "").trim();
    if (!jsonPrimitive.test(expression)) return undefined;
  }
  const value: number | boolean | null = JSON.parse(expression);
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  return { value, json: JSON.stringify(value) };
}
