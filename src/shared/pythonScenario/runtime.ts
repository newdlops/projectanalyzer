/** Bounded Python bytecode machine. An explicit call stack evaluates only our data instructions, never source code. */
import type { PythonInstruction, PythonObservation, PythonScenarioProgram, PythonScenarioResult, PythonValue } from "./types";
import type { createPythonRegexRuntime } from "./regex";

/** The factory is closure-free so the same reviewed implementation can be embedded under webview CSP. */
export function createPythonScenarioRuntime(regex: ReturnType<typeof createPythonRegexRuntime>) {
  type RuntimeValue = PythonValue | { tag: "regex"; pattern: string } | { tag: "match"; text: string; groups: string[] } | { tag: "tuple"; items: RuntimeValue[] } | RuntimeValue[];
  type Cell = { value: RuntimeValue; comparison?: Omit<PythonObservation, "blockId" | "outcome"> };
  type Frame = { id: string; instructions: PythonInstruction[]; ip: number; stack: Cell[]; locals: Map<string, Cell>; scopes: Map<string, Cell>[]; iterators: Map<string, { values: RuntimeValue[]; index: number }>; blockId?: string };
  const fail = (reason = "unsupported-expression"): never => { throw new Error(reason); };
  const truth = (value: RuntimeValue): boolean => Array.isArray(value) || typeof value === "string" ? value.length > 0 : value && typeof value === "object" && value.tag === "tuple" ? value.items.length > 0 : Boolean(value);
  const sequence = (value: RuntimeValue): RuntimeValue[] => Array.isArray(value) ? value : typeof value === "string" ? [...value] : value && typeof value === "object" && value.tag === "tuple" ? value.items : fail();
  const number = (value: RuntimeValue): number => typeof value === "number" ? value : typeof value === "boolean" ? Number(value) : fail();
  /** Iterative conversion rejects host-like objects, cycles and values outside the display/data budget. */
  function snapshot(value: RuntimeValue): PythonValue {
    const box: { value: PythonValue } = { value: null };
    const queue: Array<{ value: RuntimeValue; set(value: PythonValue): void; depth: number }> = [{ value, set: (item) => { box.value = item; }, depth: 0 }];
    const seen = new Set<object>();
    for (let i = 0; i < queue.length; i += 1) {
      if (i > 512) fail("step-budget");
      const item = queue[i];
      if (item.depth > 12) fail("step-budget");
      if (item.value && !Array.isArray(item.value) && typeof item.value === "object" && item.value.tag === "tuple") {
        if (seen.has(item.value)) fail("step-budget"); seen.add(item.value);
        queue.push({ ...item, value: item.value.items, depth: item.depth + 1 }); continue;
      }
      if (Array.isArray(item.value)) {
        if (seen.has(item.value) || item.value.length > 64) fail("loop-budget"); seen.add(item.value);
        const values: PythonValue[] = []; item.set(values);
        queue.push(...item.value.map((child, index) => ({ value: child, set: (next: PythonValue) => { values[index] = next; }, depth: item.depth + 1 })));
      } else if (item.value === null || typeof item.value === "boolean") item.set(item.value);
      else if (typeof item.value === "number" && Number.isFinite(item.value) && Math.abs(item.value) <= Number.MAX_SAFE_INTEGER) item.set(item.value);
      else if (typeof item.value === "string" && item.value.length <= 512) item.set(item.value);
      else fail();
    }
    return box.value;
  }
  function equal(left: RuntimeValue, right: RuntimeValue): boolean {
    const queue = [[left, right]]; const seen = new Set<RuntimeValue>();
    for (let index = 0; index < queue.length; index += 1) {
      if (index > 512) fail("step-budget");
      const [a, b] = queue[index];
      if (a === b || (typeof a === "boolean" || typeof a === "number") && (typeof b === "boolean" || typeof b === "number") && Number(a) === Number(b)) continue;
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || seen.has(a)) return false;
      seen.add(a); queue.push(...a.map((value, i) => [value, b[i]]));
    }
    return true;
  }
  function binary(operator: string, left: RuntimeValue, right: RuntimeValue): Cell {
    if (["==", "!=", "<", "<=", ">", ">=", "in", "not in", "is", "is not"].includes(operator)) {
      let value: boolean;
      if (operator === "==" || operator === "!=") value = equal(left, right) === (operator === "==");
      else if (operator === "is" || operator === "is not") { if (left !== null && right !== null) fail(); value = (left === right) === (operator === "is"); }
      else if (operator === "in" || operator === "not in") {
        const present = typeof right === "string" && typeof left === "string" ? right.includes(left) : Array.isArray(right) ? right.some((item) => equal(item, left)) : fail();
        value = present === (operator === "in");
      } else {
        const a = typeof left === "string" && typeof right === "string" ? left : number(left);
        const b = typeof left === "string" && typeof right === "string" ? right : number(right);
        value = operator === "<" ? a < b : operator === "<=" ? a <= b : operator === ">" ? a > b : a >= b;
      }
      let comparison: Cell["comparison"] = typeof left === "number" && typeof right === "number" ? { operator, left, right }
        : { operator, left: value ? 1 : 0, right: 0.5 };
      if (typeof left === "string" && typeof right === "string" && ["==", "!="].includes(operator)) {
        // Preserve a learnable distance even when almost every sampled string
        // misses the target. Actual operands remain separate display evidence.
        let distance = Math.abs(left.length - right.length);
        for (let i = 0; i < Math.min(left.length, right.length); i += 1) if (left[i] !== right[i]) distance += 1;
        comparison = { operator, left: distance, right: 0, metric: "string-distance", leftValue: left, rightValue: right };
      }
      return { value, comparison };
    }
    if (operator === "+" && typeof left === "string" && typeof right === "string") return { value: snapshot(left + right) };
    if (operator === "+" && Array.isArray(left) && Array.isArray(right)) return { value: snapshot([...left, ...right]) };
    const a = number(left); const b = number(right);
    if (["/", "//", "%"].includes(operator) && b === 0) fail();
    const value = operator === "+" ? a + b : operator === "-" ? a - b : operator === "*" ? a * b : operator === "/" ? a / b
      : operator === "//" ? Math.floor(a / b) : operator === "%" ? a - Math.floor(a / b) * b : fail();
    return { value: snapshot(value) };
  }
  /** Explicitly enumerated intrinsic semantics; arbitrary properties and calls are inaccessible. */
  function intrinsic(name: string, args: RuntimeValue[]): RuntimeValue {
    const first = args[0];
    if (name === "@regex" && args.length === 1 && typeof first === "string" && regex.parse(first)) return { tag: "regex", pattern: first };
    if (name === "len" && args.length === 1) return sequence(first).length;
    if (name === "bool" && args.length === 1) return truth(first);
    if (name === "int" && args.length === 1) {
      if (typeof first === "number" || typeof first === "boolean") return Math.trunc(number(first));
      if (typeof first === "string" && /^[+-]?[0-9]+$/u.test(first.trim())) return snapshot(Number(first.trim()));
      return fail();
    }
    if (name === "str" && args.length === 1 && !Array.isArray(first) && (first === null || typeof first !== "object")) return first === null ? "None" : first === true ? "True" : first === false ? "False" : String(first);
    if ((name === "list" || name === "tuple") && args.length <= 1) { const items = args.length ? sequence(first).slice() : []; return name === "tuple" ? { tag: "tuple", items } : items; }
    if (name === "abs" && args.length === 1) return Math.abs(number(first));
    if (name === "sum" && args.length === 1) return snapshot(sequence(first).reduce<number>((total, value) => total + number(value), 0));
    if ((name === "min" || name === "max") && args.length > 0) {
      const values = (args.length === 1 ? sequence(first) : args).map(number); if (!values.length) fail();
      return name === "min" ? Math.min(...values) : Math.max(...values);
    }
    if (name === "zip" && args.length >= 1 && args.length <= 4) {
      const lists = args.map(sequence); return Array.from({ length: Math.min(...lists.map((list) => list.length)) }, (_, index) => lists.map((list) => list[index]));
    }
    if (name === "range" && args.length >= 1 && args.length <= 3) {
      const start = args.length === 1 ? 0 : number(first); const end = number(args.length === 1 ? first : args[1]); const step = args.length === 3 ? number(args[2]) : 1;
      if (![start, end, step].every(Number.isInteger) || !step) fail(); const length = Math.max(0, Math.ceil((end - start) / step));
      if (length > 32) fail("loop-budget"); return Array.from({ length }, (_, index) => start + index * step);
    }
    return fail("external-state");
  }
  function method(name: string, receiver: RuntimeValue, args: RuntimeValue[]): RuntimeValue {
    if (receiver && !Array.isArray(receiver) && typeof receiver === "object") {
      if (receiver.tag === "regex" && ["finditer", "search"].includes(name) && args.length === 1 && typeof args[0] === "string") {
        const matches = regex.matches(receiver.pattern, args[0]).map((match) => ({ tag: "match" as const, ...match })); return name === "finditer" ? matches : matches[0] ?? null;
      }
      if (receiver.tag === "match" && name === "groups" && !args.length) return receiver.groups.slice();
      if (receiver.tag === "match" && name === "group" && args.length <= 1) {
        const index = args.length ? number(args[0]) : 0; return (index === 0 ? receiver.text : receiver.groups[index - 1]) ?? fail();
      }
    }
    if (Array.isArray(receiver) && name === "append" && args.length === 1) { if (receiver.length >= 64) fail("loop-budget"); (receiver as RuntimeValue[]).push(args[0]); return null; }
    if (typeof receiver !== "string") return fail();
    if (name === "splitlines" && !args.length) { if (!receiver) return []; const parts = receiver.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u); if (/[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]$/u.test(receiver)) parts.pop(); return parts; }
    if (name === "split" && args.length === 1 && typeof args[0] === "string" && args[0]) return receiver.split(args[0]);
    if (name === "join" && args.length === 1) { const parts = sequence(args[0]); if (!parts.every((part) => typeof part === "string")) fail(); return snapshot(parts.join(receiver)); }
    // Unicode digit conversion/case differences are deliberately unsupported instead of inheriting JS semantics.
    if (name === "isdigit" && !args.length) { if (/[^\x00-\x7f]/u.test(receiver)) fail(); return /^[0-9]+$/u.test(receiver); }
    if ((name === "lower" || name === "upper") && !args.length && /^[\x00-\x7f]*$/u.test(receiver)) return name === "lower" ? receiver.toLowerCase() : receiver.toUpperCase();
    if (name === "strip" && !args.length && /^[\x00-\x7f]*$/u.test(receiver)) return receiver.replace(/^[\t-\r\x1c-\x20]+|[\t-\r\x1c-\x20]+$/gu, "");
    if ((name === "startswith" || name === "endswith") && args.length === 1 && typeof args[0] === "string") return name === "startswith" ? receiver.startsWith(args[0]) : receiver.endsWith(args[0]);
    return fail();
  }
  /** Runs with bounded work, loop visits and acyclic local calls. Only root writes become UI transitions. */
  function evaluate(program: PythonScenarioProgram, inputs: Map<string, PythonValue>, options: { maxSteps?: number; maxLoopVisits?: number } = {}): PythonScenarioResult {
    const result: PythonScenarioResult = { status: "partial", blockIds: [program.entryBlockId], edgeIds: [], decisions: [], observations: [], transitions: [] };
    const functions = new Map(program.functions.map((fn) => [fn.id, fn])); const globals = new Map<string, Cell>();
    const bindings = new Map(program.bindings.map((binding) => [binding.name, binding]));
    const maxSteps = Math.max(1, Math.min(8192, options.maxSteps ?? 8192)); const maxLoops = Math.max(1, Math.min(32, options.maxLoopVisits ?? 32));
    const makeFrame = (id: string, instructions: PythonInstruction[], locals = new Map<string, Cell>()): Frame => ({ id, instructions, ip: 0, stack: [], locals, scopes: [], iterators: new Map() });
    const init = program.globals.flatMap((global) => [...global.instructions, { op: "store" as const, name: global.name }]);
    const frames = [makeFrame("@globals", init, globals)]; let started = false; const visits = new Map<string, number>();
    const visit = (blockId: string | undefined) => {
      if (!blockId || result.blockIds.at(-1) === blockId) return;
      const last = result.blockIds.at(-1)!;
      const edge = program.edges.find((item) => item.sourceBlockId === last && item.targetBlockId === blockId);
      if (edge && result.edgeIds.at(-1) !== edge.edgeId) result.edgeIds.push(edge.edgeId);
      result.blockIds.push(blockId);
    };
    const decision = (frame: Frame, instruction: PythonInstruction, cell: Cell) => {
      if (frame.id !== program.root || !instruction.blockId) return;
      const blockId = instruction.blockId; visit(blockId); const outcome = truth(cell.value);
      const observation = { blockId, ...(cell.comparison ?? { operator: "truthy", left: outcome ? 1 : 0, right: 0.5 }), outcome };
      result.observations.push(observation);
      const edge = program.edges.find((item) => item.sourceBlockId === blockId && (item.kind === String(outcome) || outcome && item.kind === "iterate" || !outcome && ["loop-exit", "exit"].includes(item.kind)));
      if (edge) { result.decisions.push({ blockId, edgeId: edge.edgeId, outcome: String(outcome) }); result.edgeIds.push(edge.edgeId); }
    };
    const write = (frame: Frame, name: string, value: Cell, blockId?: string) => {
      const binding = bindings.get(name); const before = frame.locals.get(name); frame.locals.set(name, value);
      if (frame.id === program.root && binding && blockId && !(value.value && typeof value.value === "object" && !Array.isArray(value.value))) {
        result.transitions.push({ blockId, occurrence: result.blockIds.length - 1, bindingId: binding.bindingId, before: before ? snapshot(before.value) : undefined, after: snapshot(value.value) });
      }
    };
    try {
      if (program.version !== 1 || program.functions.length > 8 || program.globals.length > 24) fail();
      for (let step = 0; step < maxSteps; step += 1) {
        if (!frames.length || frames.length === 1 && frames[0].id === "@globals" && frames[0].ip === frames[0].instructions.length) {
          if (started) break; started = true; frames.length = 0;
          const root = functions.get(program.root) ?? fail(); const locals = new Map<string, Cell>();
          for (const name of root.parameters) { if (!inputs.has(name)) fail("unknown-input"); locals.set(name, { value: snapshot(inputs.get(name)!) }); }
          frames.push(makeFrame(root.id, root.instructions, locals));
        }
        const frame = frames.at(-1)!; const instruction = frame.instructions[frame.ip++]; if (!instruction) fail("control-gap");
        const pop = () => frame.stack.pop() ?? fail(); const push = (value: RuntimeValue) => frame.stack.push({ value });
        if (frame.stack.length > 256) fail("step-budget");
        const name = instruction.name ?? "";
        if (instruction.op === "literal") push(snapshot(instruction.value ?? null));
        else if (instruction.op === "load") frame.stack.push(frame.locals.get(name) ?? globals.get(name) ?? fail("unknown-input"));
        else if (instruction.op === "store") write(frame, name, pop(), instruction.blockId);
        else if (instruction.op === "list") { const items = frame.stack.splice(-instruction.count!, instruction.count!).map((cell) => cell.value); push(name === "tuple" ? { tag: "tuple", items } : items); }
        else if (instruction.op === "unpack") { const values = sequence(pop().value); if (values.length !== instruction.count) fail(); for (const value of values.slice().reverse()) push(value); }
        else if (instruction.op === "pop") pop();
        else if (instruction.op === "dup") { const cell = pop(); frame.stack.push(cell, cell); }
        else if (instruction.op === "binary") {
          const right = pop(); const left = pop();
          if (name === "and" || name === "or") {
            // Both operands ran only when short circuit required the right side.
            // Keep the decisive comparison's calculated operands, including pure helper returns.
            const decisive = name === "or" && !truth(right.value) || name === "and" && truth(right.value) ? left : right;
            frame.stack.push({ value: right.value, comparison: decisive.comparison });
          } else frame.stack.push(binary(name, left.value, right.value));
        }
        else if (instruction.op === "unary") { const cell = pop(); if (name === "not") frame.stack.push({ value: !truth(cell.value), comparison: cell.comparison ? { ...cell.comparison, operator: "not " + cell.comparison.operator } : undefined }); else push(name === "-" ? -number(cell.value) : name === "+" ? number(cell.value) : fail()); }
        else if (instruction.op === "index") { const index = number(pop().value); const values = sequence(pop().value); const key = index < 0 ? values.length + index : index; if (!Number.isInteger(index) || key < 0 || key >= values.length) fail(); push(values[key]); }
        else if (instruction.op === "slice") { const end = pop().value; const start = pop().value; const receiver = pop().value; const values = sequence(receiver); if (start !== null && !Number.isInteger(start) || end !== null && !Number.isInteger(end)) fail(); const sliced = values.slice(start === null ? 0 : number(start), end === null ? undefined : number(end)); push(typeof receiver === "string" ? sliced.join("") : sliced); }
        else if (instruction.op === "scope") { if (instruction.keep) { if (frame.scopes.length > 12) fail("step-budget"); frame.scopes.push(frame.locals); frame.locals = new Map(frame.locals); } else frame.locals = frame.scopes.pop() ?? fail(); }
        else if (instruction.op === "iterate") { const values = sequence(pop().value); if (values.length > maxLoops) fail("loop-budget"); frame.iterators.set(name, { values, index: 0 }); }
        else if (instruction.op === "next") {
          const iterator = frame.iterators.get(name) ?? fail(); const more = iterator.index < iterator.values.length;
          decision(frame, instruction, { value: more, comparison: { operator: "lt", left: iterator.index, right: iterator.values.length } });
          if (more) push(iterator.values[iterator.index++]); else frame.ip = instruction.target!;
        } else if (instruction.op === "branch") {
          const cell = instruction.keep ? frame.stack.at(-1) ?? fail() : pop(); decision(frame, instruction, cell);
          if (truth(cell.value) === instruction.when) frame.ip = instruction.target!;
        } else if (instruction.op === "jump") {
          const key = `${frames.length}:${frame.id}:${frame.ip}`; const count = (visits.get(key) ?? 0) + 1; visits.set(key, count);
          if (count > maxLoops * maxLoops) fail("loop-budget"); frame.ip = instruction.target!;
        } else if (instruction.op === "trace") { frame.blockId = instruction.blockId; if (frame.id === program.root) visit(instruction.blockId); }
        else if (instruction.op === "call" || instruction.op === "method") {
          const args = frame.stack.splice(frame.stack.length - instruction.count!, instruction.count!).map((cell) => cell.value);
          if (args.length !== instruction.count) fail();
          const fn = instruction.op === "call" ? functions.get(name) : undefined;
          if (fn) {
            if (fn.parameters.length !== args.length || frames.length >= 8 || frames.some((item) => item.id === fn.id)) fail("control-gap");
            frames.push(makeFrame(fn.id, fn.instructions, new Map(fn.parameters.map((parameter, index) => [parameter, { value: args[index] }]))));
          } else if (instruction.op === "call") push(intrinsic(name, args));
          else {
            const receiver = pop().value; const aliases = name === "append" && frame.id === program.root ? [...frame.locals].filter(([alias, cell]) => cell.value === receiver && bindings.has(alias)) : [];
            const before = aliases.length ? snapshot(receiver) : undefined;
            push(method(name, receiver, args));
            if (instruction.blockId) for (const [alias] of aliases) result.transitions.push({ blockId: instruction.blockId, occurrence: result.blockIds.length - 1, bindingId: bindings.get(alias)!.bindingId, before, after: snapshot(receiver) });
          }
        } else if (instruction.op === "return") {
          const value = pop(); frames.pop();
          if (frame.id === program.root) { const blockId = instruction.blockId ?? frame.blockId ?? program.entryBlockId; visit(blockId); result.terminal = { blockId, kind: "return", value: snapshot(value.value) }; result.status = "verified"; return result; }
          frames.at(-1)?.stack.push(value);
        } else fail();
      }
      result.reason = "step-budget";
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unsupported-expression";
      result.reason = (["unknown-input", "unsupported-expression", "external-state", "control-gap", "loop-budget", "step-budget"].includes(reason) ? reason : "unsupported-expression") as PythonScenarioResult["reason"];
    }
    return result;
  }
  return { evaluate, snapshot };
}
