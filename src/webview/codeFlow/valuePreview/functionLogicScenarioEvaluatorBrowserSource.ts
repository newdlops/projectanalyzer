/**
 * Browser-only Function Logic Scenario state engine. It owns bounded inputs,
 * immutable value states, and iterative CFG propagation; the expression grammar
 * is composed through its adjacent internal browser-source module.
 */

import {
  getFunctionLogicScenarioExpressionBrowserSource
} from "./functionLogicScenarioExpressionBrowserSource";
import {
  getFunctionLogicScenarioObjectWriteBrowserSource
} from "./functionLogicScenarioObjectWriteBrowserSource";

/** Returns the public Scenario calculation browser-source composition. */
export function getFunctionLogicScenarioEvaluatorBrowserSource(): string {
  return /* js */ `
    ${getFunctionLogicScenarioExpressionBrowserSource()}
    ${getFunctionLogicScenarioObjectWriteBrowserSource()}

    const MAX_LOGIC_SCENARIO_WORK_ITEMS = 1200;
    const MAX_LOGIC_SCENARIO_DISPLAY_LENGTH = 180;

    /**
     * Converts evaluator-owned failures into a small presentation contract.
     * The legacy reason field remains only as a compatibility fallback for older payloads;
     * new states always carry the locale-neutral descriptor.
     */
    /** Legacy-only adapter for persisted states produced before descriptor contracts. */
    function adaptLegacyFunctionLogicScenarioReason(reason, fallbackKey) {
      if (reason && typeof reason === "object" && reason.key) return reason;
      const text = String(reason || "");
      const exact = {
        "value is unknown": "scenario-reason-value-unknown",
        "value is not assigned": "scenario-reason-value-unassigned",
        "scenario input is not set": "scenario-reason-input-unset",
        "parameter input is not set": "scenario-reason-parameter-unset",
        "custom variable input is not set": "scenario-reason-custom-unset",
        "definition has not been reached": "scenario-reason-definition-unreached",
        "function calls are not executed": "scenario-reason-calls-static",
        "function and constructor calls are not executed": "scenario-reason-calls-static",
        "multiple reachable values": "scenario-reason-multiple-values",
        "prototype-sensitive field is not writable": "scenario-reason-prototype-write",
        "object field is not assigned": "scenario-reason-field-unassigned"
      };
      if (exact[text]) return { key: exact[text], values: {}, fallback: text };
      const member = /^member (.+) is unavailable$/u.exec(text);
      if (member) return { key: "scenario-reason-member-unavailable", values: { member: member[1] }, fallback: text };
      const identifier = /^unresolved identifier (.+)$/u.exec(text);
      if (identifier) return { key: "scenario-reason-unresolved-identifier", values: { name: identifier[1] }, fallback: text };
      const operator = /^unsupported (?:assignment )?operator (.+)$/u.exec(text);
      if (operator) return { key: "scenario-reason-unsupported-operator", values: { operator: operator[1] }, fallback: text };
      return { key: fallbackKey || "scenario-reason-static-unsupported", values: {}, fallback: text || "value is unknown" };
    }

    /** Creates one locale-neutral evaluator failure descriptor from finite catalog keys. */
    function createFunctionLogicScenarioReason(key, values, fallback) {
      return { key: key, values: values || {}, ...(fallback ? { fallback: fallback } : {}) };
    }

    /** Formats a descriptor at render time, retaining legacy payload support. */
    function formatFunctionLogicScenarioReason(state) {
      const descriptor = state?.reasonDescriptor;
      if (descriptor?.key) return projectAnalyzerText(descriptor.key, descriptor.values);
      return String(state?.reason || projectAnalyzerText("scenario-reason-value-unknown"));
    }

    /** Creates an immutable known value with bounded provenance identities. */
    function createFunctionLogicScenarioKnown(value, origins) {
      return {
        kind: "known",
        value,
        origins: normalizeFunctionLogicScenarioOrigins(origins)
      };
    }

    /** Creates an explicit unknown rather than guessing unsupported semantics. */
    function createFunctionLogicScenarioUnknown(reasonDescriptor, origins) {
      if (!reasonDescriptor?.key) return createLegacyFunctionLogicScenarioUnknown(reasonDescriptor, origins);
      return {
        kind: "unknown",
        reason: reasonDescriptor?.fallback || "",
        reasonDescriptor,
        origins: normalizeFunctionLogicScenarioOrigins(origins)
      };
    }

    /** Represents a binding that has not reached a visible definition. */
    function createFunctionLogicScenarioUnset(reasonDescriptor, origins) {
      if (!reasonDescriptor?.key) return createLegacyFunctionLogicScenarioUnset(reasonDescriptor, origins);
      return {
        kind: "unset",
        reason: reasonDescriptor?.fallback || "",
        reasonDescriptor,
        origins: normalizeFunctionLogicScenarioOrigins(origins)
      };
    }

    /** Legacy-only state construction for older cached records; new evaluator paths use descriptors directly. */
    function createLegacyFunctionLogicScenarioUnknown(reason, origins) { return createFunctionLogicScenarioUnknown(adaptLegacyFunctionLogicScenarioReason(reason), origins); }
    function createLegacyFunctionLogicScenarioUnset(reason, origins) { return createFunctionLogicScenarioUnset(adaptLegacyFunctionLogicScenarioReason(reason), origins); }

    /** Deduplicates and bounds provenance carried through derived values. */
    function normalizeFunctionLogicScenarioOrigins(origins) {
      const result = [];
      for (const origin of origins || []) {
        if (origin && !result.includes(origin)) result.push(origin);
        if (result.length >= 24) break;
      }
      return result;
    }

    /** Returns one state with additional origins without mutating its value. */
    function addFunctionLogicScenarioOrigins(state, origins) {
      const combined = normalizeFunctionLogicScenarioOrigins([
        ...(state?.origins || []),
        ...(origins || [])
      ]);
      if (!state || state.kind === "unset") {
        return state?.reasonDescriptor ? createFunctionLogicScenarioUnset(state.reasonDescriptor, combined) : createLegacyFunctionLogicScenarioUnset(state?.reason, combined);
      }
      if (state.kind === "unknown") {
        return state.reasonDescriptor ? createFunctionLogicScenarioUnknown(state.reasonDescriptor, combined) : createLegacyFunctionLogicScenarioUnknown(state.reason, combined);
      }
      return createFunctionLogicScenarioKnown(state.value, combined);
    }

    /** Parses one user input as JSON or a bounded scalar literal. */
    function parseFunctionLogicScenarioInput(rawValue, bindingId) {
      const text = String(rawValue || "").trim();
      const origins = bindingId ? [bindingId] : [];
      if (!text) {
        return createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-input-unset"), origins);
      }
      try {
        return createFunctionLogicScenarioKnown(JSON.parse(text), origins);
      } catch (_error) {
        // JSON is the composite-value boundary. Scalar fallbacks cover common
        // TypeScript, Python, and Java spellings without executing source text.
      }
      if (text === "undefined") return createFunctionLogicScenarioKnown(undefined, origins);
      if (text === "NaN") return createFunctionLogicScenarioKnown(Number.NaN, origins);
      if (text === "Infinity" || text === "+Infinity") {
        return createFunctionLogicScenarioKnown(Number.POSITIVE_INFINITY, origins);
      }
      if (text === "-Infinity") {
        return createFunctionLogicScenarioKnown(Number.NEGATIVE_INFINITY, origins);
      }
      if (text === "True" || text === "true") {
        return createFunctionLogicScenarioKnown(true, origins);
      }
      if (text === "False" || text === "false") {
        return createFunctionLogicScenarioKnown(false, origins);
      }
      if (text === "None" || text === "null") {
        return createFunctionLogicScenarioKnown(null, origins);
      }
      const numberPattern = /^[+-]?(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)$/u;
      if (numberPattern.test(text.replaceAll("_", ""))) {
        return createFunctionLogicScenarioKnown(Number(text.replaceAll("_", "")), origins);
      }
      const stringValue = readFunctionLogicScenarioStringLiteral(text);
      if (stringValue.ok) return createFunctionLogicScenarioKnown(stringValue.value, origins);
      return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-invalid-input"), origins);
    }

    /** Runs immutable state propagation over only the branch-enabled visible CFG. */
    function calculateFunctionLogicScenario(logic, nodeButtonsById, edgeElementsById) {
      const bindings = readFunctionLogicScenarioEditableBindings(logic.valueBindings || []);
      const context = createFunctionLogicScenarioContext(bindings);
      const blockById = new Map(logic.blocks.map((block) => [block.id, block]));
      const presentationEnabledBlockIds = new Set(logic.blocks.filter((block) =>
        !nodeButtonsById.get(block.id)?.classList.contains("choice-dimmed")
      ).map((block) => block.id));
      const enabledBlockIds = collectFunctionLogicScenarioRuntimeBlocks(
        logic,
        presentationEnabledBlockIds,
        edgeElementsById
      );
      const enabledEdges = (logic.edges || []).filter((edge) =>
        isFunctionLogicScenarioRuntimeEdge(edge)
          && enabledBlockIds.has(edge.sourceId)
          && enabledBlockIds.has(edge.targetId)
          && !edgeElementsById?.get(edge.id)?.path?.classList.contains("choice-dimmed")
      );
      const outgoingBySourceId = new Map();
      const incomingCountByBlockId = new Map(logic.blocks.map((block) => [block.id, 0]));
      for (const edge of enabledEdges) {
        const outgoing = outgoingBySourceId.get(edge.sourceId) || [];
        outgoing.push(edge);
        outgoingBySourceId.set(edge.sourceId, outgoing);
        incomingCountByBlockId.set(edge.targetId, (incomingCountByBlockId.get(edge.targetId) || 0) + 1);
      }
      const inputStateByBindingId = new Map();
      const seedEnvironment = new Map();
      for (const binding of bindings) {
        const rawInput = readFunctionLogicValuePreview(binding.id);
        const parsed = parseFunctionLogicScenarioInput(rawInput, binding.id);
        inputStateByBindingId.set(binding.id, parsed);
        seedEnvironment.set(
          binding.id,
          binding.kind === "parameter" || binding.manual
            ? (rawInput ? parsed : createFunctionLogicScenarioUnknown(
                createFunctionLogicScenarioReason(binding.manual ? "scenario-reason-custom-unset" : "scenario-reason-parameter-unset"),
                [binding.id]
              ))
            : createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-definition-unreached"), [binding.id])
        );
      }
      const roots = logic.blocks.filter((block) => enabledBlockIds.has(block.id)
        && (block.kind === "entry" || (incomingCountByBlockId.get(block.id) || 0) === 0));
      if (roots.length === 0) {
        const first = logic.blocks.find((block) => enabledBlockIds.has(block.id));
        if (first) roots.push(first);
      }
      const incomingEnvironmentByBlockId = new Map();
      const outputEnvironmentByBlockId = new Map();
      const recordsByBlockId = new Map();
      const pending = [];
      const queued = new Set();
      for (const root of roots) {
        incomingEnvironmentByBlockId.set(root.id, new Map(seedEnvironment));
        pending.push(root.id);
        queued.add(root.id);
      }
      let cursor = 0;
      let processed = 0;
      while (cursor < pending.length && processed < MAX_LOGIC_SCENARIO_WORK_ITEMS) {
        const blockId = pending[cursor];
        cursor += 1;
        queued.delete(blockId);
        const block = blockById.get(blockId);
        const incoming = incomingEnvironmentByBlockId.get(blockId);
        if (!block || !incoming || !enabledBlockIds.has(blockId)) continue;
        processed += 1;
        const record = executeFunctionLogicScenarioBlock(
          block,
          incoming,
          inputStateByBindingId,
          context
        );
        recordsByBlockId.set(blockId, record);
        const previousOutput = outputEnvironmentByBlockId.get(blockId);
        if (previousOutput && areFunctionLogicScenarioEnvironmentsEqual(previousOutput, record.after)) {
          continue;
        }
        outputEnvironmentByBlockId.set(blockId, record.after);
        for (const edge of outgoingBySourceId.get(blockId) || []) {
          const existing = incomingEnvironmentByBlockId.get(edge.targetId);
          const merged = existing
            ? mergeFunctionLogicScenarioEnvironments(existing, record.after)
            : new Map(record.after);
          if (existing && areFunctionLogicScenarioEnvironmentsEqual(existing, merged)) continue;
          incomingEnvironmentByBlockId.set(edge.targetId, merged);
          if (!queued.has(edge.targetId)) {
            pending.push(edge.targetId);
            queued.add(edge.targetId);
          }
        }
      }
      return {
        recordsByBlockId,
        inputStateByBindingId,
        truncated: cursor < pending.length,
        processed
      };
    }

    /**
     * Keeps Scenario calculation on immediate control flow. Callable definitions,
     * stored programs, and timer strings remain visible but cannot mutate the
     * host environment until a real invocation/dispatch is modeled.
     */
    function collectFunctionLogicScenarioRuntimeBlocks(
      logic,
      presentationEnabledBlockIds,
      edgeElementsById
    ) {
      const outgoingBySourceId = new Map();
      for (const edge of logic.edges || []) {
        if (!isFunctionLogicScenarioRuntimeEdge(edge)
          || !presentationEnabledBlockIds.has(edge.sourceId)
          || !presentationEnabledBlockIds.has(edge.targetId)
          || edgeElementsById?.get(edge.id)?.path?.classList.contains("choice-dimmed")) {
          continue;
        }
        const outgoing = outgoingBySourceId.get(edge.sourceId) || [];
        outgoing.push(edge);
        outgoingBySourceId.set(edge.sourceId, outgoing);
      }
      let roots = logic.blocks.filter((block) =>
        block.kind === "entry" && presentationEnabledBlockIds.has(block.id)
      );
      if (roots.length === 0) {
        const first = logic.blocks.find((block) => presentationEnabledBlockIds.has(block.id));
        roots = first ? [first] : [];
      }
      const reachable = new Set(roots.map((block) => block.id));
      const pending = roots.map((block) => block.id);
      let cursor = 0;
      while (cursor < pending.length && cursor < MAX_LOGIC_SCENARIO_WORK_ITEMS) {
        const sourceId = pending[cursor];
        cursor += 1;
        for (const edge of outgoingBySourceId.get(sourceId) || []) {
          if (reachable.has(edge.targetId)) continue;
          reachable.add(edge.targetId);
          pending.push(edge.targetId);
        }
      }
      return reachable;
    }

    /** Structural definition and delayed-dispatch links are not immediate CFG edges. */
    function isFunctionLogicScenarioRuntimeEdge(edge) {
      return edge.kind !== "defines" && edge.kind !== "deferred";
    }

    /** Applies definition overrides and source-backed changes in block order. */
    function executeFunctionLogicScenarioBlock(block, incoming, inputStates, context) {
      const before = new Map(incoming);
      const after = new Map(incoming);
      const transitions = [];
      const overriddenBindingIds = new Set();
      const definitions = (block.valueAccesses || []).filter((access) => access.access === "define");
      for (const access of definitions) {
        const binding = context.bindingById.get(access.bindingId);
        if (!binding || binding.kind === "parameter") continue;
        const inputState = inputStates.get(binding.id);
        if (readFunctionLogicValuePreview(binding.id)) {
          const next = addFunctionLogicScenarioOrigins(inputState, [binding.id]);
          after.set(binding.id, next);
          overriddenBindingIds.add(binding.id);
          transitions.push({
            kind: "override",
            targetBindingId: binding.id,
            targetName: binding.name,
            operator: "scenario =",
            expression: readFunctionLogicValuePreview(binding.id),
            before: before.get(binding.id)
              || createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-unassigned"), [binding.id]),
            after: next,
            dependencyBindingIds: [binding.id],
            confidence: binding.confidence
          });
        }
      }
      for (const change of block.valueChanges || []) {
        const targets = resolveFunctionLogicScenarioChangeTargets(change, block, after, context);
        for (const binding of targets) {
          if (change.operation === "initialize" && overriddenBindingIds.has(binding.id)) continue;
          const previous = after.get(binding.id)
            || createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-unassigned"), [binding.id]);
          const transitionBefore = change.targetKind === "property"
            ? readFunctionLogicScenarioPropertyTransitionState(
                change,
                previous,
                after,
                context
              )
            : previous;
          const calculated = applyFunctionLogicScenarioChange(change, previous, after, context);
          const next = addFunctionLogicScenarioOrigins(calculated, [binding.id]);
          after.set(binding.id, next);
          const transitionAfter = change.targetKind === "property"
            ? change.operation === "delete" && next.kind === "known"
              ? createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-deleted"), next.origins)
              : readFunctionLogicScenarioPropertyTransitionState(
                  change,
                  next,
                  after,
                  context
                )
            : next;
          transitions.push({
            kind: next.kind === "known" ? "calculation" : "unknown",
            targetBindingId: binding.id,
            targetName: change.targetKind === "property" ? change.target : binding.name,
            operator: change.operator,
            expression: change.value || "",
            before: transitionBefore,
            after: transitionAfter,
            dependencyBindingIds: normalizeFunctionLogicScenarioOrigins(next.origins),
            confidence: change.confidence
          });
        }
      }
      // A parser-proven write must never leave a stale preview behind. If no
      // source-backed value change matched that binding, invalidate it explicitly.
      const transitionedBindingIds = new Set(transitions.map((transition) =>
        transition.targetBindingId
      ));
      for (const access of block.valueAccesses || []) {
        if ((access.access !== "write" && access.access !== "readwrite")
          || transitionedBindingIds.has(access.bindingId)
          || !context.bindingById.has(access.bindingId)) {
          continue;
        }
        const previous = after.get(access.bindingId)
          || createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-unassigned"), [access.bindingId]);
        after.set(access.bindingId, createFunctionLogicScenarioUnknown(
          createFunctionLogicScenarioReason("scenario-reason-unsupported-expression", {}, "write has no supported source expression"),
          previous.origins
        ));
      }
      for (const access of definitions) {
        const binding = context.bindingById.get(access.bindingId);
        if (!binding || binding.kind === "parameter" || after.get(binding.id)?.kind !== "unset") {
          continue;
        }
        after.set(binding.id, createFunctionLogicScenarioUnknown(
          createFunctionLogicScenarioReason("scenario-reason-static-unsupported"),
          [binding.id]
        ));
      }
      return { before, after, transitions };
    }

    /** Resolves a value-change target to its tracked lexical binding. */
    function resolveFunctionLogicScenarioChangeTargets(change, block, environment, context) {
      const baseName = readFunctionLogicScenarioBaseName(change.target);
      const candidates = context.bindingsByName.get(baseName) || [];
      if (candidates.length <= 1) {
        return candidates.map((id) => context.bindingById.get(id)).filter(Boolean);
      }
      const definitions = new Set((block.valueAccesses || []).filter((access) =>
        access.access === "define" && access.name === baseName
      ).map((access) => access.bindingId));
      const local = candidates.filter((id) => definitions.has(id));
      if (local.length === 1) return [context.bindingById.get(local[0])].filter(Boolean);
      const active = candidates.filter((id) => environment.get(id)?.kind !== "unset");
      return active.length === 1 ? [context.bindingById.get(active[0])].filter(Boolean) : [];
    }

    /** Evaluates one exact lexical write or invalidates unsupported heap semantics. */
    function applyFunctionLogicScenarioChange(change, previous, environment, context) {
      if (change.targetKind === "property") {
        return applyFunctionLogicScenarioPropertyChange(
          change,
          previous,
          environment,
          context
        );
      }
      if (change.targetKind !== "variable") {
        return createFunctionLogicScenarioUnknown(
          createFunctionLogicScenarioReason("scenario-reason-static-unsupported", { target: change.targetKind }),
          previous.origins
        );
      }
      if (change.operation === "delete") {
        return createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-deleted"), previous.origins);
      }
      if (change.operation === "iterate") {
        return createFunctionLogicScenarioUnknown(
          createFunctionLogicScenarioReason("scenario-reason-static-unsupported"),
          previous.origins
        );
      }
      if (change.operation === "mutate" || change.confidence === "inferred") {
        return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-inferred-mutation"), previous.origins);
      }
      if (change.operator === "++" || change.operator === "--") {
        return applyFunctionLogicScenarioBinary(
          change.operator === "++" ? "+" : "-",
          previous,
          createFunctionLogicScenarioKnown(1, [])
        );
      }
      const right = evaluateFunctionLogicScenarioExpression(change.value, environment, context);
      if (change.operator === "=" || change.operation === "initialize"
        || change.operation === "assign") {
        return right;
      }
      const compoundOperators = {
        "+=": "+", "-=": "-", "*=": "*", "/=": "/", "%=": "%", "**=": "**",
        "<<=": "<<", ">>=": ">>", ">>>=": ">>>", "&=": "&", "|=": "|", "^=": "^",
        "&&=": "&&", "||=": "||", "??=": "??"
      };
      const operator = compoundOperators[change.operator];
      return operator
        ? applyFunctionLogicScenarioBinary(operator, previous, right)
        : createFunctionLogicScenarioUnknown(
            createFunctionLogicScenarioReason("scenario-reason-unsupported-operator", { operator: change.operator }),
            [...previous.origins, ...right.origins]
          );
    }

    /** Builds lexical lookup indexes shared by expression and block evaluation. */
    function createFunctionLogicScenarioContext(bindings) {
      const bindingById = new Map();
      const bindingsByName = new Map();
      for (const binding of bindings) {
        bindingById.set(binding.id, binding);
        const ids = bindingsByName.get(binding.name) || [];
        ids.push(binding.id);
        bindingsByName.set(binding.name, ids);
      }
      return { bindingById, bindingsByName };
    }

    /** Merges two path states through a small monotone lattice. */
    function mergeFunctionLogicScenarioStates(left, right) {
      const origins = normalizeFunctionLogicScenarioOrigins([
        ...(left?.origins || []),
        ...(right?.origins || [])
      ]);
      if (!left) return addFunctionLogicScenarioOrigins(right, origins);
      if (!right) return addFunctionLogicScenarioOrigins(left, origins);
      if (left.kind === "known" && right.kind === "known"
        && areFunctionLogicScenarioValuesEqual(left.value, right.value)) {
        return createFunctionLogicScenarioKnown(left.value, origins);
      }
      if (left.kind === "unset" && right.kind === "unset") {
        return left.reasonDescriptor || right.reasonDescriptor ? createFunctionLogicScenarioUnset(left.reasonDescriptor || right.reasonDescriptor, origins) : createLegacyFunctionLogicScenarioUnset(left.reason || right.reason, origins);
      }
      if (left.kind === "unknown" && right.kind === "unknown" && left.reasonDescriptor?.key === right.reasonDescriptor?.key) {
        return left.reasonDescriptor ? createFunctionLogicScenarioUnknown(left.reasonDescriptor, origins) : createLegacyFunctionLogicScenarioUnknown(left.reason, origins);
      }
      if (left.kind === "unset" || right.kind === "unset") {
        return createFunctionLogicScenarioUnknown(
          createFunctionLogicScenarioReason("scenario-reason-value-unassigned"),
          origins
        );
      }
      return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-multiple-values", {}, "multiple reachable values"), origins);
    }

    /** Merges complete environments without recursion or object mutation. */
    function mergeFunctionLogicScenarioEnvironments(left, right) {
      const result = new Map();
      const bindingIds = new Set([...left.keys(), ...right.keys()]);
      for (const bindingId of bindingIds) {
        result.set(bindingId, mergeFunctionLogicScenarioStates(
          left.get(bindingId),
          right.get(bindingId)
        ));
      }
      return result;
    }

    /** Compares immutable environments to terminate cycles and fixed points. */
    function areFunctionLogicScenarioEnvironmentsEqual(left, right) {
      const bindingIds = new Set([...left.keys(), ...right.keys()]);
      for (const bindingId of bindingIds) {
        if (!areFunctionLogicScenarioStatesEqual(left.get(bindingId), right.get(bindingId))) {
          return false;
        }
      }
      return true;
    }

    /** Compares value, state kind, reason, and provenance deterministically. */
    function areFunctionLogicScenarioStatesEqual(left, right) {
      if (!left || !right || left.kind !== right.kind) return left === right;
      if ((left.reasonDescriptor?.key || left.reason || "") !== (right.reasonDescriptor?.key || right.reason || "")) return false;
      if (left.kind === "known" && !areFunctionLogicScenarioValuesEqual(left.value, right.value)) {
        return false;
      }
      return (left.origins || []).join("|") === (right.origins || []).join("|");
    }

    /** Uses bounded serialization for data values and Object.is for primitives. */
    function areFunctionLogicScenarioValuesEqual(left, right) {
      if (Object.is(left, right)) return true;
      if ((typeof left !== "object" || left === null)
        || (typeof right !== "object" || right === null)) {
        return false;
      }
      try {
        return JSON.stringify(left) === JSON.stringify(right);
      } catch (_error) {
        return false;
      }
    }

    /** Produces debugger-shaped, bounded display text for one scenario state. */
    function formatFunctionLogicScenarioState(state) {
      if (!state || state.kind === "unset") return projectAnalyzerText("scenario-state-unset");
      if (state.kind === "unknown") return projectAnalyzerText("scenario-state-unknown", {
        reason: formatFunctionLogicScenarioReason(state)
      });
      let text;
      if (typeof state.value === "string") text = JSON.stringify(state.value);
      else if (state.value === undefined) text = "undefined";
      else if (typeof state.value === "number" && Number.isNaN(state.value)) text = "NaN";
      else if (state.value === Number.POSITIVE_INFINITY) text = "Infinity";
      else if (state.value === Number.NEGATIVE_INFINITY) text = "-Infinity";
      else {
        try {
          text = JSON.stringify(state.value);
        } catch (_error) {
          text = String(state.value);
        }
      }
      if (text === undefined) text = String(state.value);
      return text.length > MAX_LOGIC_SCENARIO_DISPLAY_LENGTH
        ? text.slice(0, MAX_LOGIC_SCENARIO_DISPLAY_LENGTH - 1) + "…"
        : text;
    }
  `;
}
