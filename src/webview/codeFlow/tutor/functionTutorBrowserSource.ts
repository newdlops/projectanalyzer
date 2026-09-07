import { getFunctionTutorGuideBrowserSource } from "./functionTutorGuideBrowserSource";

/**
 * CSP-safe Function Guide browser support. Its lazy scenario interpreter
 * evaluates only host-projected expression IR, never source text, calls,
 * eval strings, or network data.
 */

/** Returns the bounded scenario interpreter and Function Guide renderer. */
export function getFunctionTutorBrowserSource(): string {
  return /* js */ `
    const FUNCTION_TUTOR_MAX_PATHS = 8;
    const FUNCTION_TUTOR_MAX_STEPS = 240;
    const FUNCTION_TUTOR_MAX_LOOPS = 3;

    function createFunctionTutorUnknown(reason) { return { kind: "unknown", reason: reason || "not-inferred" }; }
    function cloneFunctionTutorValue(value) {
      if (!value || typeof value !== "object") return value;
      if (value.kind === "array") return { kind: "array", items: value.items.map(cloneFunctionTutorValue), truncated: value.truncated };
      if (value.kind === "object") return { kind: "object", entries: value.entries.map((entry) => ({ key: entry.key, value: cloneFunctionTutorValue(entry.value) })), truncated: value.truncated };
      return { ...value };
    }
    function isFunctionTutorKnown(value) { return value && value.kind !== "unknown"; }
    /** Formats protocol and evaluator values without invoking object coercion. */
    function functionTutorValueText(value) { try { return functionTutorSafeValueText(value); } catch (_error) { return projectAnalyzerText("unknown"); } }
    function functionTutorSafeValueText(value) {
      const unknown = () => projectAnalyzerText("unknown"); const forbidden = new Set(["__proto__", "prototype", "constructor", "__functionTutorBrand", "__functionTutorIterator"]);
      const pending = [{ value, depth: 0, prefix: "" }]; const seen = new Set(); let output = ""; let work = 0;
      while (pending.length && work++ < 96 && output.length < 480) {
        const item = pending.pop(); let current = item.value;
        if (current && typeof current === "object" && current.kind === "known") current = current.value;
        if (current === null) { output += item.prefix + "null"; continue; }
        if (current === undefined) { output += item.prefix + "undefined"; continue; }
        if (typeof current === "boolean" || typeof current === "number" || typeof current === "string") { output += item.prefix + current; continue; }
        if (!current || typeof current !== "object" || item.depth > 4 || seen.has(current)) return unknown();
        seen.add(current);
        if (current.kind === "unknown" || current.kind === "unset") return unknown();
        if (current.kind === "null" || current.kind === "undefined") { output += item.prefix + current.kind; continue; }
        if (current.kind === "boolean" || current.kind === "number" || current.kind === "string") { output += item.prefix + (typeof current.value === "string" || typeof current.value === "number" || typeof current.value === "boolean" ? current.value : unknown()); continue; }
        if (current.kind === "enum") { output += item.prefix + (typeof current.memberName === "string" ? current.memberName : unknown()); continue; }
        if (current.kind === "array" && Array.isArray(current.items)) { output += item.prefix + "["; pending.push({ value: current.items.length > 8 || current.truncated ? "…]" : "]", depth: 0, prefix: "" }); for (let index = Math.min(current.items.length, 8) - 1; index >= 0; index -= 1) pending.push({ value: current.items[index], depth: item.depth + 1, prefix: index ? ", " : "" }); continue; }
        if (current.kind === "object" && Array.isArray(current.entries)) { output += item.prefix + "{"; const entries = current.entries.filter((entry) => entry && typeof entry.key === "string" && !forbidden.has(entry.key)).slice(0, 8); pending.push({ value: current.truncated || current.entries.length > entries.length ? "…}" : "}", depth: 0, prefix: "" }); for (let index = entries.length - 1; index >= 0; index -= 1) pending.push({ value: entries[index].value, depth: item.depth + 1, prefix: (index ? ", " : "") + entries[index].key + ": " }); continue; }
        let keys; try { if (Object.getPrototypeOf(current) !== null) return unknown(); keys = Object.keys(current).filter((key) => { const descriptor = Object.getOwnPropertyDescriptor(current, key); if (!descriptor || !("value" in descriptor)) throw new Error("unsafe-descriptor"); return !forbidden.has(key); }).slice(0, 8); } catch (_error) { return unknown(); }
        if (Object.prototype.hasOwnProperty.call(current, "__functionTutorIterator")) return unknown();
        output += item.prefix + "{";
        pending.push({ value: Object.keys(current).filter((key) => !forbidden.has(key)).length > keys.length ? "…}" : "}", depth: 0, prefix: "" });
        for (let index = keys.length - 1; index >= 0; index -= 1) pending.push({ value: Object.getOwnPropertyDescriptor(current, keys[index]).value, depth: item.depth + 1, prefix: (index ? ", " : "") + keys[index] + ": " });
      }
      return output && output.length <= 512 && !pending.length ? output : unknown();
    }
    function functionTutorScenarioInputText(value) {
      if (!value || value.kind === "unknown") return undefined;
      if (value.kind === "undefined") return "undefined";
      const holder = { value: undefined };
      const pending = [{ value: value, target: holder, key: "value", depth: 0 }];
      let work = 0;
      while (pending.length > 0 && work < 96) {
        work += 1;
        const item = pending.pop();
        const current = item.value;
        if (!current || current.kind === "unknown" || current.kind === "enum" || current.kind === "undefined" || item.depth > 4) return undefined;
        if (current.kind === "null") { item.target[item.key] = null; continue; }
        if (current.kind === "boolean" || current.kind === "number" || current.kind === "string") { item.target[item.key] = current.value; continue; }
        if (current.kind === "array") {
          const target = []; item.target[item.key] = target;
          for (let index = current.items.length - 1; index >= 0; index -= 1) pending.push({ value: current.items[index], target: target, key: index, depth: item.depth + 1 });
          continue;
        }
        if (current.kind === "object") {
          const target = Object.create(null); item.target[item.key] = target;
          for (let index = current.entries.length - 1; index >= 0; index -= 1) {
            const entry = current.entries[index];
            if (!entry || typeof entry.key !== "string" || ["__proto__", "prototype", "constructor"].includes(entry.key)) return undefined;
            pending.push({ value: entry.value, target: target, key: entry.key, depth: item.depth + 1 });
          }
          continue;
        }
        return undefined;
      }
      return pending.length === 0 ? JSON.stringify(holder.value) : undefined;
    }
    function functionTutorCanonical(value) { return JSON.stringify(value); }
    function functionTutorReadMember(value, path) {
      let current = value;
      for (const part of path || []) {
        if (!isFunctionTutorKnown(current)) return current || createFunctionTutorUnknown("ambiguous-binding");
        if (part === "length" && current.kind === "array") { current = { kind: "number", value: current.items.length }; continue; }
        if (part === "length" && current.kind === "string") { current = { kind: "number", value: current.value.length }; continue; }
        if (current.kind !== "object") return createFunctionTutorUnknown("unsupported-expression");
        current = current.entries.find((entry) => entry.key === part)?.value || createFunctionTutorUnknown("ambiguous-binding");
      }
      return current;
    }
    function functionTutorEvaluate(expression, environment) {
      if (!expression) return createFunctionTutorUnknown("not-inferred");
      if (expression.kind === "literal") return cloneFunctionTutorValue(expression.value);
      if (expression.kind === "binding") return cloneFunctionTutorValue(environment.get(expression.bindingId) || createFunctionTutorUnknown("ambiguous-binding"));
      if (expression.kind === "member") return functionTutorReadMember(functionTutorEvaluate(expression.object, environment), expression.path);
      if (expression.kind === "unsupported") return createFunctionTutorUnknown(expression.reason);
      if (expression.kind === "array") return { kind: "array", items: expression.items.map((item) => functionTutorEvaluate(item, environment)), truncated: false };
      if (expression.kind === "object") return { kind: "object", entries: expression.entries.map((entry) => ({ key: entry.key, value: functionTutorEvaluate(entry.value, environment) })), truncated: false };
      if (expression.kind === "conditional") {
        const condition = functionTutorEvaluate(expression.condition, environment);
        return condition.kind === "boolean" ? functionTutorEvaluate(condition.value ? expression.whenTrue : expression.whenFalse, environment) : createFunctionTutorUnknown("not-inferred");
      }
      if (expression.kind === "unary") {
        const value = functionTutorEvaluate(expression.operand, environment);
        if (!isFunctionTutorKnown(value)) return value;
        if (expression.operator === "not" && value.kind === "boolean") return { kind: "boolean", value: !value.value };
        if (expression.operator === "plus" && value.kind === "number") return value;
        if (expression.operator === "minus" && value.kind === "number") return { kind: "number", value: -value.value };
        if (expression.operator === "typeof") return { kind: "string", value: value.kind === "null" ? "object" : value.kind };
        return createFunctionTutorUnknown("unsupported-expression");
      }
      if (expression.kind === "logical") {
        let last = createFunctionTutorUnknown("not-inferred");
        for (const member of expression.members) {
          const value = functionTutorEvaluate(member, environment);
          if (!isFunctionTutorKnown(value)) return value;
          if (expression.operator === "and" && value.kind === "boolean" && !value.value) return value;
          if (expression.operator === "or" && value.kind === "boolean" && value.value) return value;
          if (expression.operator === "nullish" && value.kind !== "null" && value.kind !== "undefined") return value;
          last = value;
        }
        return last;
      }
      if (expression.kind === "binary") {
        const left = functionTutorEvaluate(expression.left, environment);
        const right = functionTutorEvaluate(expression.right, environment);
        if (!isFunctionTutorKnown(left) || !isFunctionTutorKnown(right)) return createFunctionTutorUnknown("not-inferred");
        const scalar = (value) => value.kind === "number" || value.kind === "string" || value.kind === "boolean" ? value.value : undefined;
        const leftValue = scalar(left); const rightValue = scalar(right);
        if (leftValue === undefined || rightValue === undefined) return createFunctionTutorUnknown("unsupported-expression");
        if (expression.operator === "eq" || expression.operator === "strict-eq") return { kind: "boolean", value: leftValue === rightValue };
        if (expression.operator === "neq" || expression.operator === "strict-neq") return { kind: "boolean", value: leftValue !== rightValue };
        if (expression.operator === "lt") return { kind: "boolean", value: leftValue < rightValue };
        if (expression.operator === "lte") return { kind: "boolean", value: leftValue <= rightValue };
        if (expression.operator === "gt") return { kind: "boolean", value: leftValue > rightValue };
        if (expression.operator === "gte") return { kind: "boolean", value: leftValue >= rightValue };
        if (typeof leftValue !== "number" || typeof rightValue !== "number") return createFunctionTutorUnknown("unsupported-expression");
        if (expression.operator === "add") return { kind: "number", value: leftValue + rightValue };
        if (expression.operator === "subtract") return { kind: "number", value: leftValue - rightValue };
        if (expression.operator === "multiply") return { kind: "number", value: leftValue * rightValue };
        if (expression.operator === "divide" && rightValue !== 0) return { kind: "number", value: leftValue / rightValue };
        if (expression.operator === "modulo" && rightValue !== 0) return { kind: "number", value: leftValue % rightValue };
        return createFunctionTutorUnknown("unsupported-expression");
      }
      return createFunctionTutorUnknown("unsupported-expression");
    }
    function functionTutorWrite(environment, target, value) {
      const before = target.kind === "binding" ? environment.get(target.bindingId) : functionTutorReadMember(environment.get(target.bindingId), target.path);
      if (target.kind === "binding") environment.set(target.bindingId, value);
      else {
        const root = cloneFunctionTutorValue(environment.get(target.bindingId) || createFunctionTutorUnknown("ambiguous-binding"));
        if (root.kind !== "object" || !target.path?.length || target.path.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) return { before, after: createFunctionTutorUnknown("unsupported-expression") };
        let entries = root.entries;
        for (let index = 0; index < target.path.length - 1; index += 1) {
          const key = target.path[index]; let entry = entries.find((candidate) => candidate.key === key);
          if (!entry || entry.value.kind !== "object") { entry = { key, value: { kind: "object", entries: [], truncated: false } }; entries.push(entry); }
          entries = entry.value.entries;
        }
        const key = target.path[target.path.length - 1]; const existing = entries.find((entry) => entry.key === key);
        if (existing) existing.value = value; else entries.push({ key, value });
        environment.set(target.bindingId, root);
      }
      return { before: before || { kind: "undefined" }, after: value };
    }
    function functionTutorRunScenario(tutor, seed) {
      // New opaque bundles share Values' iterative evaluator. The old local
      // interpreter remains solely for snapshots issued before bundles existed.
      const bundled = typeof functionTutorRunProgramBundleScenario === "function"
        ? functionTutorRunProgramBundleScenario(tutor, seed) : undefined;
      if (bundled) return bundled;
      const blocksById = new Map(tutor.program.blocks.map((block) => [block.blockId, block]));
      const outgoing = new Map();
      for (const edge of tutor.program.edges) { const values = outgoing.get(edge.sourceBlockId) || []; values.push(edge); outgoing.set(edge.sourceBlockId, values); }
      const bindingByParameter = new Map(tutor.program.bindings.filter((binding) => binding.parameterId).map((binding) => [binding.parameterId, binding.bindingId]));
      const initial = new Map();
      for (const input of seed.inputs) { const bindingId = bindingByParameter.get(input.parameterId); if (bindingId) initial.set(bindingId, cloneFunctionTutorValue(input.value)); }
      const queue = [{ blockId: tutor.program.entryBlockId, environment: initial, blockIds: [], edgeIds: [], transitions: [], terminal: undefined, certainty: seed.certainty, loops: new Map(), steps: 0 }];
      const paths = [];
      while (queue.length && paths.length < FUNCTION_TUTOR_MAX_PATHS) {
        const state = queue.shift(); const block = blocksById.get(state.blockId);
        if (!block || state.steps >= FUNCTION_TUTOR_MAX_STEPS) { paths.push({ ...state, terminal: { kind: "truncated" }, limited: true }); continue; }
        const loops = new Map(state.loops); const visits = (loops.get(block.blockId) || 0) + 1; loops.set(block.blockId, visits);
        if (block.kind === "loop" && visits > FUNCTION_TUTOR_MAX_LOOPS) {
          paths.push({ ...state, loops, terminal: { kind: "truncated", reason: "loop-budget" }, limited: true });
          continue;
        }
        const environment = new Map(state.environment); const transitions = state.transitions.slice();
        for (const operation of block.operations) {
          if (operation.kind === "define" || operation.kind === "assign") {
            const value = functionTutorEvaluate(operation.value, environment); const target = operation.kind === "define" ? { kind: "binding", bindingId: operation.bindingId } : operation.target;
            const written = functionTutorWrite(environment, target, value);
            transitions.push({ blockId: block.blockId, targetBindingId: target.bindingId, target: tutor.program.bindings.find((binding) => binding.bindingId === target.bindingId)?.name || "value", before: written.before, after: written.after, certainty: value.kind === "unknown" ? "unknown" : state.certainty });
          } else if (operation.kind === "increment") {
            const current = operation.target.kind === "binding" ? environment.get(operation.target.bindingId) : functionTutorReadMember(environment.get(operation.target.bindingId), operation.target.path);
            const value = current?.kind === "number" ? { kind: "number", value: current.value + operation.delta } : createFunctionTutorUnknown("unsupported-expression");
            const written = functionTutorWrite(environment, operation.target, value);
            transitions.push({ blockId: block.blockId, targetBindingId: operation.target.bindingId, target: tutor.program.bindings.find((binding) => binding.bindingId === operation.target.bindingId)?.name || "value", before: written.before, after: written.after, certainty: value.kind === "unknown" ? "unknown" : state.certainty });
          }
        }
        const base = { ...state, loops, environment, blockIds: [...state.blockIds, block.blockId], transitions, steps: state.steps + 1 };
        if (block.terminal) { paths.push({ ...base, terminal: { kind: block.terminal.kind, value: block.terminal.value ? functionTutorEvaluate(block.terminal.value, environment) : undefined } }); continue; }
        const edges = (outgoing.get(block.blockId) || []).filter((edge) => edge.kind !== "defines" && edge.kind !== "deferred");
        if (!edges.length) { paths.push({ ...base, terminal: { kind: "exit" } }); continue; }
        if (block.decision) {
          const decision = functionTutorEvaluate(block.decision.expression, environment);
          const matching = decision.kind === "boolean" ? edges.filter((edge) => edge.kind === (decision.value ? "true" : "false")) : [];
          const candidates = matching.length ? matching : edges.slice(0, Math.max(1, FUNCTION_TUTOR_MAX_PATHS - paths.length));
          for (const edge of candidates) queue.push({ ...base, blockId: edge.targetBlockId, edgeIds: [...base.edgeIds, edge.edgeId], certainty: matching.length ? base.certainty : "unknown" });
        } else {
          for (const edge of edges.slice(0, 1)) queue.push({ ...base, blockId: edge.targetBlockId, edgeIds: [...base.edgeIds, edge.edgeId] });
        }
      }
      if (queue.length) paths.forEach((path) => { path.limited = true; });
      return paths;
    }
    ${getFunctionTutorGuideBrowserSource()}
  `;
}
