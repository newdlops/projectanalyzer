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
    function calculateFunctionLogicScenario(logic, nodeButtonsById, edgeElementsById, scenarioIdentity) {
      // New Host snapshots may carry an opaque program bundle. Keep the legacy
      // value-change engine as a compatibility path for earlier snapshots.
      if (logic?.tutor?.programBundle?.programs?.length) {
        const bundled = calculateFunctionLogicScenarioProgramBundle(logic, nodeButtonsById, edgeElementsById, undefined, scenarioIdentity);
        if (bundled) return bundled;
      }
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
     * Validates the bounded Host-issued bundle using an explicit frame queue.
     * This gate deliberately refuses incomplete/cyclic bundles before any
     * expression evaluation; it never resolves a callee by source name.
     */
    function calculateFunctionLogicScenarioProgramBundle(logic, nodeButtonsById, edgeElementsById, suppliedInputs, scenarioIdentity) {
      const bundle = logic.tutor.programBundle;
      const programs = new Map((bundle.programs || []).map((program) => [program.id, program]));
      const root = programs.get(bundle.rootProgramId);
      if (!root) return null;
      const linksByCallId = new Map((bundle.links || []).map((link) => [link.callId, link]));
      const omittedByCallId = new Map((bundle.omittedLinks || []).filter((link) => link.callId).map((link) => [link.callId, link]));
      const rootBindings = readFunctionLogicScenarioEditableBindings(logic.valueBindings || []);
      const visibleBindingsById = new Map(rootBindings.map((binding) => [binding.id, binding]));
      const visibleBindingIdsByRawId = createFunctionLogicScenarioVisibleIdentityMap(
        (root.bindings || []).filter((binding) => binding.parameterId).map((binding) => binding.bindingId),
        visibleBindingsById,
        scenarioIdentity?.resolveScenarioBindingId
      );
      const rootInput = new Map();
      for (const rawBindingId of (root.bindings || []).filter((binding) => binding.parameterId).map((binding) => binding.bindingId)) {
        // Tutor Scenario seeds use raw program IDs. They are authoritative and
        // intentionally bypass the visible compound-graph adapter.
        const explicitInput = suppliedInputs?.get(rawBindingId);
        if (explicitInput) {
          rootInput.set(rawBindingId, explicitInput);
          continue;
        }
        const visibleBindingId = visibleBindingIdsByRawId.get(rawBindingId);
        const raw = visibleBindingId ? readFunctionLogicValuePreview(visibleBindingId) : "";
        rootInput.set(rawBindingId, visibleBindingId && raw
          ? (suppliedInputs?.get(visibleBindingId) || parseFunctionLogicScenarioInput(raw, visibleBindingId))
          : createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-parameter-unset"), [visibleBindingId || rawBindingId]));
      }
      const recordsByBlockId = new Map();
      let work = 0;
      let expressionItems = 0;
      let truncated = false;
      const reasonForOmission = (reason) => ({ unresolved: "scenario-reason-call-unresolved", ambiguous: "scenario-reason-call-unresolved", cycle: "scenario-reason-call-cycle", "depth-budget": "scenario-reason-call-depth", "program-budget": "scenario-reason-program-budget", "block-budget": "scenario-reason-program-budget", "payload-budget": "scenario-reason-program-budget", unsupported: "scenario-reason-call-unsupported" }[reason] || "scenario-reason-call-unsupported");
      const literal = (value) => {
        if (!value || value.kind === "unknown") return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-call-unsupported"), []);
        if (value.kind === "null") return createFunctionLogicScenarioKnown(null, []);
        if (value.kind === "undefined") return createFunctionLogicScenarioKnown(undefined, []);
        if (value.kind === "array") return createFunctionLogicScenarioKnown(value.items.map((item) => literal(item).value), []);
        if (value.kind === "object") return createFunctionLogicScenarioKnown(Object.fromEntries(value.entries.map((entry) => [entry.key, literal(entry.value).value])), []);
        return createFunctionLogicScenarioKnown(value.value, []);
      };
      const rootEnvironment = new Map();
      for (const binding of root.bindings || []) if (binding.parameterId) rootEnvironment.set(binding.bindingId, rootInput.get(binding.bindingId) || createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-parameter-unset"), [binding.bindingId]));
      // One tagged LIFO worklist owns program entry, block execution, expression
      // reduction, and caller resumption. No evaluator invokes itself.
      // Occurrences retain evaluator order, including bounded loop revisits. The
      // aggregate arrays remain for existing symbolic/path consumers.
      const rootStory = { blockIds: [], edgeIds: [], transitions: [], occurrences: [], terminal: undefined };
      const frames = [{ tag: "program-enter", program: root, environment: rootEnvironment, depth: 0, ancestry: new Set(), keepRecords: true, resultId: "root", story: rootStory, allowAsync: true }];
      const results = new Map();
      let nextResultId = 0;
      const allocate = () => "scenario-result:" + nextResultId++;
      const unknown = (key) => createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason(key), []);
      while (frames.length) {
        if (++work > MAX_LOGIC_SCENARIO_WORK_ITEMS) { truncated = true; results.set("root", unknown("scenario-reason-program-budget")); break; }
        const frame = frames.pop();
        if (frame.tag === "program-enter") {
          if (!frame.program || (frame.program.executionKind !== "sync" && !(frame.program.executionKind === "async" && frame.allowAsync))) { results.set(frame.resultId, unknown(frame.program?.executionKind === "async" ? "scenario-reason-await-required" : "scenario-reason-call-unsupported")); continue; }
          if (frame.depth > 4) { results.set(frame.resultId, unknown("scenario-reason-call-depth")); continue; }
          if (frame.ancestry.has(frame.program.id)) { results.set(frame.resultId, unknown("scenario-reason-call-cycle")); continue; }
          const blockById = new Map(frame.program.blocks.map((block) => [block.blockId, block])); const outgoing = new Map();
          for (const edge of frame.program.edges || []) if (edge.kind !== "defines" && edge.kind !== "deferred") { const edges = outgoing.get(edge.sourceBlockId) || []; edges.push(edge); outgoing.set(edge.sourceBlockId, edges); }
          const ancestry = new Set(frame.ancestry); ancestry.add(frame.program.id);
          frames.push({ tag: "block-step", program: frame.program, environment: new Map(frame.environment), depth: frame.depth, ancestry, keepRecords: frame.keepRecords, resultId: frame.resultId, story: frame.story, blockById, outgoing, blockId: frame.program.entryBlockId, visits: new Map(), continuationValues: new Map(), continuationById: new Map((frame.program.continuations || []).map((item) => [item.id, item])) });
          continue;
        }
        if (frame.tag === "block-step") {
          const block = frame.blockById.get(frame.blockId); const seen = (frame.visits.get(frame.blockId) || 0) + 1; frame.visits.set(frame.blockId, seen);
          if (!block || seen > 3) { results.set(frame.resultId, unknown("scenario-reason-program-budget")); continue; }
          const occurrence = frame.keepRecords
            ? { blockId: block.blockId, transitions: [], selectedEdgeId: undefined }
            : undefined;
          if (frame.keepRecords) { frame.story.blockIds.push(block.blockId); frame.story.occurrences.push(occurrence); }
          const before = new Map(frame.environment); frames.push({ ...frame, tag: "block-finish", block, before, transitions: [], occurrence, operationIndex: 0 }); continue;
        }
        if (frame.tag === "block-finish") {
          const operation = frame.block.operations?.[frame.operationIndex];
          if (operation) {
            if (operation.kind === "unsupported" || operation.kind === "effect") { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; }
            if (operation.kind === "delete") {
              const previous = frame.environment.get(operation.target.bindingId) || unknown("scenario-reason-value-unassigned");
              if (operation.target.kind !== "member") { frame.environment.set(operation.target.bindingId, createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-deleted"), previous.origins)); }
              else { const path = resolveFunctionLogicScenarioTutorMemberPath(operation.target, frame.environment); const member = path ? applyFunctionLogicScenarioTutorMemberChange(previous, path, "delete") : { root: createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-object-key"), previous.origins) }; frame.environment.set(operation.target.bindingId, member.root); frame.transitions.push({ blockId: frame.block.blockId, kind: member.root.kind === "known" ? "calculation" : "unknown", targetBindingId: operation.target.bindingId, targetName: operation.target.bindingId, valueRef: path ? { rootBindingId: operation.target.bindingId, path, segments: path.map((key) => ({ kind: "static", key })) } : undefined, operator: "delete", expression: "", before: member.before || previous, after: member.after || member.root, dependencyBindingIds: member.root.origins || [], certainty: "exact" }); }
              frame.operationIndex += 1; frames.push(frame); continue;
            }
            if (operation.kind === "increment") {
              const previous = frame.environment.get(operation.target.bindingId) || unknown("scenario-reason-value-unassigned");
              if (operation.target.kind === "member") {
                const path = resolveFunctionLogicScenarioTutorMemberPath(operation.target, frame.environment);
                const member = path ? applyFunctionLogicScenarioTutorMemberChange(previous, path, operation.delta === 1 ? "increment" : "decrement", createFunctionLogicScenarioKnown(1, [])) : { root: createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-object-key"), previous.origins) };
                frame.environment.set(operation.target.bindingId, member.root);
                frame.transitions.push({ blockId: frame.block.blockId, kind: member.root.kind === "known" ? "calculation" : "unknown", targetBindingId: operation.target.bindingId, targetName: operation.target.bindingId, valueRef: path ? { rootBindingId: operation.target.bindingId, path, segments: path.map((key) => ({ kind: "static", key })) } : undefined, operator: operation.delta === 1 ? "++" : "--", expression: "", before: member.before || previous, after: member.after || member.root, dependencyBindingIds: member.root.origins || [], certainty: "exact" });
              } else {
                const next = applyFunctionLogicScenarioBinary(operation.delta === 1 ? "+" : "-", previous, createFunctionLogicScenarioKnown(1, []));
                frame.environment.set(operation.target.bindingId, next);
                frame.transitions.push({ blockId: frame.block.blockId, kind: next.kind === "known" ? "calculation" : "unknown", targetBindingId: operation.target.bindingId, targetName: operation.target.bindingId, operator: operation.delta === 1 ? "++" : "--", expression: "", before: previous, after: next, dependencyBindingIds: next.origins || [], certainty: "exact" });
              }
              frame.operationIndex += 1; frames.push(frame); continue;
            }
            const valueId = allocate(); frames.push({ tag: "operation-resume", frame, operation, valueId }); frames.push({ tag: "expression-enter", expression: operation.value, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: valueId }); continue;
          }
          if (frame.keepRecords) {
            recordsByBlockId.set(frame.block.blockId, { before: frame.before, after: new Map(frame.environment), transitions: frame.transitions });
            // Record completed root-block operations only after the block has
            // resumed from every expression/call frame; child transitions stay private.
            frame.story.transitions.push(...frame.transitions);
            frame.occurrence?.transitions.push(...frame.transitions);
          }
          if (frame.block.continuationSupplyId) { const continuation = frame.continuationById.get(frame.block.continuationSupplyId); if (!continuation) { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; } const valueId = allocate(); frames.push({ tag: "continuation-supply-resume", frame, continuationId: frame.block.continuationSupplyId, valueId }); frames.push({ tag: "expression-enter", expression: continuation.supply, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: valueId }); continue; }
          if (frame.block.terminal?.kind === "return") { if (frame.keepRecords) frame.story.terminal = { kind: "return" }; if (frame.block.terminal.continuationId) { const value = frame.continuationValues.get(frame.block.terminal.continuationId); results.set(frame.resultId, value || unknown("scenario-reason-call-unsupported")); } else if (!frame.block.terminal.value) results.set(frame.resultId, createFunctionLogicScenarioKnown(undefined, [])); else frames.push({ tag: "expression-enter", expression: frame.block.terminal.value, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: frame.resultId }); continue; }
          const next = frame.outgoing.get(frame.block.blockId) || [];
          if (frame.block.decision) {
            if (frame.block.decision.continuationId) { const continuation = frame.continuationById.get(frame.block.decision.continuationId); if (!continuation) { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; } const selectId = allocate(); frames.push({ tag: "continuation-select-resume", frame, continuation, selectId, edges: next }); frames.push({ tag: "expression-enter", expression: continuation.select, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: selectId }); continue; }
            const decisionId = allocate();
            frames.push({ tag: "decision-resume", frame, edges: next, decisionId });
            frames.push({ tag: "expression-enter", expression: frame.block.decision.expression, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: decisionId });
            continue;
          }
          if (next.length !== 1) { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; }
          if (frame.keepRecords) { frame.story.edgeIds.push(next[0].edgeId); if (frame.occurrence) frame.occurrence.selectedEdgeId = next[0].edgeId; }
          frames.push({ ...frame, tag: "block-step", blockId: next[0].targetBlockId }); continue;
        }
        if (frame.tag === "continuation-select-resume") { const value = results.get(frame.selectId); frame.frame.continuationValues.set(frame.continuation.id, value || unknown("scenario-reason-call-unsupported")); const known = value?.kind === "known"; const matched = known && (frame.continuation.predicate === "non-nullish" ? value.value !== null && value.value !== undefined : Boolean(value.value)); const outcome = frame.frame.block.decision.outcomes?.find((candidate) => candidate.matches === (matched ? "true" : "false")); const edge = outcome && frame.edges.find((candidate) => candidate.edgeId === outcome.edgeId); if (!edge) { results.set(frame.frame.resultId, unknown("scenario-reason-call-unsupported")); continue; } if (frame.frame.keepRecords) { frame.frame.story.edgeIds.push(edge.edgeId); if (frame.frame.occurrence) frame.frame.occurrence.selectedEdgeId = edge.edgeId; } frames.push({ ...frame.frame, tag: "block-step", blockId: edge.targetBlockId }); continue; }
        if (frame.tag === "continuation-supply-resume") { frame.frame.continuationValues.set(frame.continuationId, results.get(frame.valueId) || unknown("scenario-reason-call-unsupported")); frame.frame.block = { ...frame.frame.block, continuationSupplyId: undefined }; frames.push(frame.frame); continue; }
        if (frame.tag === "operation-resume") { const assignmentTarget = frame.operation.kind === "assign" ? frame.operation.target : undefined; const target = frame.operation.kind === "define" ? frame.operation.bindingId : frame.operation.target.bindingId; const value = results.get(frame.valueId) || unknown("scenario-reason-call-unsupported"); let transitionBefore = frame.frame.before.get(target); let transitionAfter = value; let valueRef; if (assignmentTarget?.kind === "member") { const receiver = frame.frame.environment.get(target) || unknown("scenario-reason-value-unassigned"); const operator = { set: "set", add: "+", subtract: "-", multiply: "*", divide: "/" }[frame.operation.operator]; const path = resolveFunctionLogicScenarioTutorMemberPath(assignmentTarget, frame.frame.environment); const member = path ? applyFunctionLogicScenarioTutorMemberChange(receiver, path, operator || "set", value) : { root: createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-object-key"), receiver.origins) }; frame.frame.environment.set(target, member.root); transitionBefore = member.before || receiver; transitionAfter = member.after || member.root; valueRef = path ? { rootBindingId: target, path, segments: path.map((key) => ({ kind: "static", key })) } : undefined; } else frame.frame.environment.set(target, value); const transition = { blockId: frame.frame.block.blockId, kind: transitionAfter.kind === "known" ? "calculation" : "unknown", targetBindingId: target, targetName: target, ...(valueRef ? { valueRef } : {}), operator: frame.operation.kind, expression: "", before: transitionBefore, after: transitionAfter, dependencyBindingIds: transitionAfter.origins || [], certainty: "exact" }; frame.frame.transitions.push(transition); frame.frame.operationIndex += 1; frames.push(frame.frame); continue; }
        if (frame.tag === "decision-resume") {
          const value = results.get(frame.decisionId);
          const outcomeMatch = value?.kind === "known" && typeof value.value === "boolean"
            ? (value.value ? "true" : "false") : undefined;
          const outcome = outcomeMatch
            ? frame.frame.block.decision.outcomes?.find((candidate) => candidate.matches === outcomeMatch)
            : undefined;
          const edge = outcome ? frame.edges.find((candidate) => candidate.edgeId === outcome.edgeId) : undefined;
          if (!edge) { results.set(frame.frame.resultId, unknown("scenario-reason-call-unsupported")); continue; }
          if (frame.frame.keepRecords) { frame.frame.story.edgeIds.push(edge.edgeId); if (frame.frame.occurrence) frame.frame.occurrence.selectedEdgeId = edge.edgeId; }
          frames.push({ ...frame.frame, tag: "block-step", blockId: edge.targetBlockId }); continue;
        }
        if (++expressionItems > 600) { results.set(frame.resultId, unknown("scenario-reason-program-budget")); continue; }
        if (frame.tag === "expression-enter") {
          const expression = frame.expression; if (!expression || expression.kind === "unsupported") { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; }
          if (expression.kind === "literal") { results.set(frame.resultId, literal(expression.value)); continue; }
          if (expression.kind === "binding") { results.set(frame.resultId, frame.environment.get(expression.bindingId) || createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-value-unassigned"), [expression.bindingId])); continue; }
          if (expression.kind === "await") { frames.push({ tag: "await-resume", resultId: frame.resultId, awaitedId: allocate() }); frames.push({ tag: "expression-enter", expression: expression.operand, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: frames[frames.length - 1].awaitedId, allowAsync: true }); continue; }
          if (expression.kind === "object") { const object = Object.create(null); const ids = expression.entries.map(() => allocate()); frames.push({ tag: "object-resume", expression, ids, resultId: frame.resultId }); for (let index = expression.entries.length - 1; index >= 0; index -= 1) frames.push({ tag: "expression-enter", expression: expression.entries[index].value, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: ids[index] }); continue; }
          if (expression.kind === "member") { const objectId = allocate(); frames.push({ tag: "member-resume", expression, objectId, resultId: frame.resultId }); frames.push({ tag: "expression-enter", expression: expression.object, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: objectId }); continue; }
          if (expression.kind === "conditional") { const conditionId = allocate(); frames.push({ tag: "conditional-condition-resume", expression, conditionId, resultId: frame.resultId, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry }); frames.push({ tag: "expression-enter", expression: expression.condition, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: conditionId }); continue; }
          if (expression.kind === "logical") { const leftId = allocate(); frames.push({ tag: "logical-left-resume", expression, leftId, resultId: frame.resultId, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry }); frames.push({ tag: "expression-enter", expression: expression.members[0], environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: leftId }); continue; }
          if (expression.kind === "binary") { const leftId = allocate(), rightId = allocate(); frames.push({ tag: "binary-resume", expression, leftId, rightId, resultId: frame.resultId }); frames.push({ tag: "expression-enter", expression: expression.right, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: rightId }); frames.push({ tag: "expression-enter", expression: expression.left, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: leftId }); continue; }
          if (expression.kind === "construct") { const link = linksByCallId.get(expression.callId); const callee = link && programs.get(link.calleeProgramId); if (!callee || callee.invocationRole !== "constructor") { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; } const argumentIds = expression.arguments.map(allocate); frames.push({ tag: "call-enter", callee, argumentIds, caller: frame, allowAsync: false, construct: true }); for (let index = expression.arguments.length - 1; index >= 0; index -= 1) frames.push({ tag: "expression-enter", expression: expression.arguments[index], environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: argumentIds[index] }); continue; }
          if (expression.kind === "direct-call") { if (expression.invocationKind === "iterator-next") { if (expression.arguments.length || !expression.receiver) { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; } const receiverId = allocate(); frames.push({ tag: "iterator-next-resume", resultId: frame.resultId, receiverId }); frames.push({ tag: "expression-enter", expression: expression.receiver, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: receiverId }); continue; } if ((expression.invocationKind === "optional-direct" || expression.invocationKind === "optional-method") && expression.optionalDisposition === "absent") { results.set(frame.resultId, createFunctionLogicScenarioKnown(undefined, [])); continue; } if ((expression.invocationKind === "optional-direct" || expression.invocationKind === "optional-method") && expression.optionalDisposition === "unknown") { results.set(frame.resultId, unknown("scenario-reason-optional-unknown")); continue; } const omitted = omittedByCallId.get(expression.callId); const link = linksByCallId.get(expression.callId); const callee = link && programs.get(link.calleeProgramId); if (omitted) { results.set(frame.resultId, unknown(reasonForOmission(omitted.reason))); continue; } if (!callee) { results.set(frame.resultId, unknown(expression.invocationKind === "method" ? "scenario-reason-receiver-unknown" : "scenario-reason-call-unresolved")); continue; } const argumentIds = expression.arguments.map(allocate); const receiverId = expression.receiver ? allocate() : undefined; frames.push({ tag: "call-enter", callee, argumentIds, receiverId, expression, caller: frame, allowAsync: Boolean(frame.allowAsync) }); for (let index = expression.arguments.length - 1; index >= 0; index -= 1) frames.push({ tag: "expression-enter", expression: expression.arguments[index], environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: argumentIds[index] }); if (receiverId) frames.push({ tag: "expression-enter", expression: expression.receiver, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: receiverId }); continue; }
          results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue;
        }
        if (frame.tag === "conditional-condition-resume") { const condition = results.get(frame.conditionId); const branch = condition?.kind === "known" && typeof condition.value === "boolean" ? (condition.value ? frame.expression.whenTrue : frame.expression.whenFalse) : undefined; if (!branch) { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; } frames.push({ tag: "expression-enter", expression: branch, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: frame.resultId }); continue; }
        if (frame.tag === "logical-left-resume") { const left = results.get(frame.leftId); if (!left || left.kind !== "known") { results.set(frame.resultId, left || unknown("scenario-reason-call-unsupported")); continue; } const shortCircuit = frame.expression.operator === "and" ? !left.value : frame.expression.operator === "or" ? Boolean(left.value) : left.value !== null && left.value !== undefined; if (shortCircuit) { results.set(frame.resultId, left); continue; } const right = frame.expression.members[1]; if (!right) { results.set(frame.resultId, left); continue; } frames.push({ tag: "expression-enter", expression: right, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: frame.resultId }); continue; }
        if (frame.tag === "await-resume") { results.set(frame.resultId, results.get(frame.awaitedId) || unknown("scenario-reason-await-required")); continue; }
        if (frame.tag === "object-resume") { const value = Object.create(null); for (let index = 0; index < frame.expression.entries.length; index += 1) { const item = results.get(frame.ids[index]); if (!item || item.kind !== "known") { results.set(frame.resultId, item || unknown("scenario-reason-call-unsupported")); continue; } value[frame.expression.entries[index].key] = item.value; } results.set(frame.resultId, createFunctionLogicScenarioKnown(value, [])); continue; }
        if (frame.tag === "member-resume") { const value = results.get(frame.objectId); let current = value?.kind === "known" ? value.value : undefined; for (const key of frame.expression.path || []) { if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, key)) { current = undefined; break; } current = current[key]; } results.set(frame.resultId, current === undefined && !frame.expression.optional ? unknown("scenario-reason-receiver-unknown") : createFunctionLogicScenarioKnown(current, [])); continue; }
        if (frame.tag === "iterator-next-resume") { const state = results.get(frame.receiverId); const iterator = state?.kind === "known" ? state.value : undefined; if (!iterator || iterator.__functionTutorIterator !== true) { results.set(frame.resultId, unknown("scenario-reason-receiver-unknown")); continue; } if (iterator.done || iterator.index >= 24) { iterator.done = true; results.set(frame.resultId, createFunctionLogicScenarioKnown(Object.assign(Object.create(null), { value: undefined, done: true }), [])); continue; } if (iterator.index >= iterator.values.length) { iterator.done = true; const value = iterator.returned ? createFunctionLogicScenarioKnown(undefined, []) : (iterator.returned = true, iterator.returnValue || createFunctionLogicScenarioKnown(undefined, [])); if (value.kind !== "known") { results.set(frame.resultId, value); continue; } results.set(frame.resultId, createFunctionLogicScenarioKnown(Object.assign(Object.create(null), { value: value.value, done: true }), [])); continue; } const value = iterator.values[iterator.index++]; if (!value || value.kind !== "known") { results.set(frame.resultId, value || unknown("scenario-reason-call-unsupported")); continue; } results.set(frame.resultId, createFunctionLogicScenarioKnown(Object.assign(Object.create(null), { value: value.value, done: false }), [])); continue; }
        if (frame.tag === "binary-resume") { const operator = { eq: "==", neq: "!=", "strict-eq": "===", "strict-neq": "!==", lt: "<", lte: "<=", gt: ">", gte: ">=", add: "+", subtract: "-", multiply: "*", divide: "/", modulo: "%", in: "in" }[frame.expression.operator] || frame.expression.operator; results.set(frame.resultId, applyFunctionLogicScenarioBinary(operator, results.get(frame.leftId), results.get(frame.rightId))); continue; }
        if (frame.tag === "call-enter") { const environment = new Map(); const parameters = frame.callee.bindings.filter((binding) => binding.parameterId).sort((left, right) => (left.parameterIndex ?? Number.MAX_SAFE_INTEGER) - (right.parameterIndex ?? Number.MAX_SAFE_INTEGER)); for (let index = 0; index < parameters.length; index += 1) environment.set(parameters[index].bindingId, results.get(frame.argumentIds[index]) || unknown("scenario-reason-parameter-unset")); const receiver = frame.receiverId ? results.get(frame.receiverId) : undefined; if (frame.construct) { const instance = Object.assign(Object.create(null), { __functionTutorBrand: frame.callee.ownerId }); for (const field of frame.callee.fieldInitializers || []) { const value = field.value?.kind === "literal" ? literal(field.value.value) : unknown("scenario-reason-call-unsupported"); if (value.kind !== "known") { results.set(frame.caller.resultId, value); continue; } instance[field.key] = value.value; } if (frame.callee.thisBindingId) environment.set(frame.callee.thisBindingId, createFunctionLogicScenarioKnown(instance, [])); frames.push({ tag: "call-return", callerResultId: frame.caller.resultId, childResultId: allocate(), instance }); const resume = frames[frames.length - 1]; frames.push({ tag: "program-enter", program: frame.callee, environment, depth: frame.caller.depth + 1, ancestry: frame.caller.ancestry, keepRecords: false, resultId: resume.childResultId, allowAsync: false }); continue; } if (frame.callee.invocationRole === "method" && (!receiver || receiver.kind !== "known" || receiver.value?.__functionTutorBrand !== frame.callee.ownerId)) { results.set(frame.caller.resultId, unknown("scenario-reason-receiver-unknown")); continue; } if (frame.callee.thisBindingId && receiver) environment.set(frame.callee.thisBindingId, receiver); if (frame.callee.executionKind === "generator") { const resolveGeneratorValue = (expression) => expression?.kind === "literal" ? literal(expression.value) : expression?.kind === "binding" ? environment.get(expression.bindingId) : unknown("scenario-reason-call-unsupported"); const values = (frame.callee.generatorYields || []).map(resolveGeneratorValue); results.set(frame.caller.resultId, createFunctionLogicScenarioKnown(Object.assign(Object.create(null), { __functionTutorIterator: true, values, returnValue: resolveGeneratorValue(frame.callee.generatorReturn), index: 0, done: false, returned: false }), [])); continue; } frames.push({ tag: "call-return", callerResultId: frame.caller.resultId, childResultId: allocate() }); const resume = frames[frames.length - 1]; frames.push({ tag: "program-enter", program: frame.callee, environment, depth: frame.caller.depth + 1, ancestry: frame.caller.ancestry, keepRecords: false, resultId: resume.childResultId, allowAsync: frame.allowAsync }); continue; }
        if (frame.tag === "call-return") { results.set(frame.callerResultId, frame.instance ? createFunctionLogicScenarioKnown(frame.instance, []) : (results.get(frame.childResultId) || unknown("scenario-reason-call-unsupported"))); }
      }
      const rootResult = results.get("root");
      const terminal = rootStory.terminal?.kind === "return"
        ? { kind: "return", value: functionLogicScenarioTutorReturnValue(rootResult) }
        : rootStory.terminal || { kind: "exit" };
      return { recordsByBlockId, inputStateByBindingId: rootInput, truncated, processed: work, scenarioPaths: [{ ...rootStory, terminal, certainty: rootResult?.kind === "known" ? "exact" : "unknown" }] };
    }

    /**
     * Maps opaque root identities to the current visible graph exactly once.
     * Resolver failures and aliases are intentionally omitted so private IDs
     * cannot leak into Scenario inputs or be guessed from a suffix/name.
     */
    function createFunctionLogicScenarioVisibleIdentityMap(rawIds, visibleById, resolve) {
      const candidates = new Map();
      for (const rawId of rawIds || []) {
        const visibleId = resolve ? resolve(rawId) : (visibleById.has(rawId) ? rawId : undefined);
        if (!visibleId || !visibleById.has(visibleId)) continue;
        const rawForVisible = candidates.get(visibleId) || [];
        rawForVisible.push(rawId);
        candidates.set(visibleId, rawForVisible);
      }
      const mapped = new Map();
      for (const [visibleId, rawForVisible] of candidates) {
        if (rawForVisible.length === 1) mapped.set(rawForVisible[0], visibleId);
      }
      return mapped;
    }

    /** Converts a known machine value into the existing opaque Tutor display contract. */
    function functionLogicScenarioTutorReturnValue(state) {
      if (!state || state.kind !== "known") return { kind: "unknown", reason: "not-inferred" };
      if (state.value === null) return { kind: "null" };
      if (state.value === undefined) return { kind: "undefined" };
      if (typeof state.value === "boolean" || typeof state.value === "number" || typeof state.value === "string") return { kind: typeof state.value, value: state.value };
      return { kind: "unknown", reason: "unsupported-return-value" };
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
          const valueRef = change.targetKind === "property"
            ? resolveFunctionLogicScenarioPropertyValueRef(change, after, context)
            : undefined;
          transitions.push({
            kind: next.kind === "known" ? "calculation" : "unknown",
            targetBindingId: binding.id,
            targetName: change.targetKind === "property" ? change.target : binding.name,
            ...(valueRef ? { valueRef } : {}),
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
