/** Internal value semantics for the opaque program machine: bounded data, references and snapshots. */
/** Supplies private value helpers to the existing Scenario browser-source composer. */
export function getFunctionLogicScenarioProgramValuesBrowserSource(): string {
  return /* js */ `
    /** Formats own data without JSON's loss of undefined, non-finite numbers or negative zero. */
    function functionLogicScenarioProgramValueText(value) {
      const pending = [{ value, depth: 0 }]; const active = new Set(); let output = ""; let work = 0;
      while (pending.length && ++work <= 512 && output.length <= MAX_LOGIC_SCENARIO_DISPLAY_LENGTH) {
        const frame = pending.pop();
        if (frame.text !== undefined) { output += frame.text; if (frame.close) active.delete(frame.close); continue; }
        const current = frame.value;
        if (current === null) { output += "null"; continue; }
        if (current === undefined) { output += "undefined"; continue; }
        if (typeof current === "string") { output += JSON.stringify(current); continue; }
        if (typeof current === "number" || typeof current === "boolean") { output += Object.is(current, -0) ? "-0" : String(current); continue; }
        if (!isFunctionLogicScenarioWritableContainer(current) || active.has(current) || frame.depth > 16) return projectAnalyzerText("unknown");
        const array = Array.isArray(current); const keys = array ? Array.from({ length: Math.min(current.length, 64) }, (_, index) => String(index)) : Object.keys(current);
        if (keys.length > 64 || array && current.length > 64 || keys.some((key) => key.startsWith("__functionTutor") || FUNCTION_LOGIC_SCENARIO_BLOCKED_KEYS.has(key))) return projectAnalyzerText("unknown");
        active.add(current); output += array ? "[" : "{"; pending.push({ text: array ? "]" : "}", close: current });
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, keys[index]);
          if (descriptor && !Object.hasOwn(descriptor, "value")) return projectAnalyzerText("unknown");
          pending.push({ value: descriptor?.value, depth: frame.depth + 1 });
          if (!array) pending.push({ text: JSON.stringify(keys[index]) + ":" });
          if (index) pending.push({ text: "," });
        }
      }
      return pending.length ? output + "…" : output;
    }

    /** Converts complete static data iteratively; an unknown child stays unknown. */
    function functionLogicScenarioProgramLiteral(root) {
      const values = new Map(); const active = new Set(); const pending = [{ value: root, ready: false, depth: 0 }]; let work = 0;
      const unknown = () => createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-call-unsupported"), []);
      while (pending.length && ++work <= 512) {
        const frame = pending.pop(); const value = frame.value;
        if (!value || value.kind === "unknown" || value.kind === "enum" || value.truncated || frame.depth > 16) return unknown();
        if (values.has(value)) continue;
        if (value.kind !== "array" && value.kind !== "object") {
          if (!["null", "undefined", "boolean", "number", "string"].includes(value.kind)) return unknown();
          values.set(value, value.kind === "null" ? null : value.kind === "undefined" ? undefined : value.value); continue;
        }
        const children = value.kind === "array" ? value.items : value.entries.map((entry) => entry.value);
        if (children.length > 64 || value.kind === "object" && value.entries.some((entry) => FUNCTION_LOGIC_SCENARIO_BLOCKED_KEYS.has(entry.key))) return unknown();
        if (!frame.ready) {
          if (active.has(value)) return unknown(); active.add(value); pending.push({ ...frame, ready: true });
          for (const child of children) pending.push({ value: child, ready: false, depth: frame.depth + 1 });
        } else {
          active.delete(value);
          values.set(value, value.kind === "array" ? children.map((child) => values.get(child))
            : Object.assign(Object.create(null), Object.fromEntries(value.entries.map((entry) => [entry.key, values.get(entry.value)]))));
        }
      }
      return pending.length ? unknown() : createFunctionLogicScenarioKnown(values.get(root), []);
    }

    /** Projects bounded own data to the existing Tutor value contract without getters or recursion. */
    function functionLogicScenarioProgramStatic(state) {
      const unknown = { kind: "unknown", reason: "not-inferred" };
      if (!state || state.kind !== "known") return unknown;
      // Map uses SameValueZero: separate -0 from 0 while memoizing shared data.
      const negativeZero = {}; const keyFor = (value) => Object.is(value, -0) ? negativeZero : value;
      const values = new Map(); const active = new Set(); const pending = [{ value: state.value, ready: false, depth: 0 }]; let work = 0;
      while (pending.length && ++work <= 512) {
        const frame = pending.pop(); const value = frame.value; const key = keyFor(value);
        if (values.has(key)) continue;
        if (value === null || value === undefined) { values.set(key, { kind: value === null ? "null" : "undefined" }); continue; }
        if (["boolean", "number", "string"].includes(typeof value)) { values.set(key, { kind: typeof value, value }); continue; }
        if (!isFunctionLogicScenarioWritableContainer(value) || frame.depth > 16) return unknown;
        const keys = Object.keys(value); if (keys.length > 64 || keys.some((key) => FUNCTION_LOGIC_SCENARIO_BLOCKED_KEYS.has(key) || key.startsWith("__functionTutor"))) return unknown;
        const children = keys.map((key) => Object.getOwnPropertyDescriptor(value, key));
        if (children.some((item) => !item || !Object.hasOwn(item, "value"))) return unknown;
        if (!frame.ready) {
          if (active.has(value)) return unknown; active.add(value); pending.push({ ...frame, ready: true });
          for (const child of children) pending.push({ value: child.value, ready: false, depth: frame.depth + 1 });
        } else {
          active.delete(value);
          if (Array.isArray(value)) {
            if (value.length > 64) return unknown;
            values.set(value, { kind: "array", items: Array.from({ length: value.length }, (_, index) => values.get(keyFor(Object.getOwnPropertyDescriptor(value, String(index))?.value)) || { kind: "undefined" }), truncated: false });
          } else values.set(value, { kind: "object", entries: keys.map((key, index) => ({ key, value: values.get(keyFor(children[index].value)) })), truncated: false });
        }
      }
      return pending.length ? unknown : values.get(keyFor(state.value)) || unknown;
    }

    /** Reads own fields and built-in length; missing, undefined and unknown stay distinct. */
    function readFunctionLogicScenarioProgramMember(state, path, optional) {
      if (!state || state.kind !== "known") return state || createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-receiver-unknown"), []);
      let current = state.value;
      for (const key of path || []) {
        if (FUNCTION_LOGIC_SCENARIO_BLOCKED_KEYS.has(String(key))) return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-object-key"), state.origins);
        if (current === null || current === undefined) return optional ? createFunctionLogicScenarioKnown(undefined, state.origins)
          : createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-receiver-unknown"), state.origins);
        if (key === "length" && (typeof current === "string" || Array.isArray(current))) { current = current.length; continue; }
        if (!isFunctionLogicScenarioWritableContainer(current)) return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-receiver-unknown"), state.origins);
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor && !Object.hasOwn(descriptor, "value")) return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-object-accessor"), state.origins);
        current = descriptor?.value;
      }
      return createFunctionLogicScenarioKnown(current, state.origins);
    }

    /** Invalidates current environments only; captured before/after records remain immutable. */
    function invalidateFunctionLogicScenarioProgramState(environments) {
      for (const environment of environments) for (const [id, value] of environment) environment.set(id,
        createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-call-unsupported"), value.origins || [id]));
    }

    /** Replaces the containers on a written path across aliases and active caller frames. */
    function propagateFunctionLogicScenarioProgramWrite(environments, previous, next, path) {
      if (previous?.kind !== "known" || next?.kind !== "known" || !isFunctionLogicScenarioWritableContainer(previous.value)) {
        invalidateFunctionLogicScenarioProgramState(environments); return false;
      }
      const replacements = new Map(); const originals = new Map(); let oldValue = previous.value; let newValue = next.value;
      for (let index = 0; index < path.length; index += 1) {
        if (!isFunctionLogicScenarioWritableContainer(oldValue) || !isFunctionLogicScenarioWritableContainer(newValue)) break;
        replacements.set(oldValue, newValue); originals.set(newValue, oldValue);
        oldValue = Object.getOwnPropertyDescriptor(oldValue, path[index])?.value;
        newValue = Object.getOwnPropertyDescriptor(newValue, path[index])?.value;
      }
      const canonical = (value) => originals.get(value) || value;
      const rebuilt = new Map(); const active = new Set(); const pending = [];
      for (const environment of environments) for (const value of environment.values()) if (value.kind === "known" && isFunctionLogicScenarioWritableContainer(value.value)) pending.push({ value: canonical(value.value), ready: false, depth: 0 });
      let work = 0; let failed = false;
      while (pending.length && ++work <= 1024) {
        const frame = pending.pop(); const value = canonical(frame.value);
        if (rebuilt.has(value)) continue;
        if (frame.depth > 16) { failed = true; break; }
        const source = replacements.get(value) || value; const keys = Object.getOwnPropertyNames(source);
        const children = keys.map((key) => Object.getOwnPropertyDescriptor(source, key));
        if (keys.length > 65 || children.some((child) => !child || !Object.hasOwn(child, "value"))) { failed = true; break; }
        if (!frame.ready) {
          if (active.has(value)) { failed = true; break; } active.add(value); pending.push({ ...frame, value, ready: true });
          for (const child of children) if (isFunctionLogicScenarioWritableContainer(child.value)) pending.push({ value: canonical(child.value), ready: false, depth: frame.depth + 1 });
        } else {
          active.delete(value); let changed = source !== value;
          const outputs = children.map((child) => { const output = rebuilt.get(canonical(child.value)); if (output && output !== child.value) changed = true; return output || child.value; });
          if (!changed) rebuilt.set(value, value);
          else {
            const clone = cloneFunctionLogicScenarioContainer(source); if (clone.errorDescriptor) { failed = true; break; }
            for (let index = 0; index < keys.length; index += 1) if (writeFunctionLogicScenarioOwnData(clone.value, keys[index], outputs[index]).errorDescriptor) failed = true;
            if (failed) break; rebuilt.set(value, clone.value);
          }
        }
      }
      if (failed || pending.length) { invalidateFunctionLogicScenarioProgramState(environments); return false; }
      for (const environment of environments) for (const [id, state] of environment) {
        const value = state.kind === "known" && rebuilt.get(canonical(state.value));
        if (value && value !== state.value) environment.set(id, createFunctionLogicScenarioKnown(value, [...state.origins, ...(next.origins || [])]));
      }
      return true;
    }

    /** Captures the left-hand value before evaluating an assignment's right-hand expression. */
    function readFunctionLogicScenarioProgramTarget(frame, operation) {
      const target = operation.kind === "define" ? { kind: "binding", bindingId: operation.bindingId } : operation.target;
      const receiver = frame.environment.get(target.bindingId) || createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-unassigned"), [target.bindingId]);
      const path = target.kind === "member" ? resolveFunctionLogicScenarioTutorMemberPath(target, frame.environment) : undefined;
      return { target, receiver, path, before: target.kind === "member" ? path ? readFunctionLogicScenarioProgramMember(receiver, path, false)
        : createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-object-key"), receiver.origins) : receiver };
    }

    /** Commits one assignment and records the immediate source-owned before/after pair. */
    function applyFunctionLogicScenarioProgramOperation(frame, operation, value, saved, environments) {
      const operators = { set: "=", add: "+", subtract: "-", multiply: "*", divide: "/", modulo: "%" };
      const operator = operation.kind === "increment" ? operation.delta === 1 ? "+" : "-" : operation.kind === "define" ? "=" : operators[operation.operator];
      let next = operation.kind === "delete" ? createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-deleted"), saved.before.origins)
        : operator === "=" ? value : operator ? applyFunctionLogicScenarioBinary(operator, saved.before, value)
          : createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-call-unsupported"), saved.before.origins);
      if (saved.target.kind === "member") {
        const receiver = frame.environment.get(saved.target.bindingId) || saved.receiver;
        const member = saved.path ? applyFunctionLogicScenarioTutorMemberChange(receiver, saved.path, operation.kind === "delete" ? "delete" : "set", next)
          : { root: createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-object-key"), receiver.origins) };
        const propagated = propagateFunctionLogicScenarioProgramWrite(environments, receiver, member.root, saved.path || []);
        next = propagated ? member.after || member.root
          : createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-call-unsupported"), receiver.origins);
        if (!propagated) frame.uncertain = true;
      } else frame.environment.set(saved.target.bindingId, next);
      const name = frame.program.bindings.find((binding) => binding.bindingId === saved.target.bindingId)?.name || saved.target.bindingId;
      frame.transitions.push({ blockId: frame.block.blockId, kind: next.kind === "known" ? "calculation" : "unknown",
        targetBindingId: saved.target.bindingId, targetName: name + (saved.path || []).map((key) => "[" + JSON.stringify(key) + "]").join(""), sourceLabel: frame.block.label,
        valueRef: saved.path ? { rootBindingId: saved.target.bindingId, path: saved.path, segments: saved.path.map((key) => ({ kind: "static", key })) } : undefined,
        operator: operation.kind === "delete" ? "delete" : operation.kind === "increment" ? operation.delta === 1 ? "++" : "--" : operator === "=" ? "=" : (operator || "?") + "=",
        expression: "", before: saved.before, after: next, dependencyBindingIds: next.origins || [], certainty: next.kind === "known" ? "exact" : "unknown" });
    }
  `;
}
