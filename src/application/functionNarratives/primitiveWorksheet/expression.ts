/** Bounded primitive substitution over a closed token grammar; calls, access, coercion and source execution are excluded. */
export type Primitive = number | boolean | string | null;
export type NumericKind = "Int" | "Double";
export type Reading = { value: Primitive; substituted: string; operations: string[];
  numericKind?: NumericKind; divisionKinds?: NumericKind[] };
const precedence: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "===": 3, "!==": 3,
  "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6, "u-": 7, "u+": 7, "!": 7 };

/** Shunting-yard stacks keep parsing and evaluation iterative, with explicit expression/token/value bounds. */
export function readPrimitiveExpression(expression: string, state: ReadonlyMap<string, Primitive>, integer: boolean,
  numericTypes?: ReadonlyMap<string, NumericKind>): Reading | undefined {
  if (!expression.trim() || expression.length > 160) return undefined;
  const tokens: string[] = [], substituted: string[] = [];
  let rest = expression.trim();
  while (rest) {
    if (tokens.length >= 64) return undefined;
    const token = /^(?:"(?:[^"\\\r\n]|\\.)*"|\d+(?:\.\d+)?|[\p{L}_$][\p{L}\p{N}_$]*|===|!==|==|!=|<=|>=|&&|\|\||[()+*!<>/%-])/u.exec(rest)?.[0];
    if (!token) return undefined;
    if (integer && ["===", "!=="].includes(token)) return undefined; // Kotlin boxing/reference identity is not primitive equality.
    tokens.push(token); rest = rest.slice(token.length).trimStart();
  }
  const values: Primitive[] = [], operators: string[] = [], operations = new Set<string>();
  // Numeric type is carried per operand, not inferred from its current value:
  // Double(10) / Int(2) and Int(10) / Int(2) have different division semantics.
  const kinds: Array<NumericKind | undefined> = [], divisionKinds = new Set<NumericKind>();
  let operand = true;
  const apply = (): boolean => {
    const op = operators.pop();
    if (!op || op === "(" || !values.length) return false;
    const right = values.pop()!;
    const rightKind = kinds.pop(); let resultKind: NumericKind | undefined;
    let operation = op;
    if (["!", "u-", "u+"].includes(op)) {
      if (op === "!" && typeof right === "boolean") values.push(!right);
      else if (typeof right === "number" && op !== "!") { values.push(op === "u-" ? -right : right); resultKind = rightKind; }
      else return false;
    } else {
      if (!values.length) return false;
      const left = values.pop()!;
      const leftKind = kinds.pop();
      if (["==", "!=", "===", "!=="].includes(op)) {
        // Loose JS coercion and nullable/type-incompatible arithmetic stay model-owned.
        if (["==", "!="].includes(op) && left !== null && right !== null && typeof left !== typeof right) return false;
        if (integer && numericTypes && leftKind && rightKind && leftKind !== rightKind) return false;
        values.push(["==", "==="].includes(op) ? left === right : left !== right);
      } else if (["&&", "||"].includes(op) && typeof left === "boolean" && typeof right === "boolean") {
        values.push(op === "&&" ? left && right : left || right);
      } else if (typeof left === "number" && typeof right === "number") {
        const kind: NumericKind = integer && leftKind === "Int" && rightKind === "Int" ? "Int" : "Double";
        if (["/", "%"].includes(op) && right === 0) return false; // No fabricated result for an exception/non-finite value.
        const result = op === "+" ? left + right : op === "-" ? left - right : op === "*" ? left * right
          : op === "/" ? kind === "Int" ? Math.trunc(left / right) : left / right : op === "%" ? left % right
          : op === "<" ? left < right : op === "<=" ? left <= right : op === ">" ? left > right : op === ">=" ? left >= right : undefined;
        if (result === undefined) return false;
        values.push(result); if (typeof result === "number") resultKind = kind;
        if (op === "/") divisionKinds.add(kind);
      } else if (op === "+" && typeof left === "string" && typeof right === "string") { values.push(left + right); operation = "s+"; }
      else return false;
    }
    operations.add(operation);
    if (resultKind === "Int" && Object.is(values.at(-1), -0)) values[values.length - 1] = 0;
    kinds.push(resultKind);
    return bounded(values.at(-1)!, integer && resultKind === "Int");
  };
  for (const token of tokens) {
    if (token === "(") { if (!operand) return undefined; operators.push(token); substituted.push(token); continue; }
    if (token === ")") {
      if (operand) return undefined;
      while (operators.length && operators.at(-1) !== "(") if (!apply()) return undefined;
      if (operators.pop() !== "(") return undefined;
      substituted.push(token); operand = false; continue;
    }
    if (Object.hasOwn(precedence, token)) {
      const op = operand && ["-", "+"].includes(token) ? "u" + token : token;
      const unary = ["u-", "u+", "!"].includes(op);
      if (operand !== unary) return undefined;
      while (operators.length && operators.at(-1) !== "(" && (unary
        ? precedence[operators.at(-1)!] > precedence[op] : precedence[operators.at(-1)!] >= precedence[op])) if (!apply()) return undefined;
      operators.push(op); substituted.push(token); operand = true; continue;
    }
    if (!operand) return undefined;
    let value: Primitive | undefined;
    let kind: NumericKind | undefined;
    // Kotlin decimals introduce floating semantics, and a source string with a
    // dollar identifier is interpolation rather than a closed JSON literal.
    if (integer && (!numericTypes && /^\d+\.\d+$/u.test(token)
      || token.startsWith('"') && /\$(?:\{|[\p{L}_])/u.test(token))) return undefined;
    if (["true", "false", "null"].includes(token) || /^\d|^"/u.test(token)) {
      try { value = JSON.parse(token); } catch { return undefined; }
      if (typeof value === "number") kind = integer && !token.includes(".") ? "Int" : "Double";
    } else if (state.has(token)) { value = state.get(token); kind = integer ? numericTypes?.get(token) ?? (!numericTypes ? "Int" : undefined) : "Double"; }
    if (value === undefined || typeof value === "number" && !kind || !bounded(value, integer && kind === "Int")) return undefined;
    values.push(value); kinds.push(kind); substituted.push(JSON.stringify(value)); operand = false;
  }
  if (operand) return undefined;
  while (operators.length) if (!apply()) return undefined;
  return values.length === 1 ? { value: values[0], substituted: substituted.join(" "),
    operations: [...operations], ...(typeof values[0] === "number" ? { numericKind: kinds[0] } : {}),
    ...(divisionKinds.size ? { divisionKinds: [...divisionKinds] } : {}) } : undefined;
}

/** Kotlin Int overflow/Float rounding, huge JS values and long strings deliberately fall back. */
function bounded(value: Primitive, integer: boolean): boolean {
  return typeof value === "number" ? Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
    && (integer || !Object.is(value, -0)) // JSON serialization would silently erase JS negative zero.
    && (!integer || Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)
    : value === null || typeof value === "boolean" || typeof value === "string" && value.length <= 40;
}
