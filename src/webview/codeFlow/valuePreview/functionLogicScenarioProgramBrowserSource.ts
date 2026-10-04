/** Iterative opaque Scenario program machine; preserves source execution order and value snapshots. */
import { getFunctionLogicScenarioProgramValuesBrowserSource } from "./functionLogicScenarioProgramValuesBrowserSource";

/** Supplies the private program machine through the existing evaluator composer. */
export function getFunctionLogicScenarioProgramBrowserSource(): string {
  return /* js */ `
    ${getFunctionLogicScenarioProgramValuesBrowserSource()}
    /**
     * Interprets the bounded Host-issued bundle using an explicit frame stack.
     * Missing programs and cyclic calls stop at their boundary; targets are
     * resolved only by Host-issued IDs, never by source name.
     */
    function calculateFunctionLogicScenarioProgramBundle(logic, nodeButtonsById, edgeElementsById, suppliedInputs, scenarioIdentity) {
      if (logic?.tutor?.program?.evaluationMode === "symbolic-only") return null;
      const bundle = logic.tutor.programBundle;
      const programs = new Map((bundle.programs || []).map((program) => [program.id, program]));
      const root = programs.get(bundle.rootProgramId);
      if (!root) return null;
      if (root.evaluationMode === "symbolic-only") return null;
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
      const literal = functionLogicScenarioProgramLiteral;
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
      // Live expression results also hold references: later argument/RHS writes
      // update those references, while recorded snapshots keep their old objects.
      const environments = new Set([results]); let uncertain = false;
      const markUncertain = () => { uncertain = true; invalidateFunctionLogicScenarioProgramState(environments); };
      // A record owns an immutable occurrence, including changes through aliases
      // or calls. Layout order and later loop visits cannot overwrite its values.
      const recordFrame = (frame) => {
        if (!frame.keepRecords) return;
        for (const [id, after] of frame.environment) {
          const before = frame.before.get(id);
          if (!before || before === after || before.kind === after.kind && before.value === after.value
            || frame.transitions.some((item) => item.targetBindingId === id)) continue;
          frame.transitions.push({ blockId: frame.block.blockId, kind: after.kind === "known" ? "calculation" : "unknown",
            targetBindingId: id, targetName: frame.program.bindings.find((binding) => binding.bindingId === id)?.name || id,
            sourceLabel: frame.block.label, operator: "=", expression: "", before, after,
            dependencyBindingIds: after.origins || [], certainty: after.kind === "known" ? "exact" : "unknown" });
        }
        const record = { before: frame.before, after: new Map(frame.environment), transitions: frame.transitions };
        recordsByBlockId.set(frame.block.blockId, record);
        frame.story.transitions.push(...frame.transitions);
        if (frame.occurrence) Object.assign(frame.occurrence, record);
      };
      while (frames.length) {
        if (++work > MAX_LOGIC_SCENARIO_WORK_ITEMS) { truncated = true; results.set("root", unknown("scenario-reason-program-budget")); break; }
        const frame = frames.pop();
        if (frame.tag === "program-enter") {
          if (!frame.program || (frame.program.executionKind !== "sync" && !(frame.program.executionKind === "async" && frame.allowAsync))) { results.set(frame.resultId, unknown(frame.program?.executionKind === "async" ? "scenario-reason-await-required" : "scenario-reason-call-unsupported")); continue; }
          if (frame.depth > 4) { results.set(frame.resultId, unknown("scenario-reason-call-depth")); continue; }
          if (frame.ancestry.has(frame.program.id)) { results.set(frame.resultId, unknown("scenario-reason-call-cycle")); continue; }
          if (environments.size >= 65) { truncated = true; markUncertain(); results.set(frame.resultId, unknown("scenario-reason-program-budget")); continue; }
          environments.add(frame.environment);
          const blockById = new Map(frame.program.blocks.map((block) => [block.blockId, block])); const outgoing = new Map();
          for (const edge of frame.program.edges || []) if (edge.kind !== "defines" && edge.kind !== "deferred") { const edges = outgoing.get(edge.sourceBlockId) || []; edges.push(edge); outgoing.set(edge.sourceBlockId, edges); }
          const ancestry = new Set(frame.ancestry); ancestry.add(frame.program.id);
          frames.push({ tag: "block-step", program: frame.program, environment: frame.environment, depth: frame.depth, ancestry, keepRecords: frame.keepRecords, resultId: frame.resultId, story: frame.story, blockById, outgoing, blockId: frame.program.entryBlockId, visits: new Map(), continuationValues: new Map(), continuationById: new Map((frame.program.continuations || []).map((item) => [item.id, item])) });
          continue;
        }
        if (frame.tag === "block-step") {
          const block = frame.blockById.get(frame.blockId); const seen = (frame.visits.get(frame.blockId) || 0) + 1; frame.visits.set(frame.blockId, seen);
          if (!block || seen > 3) { if (seen > 3) truncated = true; results.set(frame.resultId, unknown("scenario-reason-program-budget")); continue; }
          const occurrence = frame.keepRecords
            ? { blockId: block.blockId, transitions: [], selectedEdgeId: undefined }
            : undefined;
          if (frame.keepRecords) { frame.story.blockIds.push(block.blockId); frame.story.occurrences.push(occurrence); }
          const before = new Map(frame.environment); frames.push({ ...frame, tag: "block-finish", block, before, transitions: [], occurrence, operationIndex: 0 }); continue;
        }
        if (frame.tag === "block-finish") {
          const operation = frame.block.operations?.[frame.operationIndex];
          if (operation) {
            if (operation.kind === "unsupported" || operation.kind === "effect") {
              markUncertain(); recordFrame(frame); results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue;
            }
            const saved = readFunctionLogicScenarioProgramTarget(frame, operation);
            if (operation.kind === "increment" || operation.kind === "delete") {
              applyFunctionLogicScenarioProgramOperation(frame, operation, createFunctionLogicScenarioKnown(1, []), saved, environments);
              if (frame.uncertain) markUncertain();
              frame.operationIndex += 1; frames.push(frame); continue;
            }
            const valueId = allocate();
            frames.push({ tag: "operation-resume", frame, operation, valueId, saved });
            frames.push({ tag: "expression-enter", expression: operation.value, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: valueId }); continue;
          }
          if (["try", "catch", "finally"].includes(frame.block.kind)) { markUncertain(); recordFrame(frame); results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; }
          if (frame.block.terminal?.kind === "throw") { recordFrame(frame); if (frame.keepRecords) frame.story.terminal = { kind: "throw" }; results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; }
          if (frame.block.kind === "exit" || frame.block.terminal?.kind === "exit") { recordFrame(frame); results.set(frame.resultId, createFunctionLogicScenarioKnown(undefined, [])); continue; }
          if (frame.block.continuationSupplyId) { const continuation = frame.continuationById.get(frame.block.continuationSupplyId); if (!continuation) { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; } const valueId = allocate(); frames.push({ tag: "continuation-supply-resume", frame, continuationId: frame.block.continuationSupplyId, valueId }); frames.push({ tag: "expression-enter", expression: continuation.supply, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: valueId }); continue; }
          if (frame.block.terminal?.kind === "return") {
            if (frame.keepRecords) frame.story.terminal = { kind: "return" };
            if (frame.block.terminal.continuationId) {
              results.set(frame.resultId, frame.continuationValues.get(frame.block.terminal.continuationId) || unknown("scenario-reason-call-unsupported")); recordFrame(frame);
            } else if (!frame.block.terminal.value) { results.set(frame.resultId, createFunctionLogicScenarioKnown(undefined, [])); recordFrame(frame); }
            else {
              frames.push({ tag: "return-resume", frame });
              frames.push({ tag: "expression-enter", expression: frame.block.terminal.value, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: frame.resultId });
            }
            continue;
          }
          const next = frame.outgoing.get(frame.block.blockId) || [];
          if (frame.block.decision) {
            if (frame.block.decision.continuationId) { const continuation = frame.continuationById.get(frame.block.decision.continuationId); if (!continuation) { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; } const selectId = allocate(); frames.push({ tag: "continuation-select-resume", frame, continuation, selectId, edges: next }); frames.push({ tag: "expression-enter", expression: continuation.select, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: selectId }); continue; }
            const decisionId = allocate();
            frames.push({ tag: "decision-resume", frame, edges: next, decisionId });
            frames.push({ tag: "expression-enter", expression: frame.block.decision.expression, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: decisionId });
            continue;
          }
          recordFrame(frame);
          if (next.length !== 1) { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; }
          if (frame.keepRecords) { frame.story.edgeIds.push(next[0].edgeId); if (frame.occurrence) frame.occurrence.selectedEdgeId = next[0].edgeId; }
          frames.push({ ...frame, tag: "block-step", blockId: next[0].targetBlockId }); continue;
        }
        if (frame.tag === "continuation-select-resume") { recordFrame(frame.frame); const value = results.get(frame.selectId); frame.frame.continuationValues.set(frame.continuation.id, value || unknown("scenario-reason-call-unsupported")); const known = value?.kind === "known"; if (!known) { results.set(frame.frame.resultId, value || unknown("scenario-reason-call-unsupported")); continue; } const matched = known && (frame.continuation.predicate === "non-nullish" ? value.value !== null && value.value !== undefined : Boolean(value.value)); const outcome = frame.frame.block.decision.outcomes?.find((candidate) => candidate.matches === (matched ? "true" : "false")); const edge = outcome && frame.edges.find((candidate) => candidate.edgeId === outcome.edgeId); if (!edge) { results.set(frame.frame.resultId, unknown("scenario-reason-call-unsupported")); continue; } if (frame.frame.keepRecords) { frame.frame.story.edgeIds.push(edge.edgeId); if (frame.frame.occurrence) frame.frame.occurrence.selectedEdgeId = edge.edgeId; } frames.push({ ...frame.frame, tag: "block-step", blockId: edge.targetBlockId }); continue; }
        if (frame.tag === "continuation-supply-resume") { frame.frame.continuationValues.set(frame.continuationId, results.get(frame.valueId) || unknown("scenario-reason-call-unsupported")); frame.frame.block = { ...frame.frame.block, continuationSupplyId: undefined }; frames.push(frame.frame); continue; }
        if (frame.tag === "operation-resume") {
          const value = results.get(frame.valueId) || unknown("scenario-reason-call-unsupported");
          applyFunctionLogicScenarioProgramOperation(frame.frame, frame.operation, value, frame.saved, environments);
          if (frame.frame.uncertain) markUncertain();
          frame.frame.operationIndex += 1; frames.push(frame.frame); continue;
        }
        if (frame.tag === "decision-resume") {
          recordFrame(frame.frame);
          const value = results.get(frame.decisionId);
          const outcomeMatch = value?.kind === "known"
            ? (value.value ? "true" : "false") : undefined;
          const outcome = outcomeMatch
            ? frame.frame.block.decision.outcomes?.find((candidate) => candidate.matches === outcomeMatch || outcomeMatch === "false" && candidate.matches === "loop-exit")
            : undefined;
          const edge = outcome ? frame.edges.find((candidate) => candidate.edgeId === outcome.edgeId) : undefined;
          if (!edge) { results.set(frame.frame.resultId, unknown("scenario-reason-call-unsupported")); continue; }
          if (frame.frame.keepRecords) { frame.frame.story.edgeIds.push(edge.edgeId); if (frame.frame.occurrence) frame.frame.occurrence.selectedEdgeId = edge.edgeId; }
          frames.push({ ...frame.frame, tag: "block-step", blockId: edge.targetBlockId }); continue;
        }
        if (frame.tag === "return-resume") { recordFrame(frame.frame); continue; }
        if (++expressionItems > 600) { truncated = true; markUncertain(); results.set("root", unknown("scenario-reason-program-budget")); break; }
        if (frame.tag === "expression-enter") {
          const expression = frame.expression; if (!expression || expression.kind === "unsupported") { markUncertain(); results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; }
          if (expression.kind === "literal") { results.set(frame.resultId, literal(expression.value)); continue; }
          if (expression.kind === "binding") { results.set(frame.resultId, addFunctionLogicScenarioOrigins(frame.environment.get(expression.bindingId), [expression.bindingId])); continue; }
          if (expression.kind === "await") { frames.push({ tag: "await-resume", resultId: frame.resultId, awaitedId: allocate() }); frames.push({ tag: "expression-enter", expression: expression.operand, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: frames[frames.length - 1].awaitedId, allowAsync: true }); continue; }
          if (expression.kind === "unary") { const operandId = allocate(); frames.push({ tag: "unary-resume", expression, operandId, resultId: frame.resultId }); frames.push({ ...frame, expression: expression.operand, resultId: operandId }); continue; }
          if (expression.kind === "object" || expression.kind === "array") {
            const items = expression.kind === "array" ? expression.items : expression.entries.map((entry) => entry.value);
            if (items.length > 64 || expression.kind === "object" && expression.entries.some((entry) => FUNCTION_LOGIC_SCENARIO_BLOCKED_KEYS.has(entry.key))) { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; }
            const ids = items.map(() => allocate()); frames.push({ tag: "composite-resume", expression, ids, resultId: frame.resultId });
            for (let index = items.length - 1; index >= 0; index -= 1) frames.push({ ...frame, expression: items[index], resultId: ids[index] }); continue;
          }
          if (expression.kind === "member") { const objectId = allocate(); frames.push({ tag: "member-resume", expression, objectId, resultId: frame.resultId }); frames.push({ tag: "expression-enter", expression: expression.object, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: objectId }); continue; }
          if (expression.kind === "conditional") { const conditionId = allocate(); frames.push({ tag: "conditional-condition-resume", expression, conditionId, resultId: frame.resultId, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry }); frames.push({ tag: "expression-enter", expression: expression.condition, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: conditionId }); continue; }
          if (expression.kind === "logical") { const leftId = allocate(); frames.push({ tag: "logical-left-resume", expression, leftId, resultId: frame.resultId, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry }); frames.push({ tag: "expression-enter", expression: expression.members[0], environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: leftId }); continue; }
          if (expression.kind === "binary") { const leftId = allocate(), rightId = allocate(); frames.push({ tag: "binary-resume", expression, leftId, rightId, resultId: frame.resultId }); frames.push({ tag: "expression-enter", expression: expression.right, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: rightId }); frames.push({ tag: "expression-enter", expression: expression.left, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: leftId }); continue; }
          if (expression.kind === "construct") { const link = linksByCallId.get(expression.callId); const callee = link && programs.get(link.calleeProgramId); if (!callee || callee.invocationRole !== "constructor") { markUncertain(); results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; } const argumentIds = expression.arguments.map(allocate); frames.push({ tag: "call-enter", callee, argumentIds, caller: frame, allowAsync: false, construct: true }); for (let index = expression.arguments.length - 1; index >= 0; index -= 1) frames.push({ tag: "expression-enter", expression: expression.arguments[index], environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: argumentIds[index] }); continue; }
          if (expression.kind === "direct-call") { if (expression.invocationKind === "iterator-next") { if (expression.arguments.length || !expression.receiver) { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; } const receiverId = allocate(); frames.push({ tag: "iterator-next-resume", resultId: frame.resultId, receiverId }); frames.push({ tag: "expression-enter", expression: expression.receiver, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: receiverId }); continue; } if ((expression.invocationKind === "optional-direct" || expression.invocationKind === "optional-method") && expression.optionalDisposition === "absent") { results.set(frame.resultId, createFunctionLogicScenarioKnown(undefined, [])); continue; } if ((expression.invocationKind === "optional-direct" || expression.invocationKind === "optional-method") && expression.optionalDisposition === "unknown") { markUncertain(); results.set(frame.resultId, unknown("scenario-reason-optional-unknown")); continue; } const omitted = omittedByCallId.get(expression.callId); const link = linksByCallId.get(expression.callId); const callee = link && programs.get(link.calleeProgramId); if (omitted) { markUncertain(); results.set(frame.resultId, unknown(reasonForOmission(omitted.reason))); continue; } if (!callee) { markUncertain(); results.set(frame.resultId, unknown(expression.invocationKind === "method" ? "scenario-reason-receiver-unknown" : "scenario-reason-call-unresolved")); continue; } const argumentIds = expression.arguments.map(allocate); const receiverId = expression.receiver ? allocate() : undefined; frames.push({ tag: "call-enter", callee, argumentIds, receiverId, expression, caller: frame, allowAsync: Boolean(frame.allowAsync) }); for (let index = expression.arguments.length - 1; index >= 0; index -= 1) frames.push({ tag: "expression-enter", expression: expression.arguments[index], environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: argumentIds[index] }); if (receiverId) frames.push({ tag: "expression-enter", expression: expression.receiver, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: receiverId }); continue; }
          results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue;
        }
        if (frame.tag === "conditional-condition-resume") { const condition = results.get(frame.conditionId); const branch = condition?.kind === "known" ? (condition.value ? frame.expression.whenTrue : frame.expression.whenFalse) : undefined; if (!branch) { results.set(frame.resultId, unknown("scenario-reason-call-unsupported")); continue; } frames.push({ tag: "expression-enter", expression: branch, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: frame.resultId }); continue; }
        if (frame.tag === "logical-left-resume") { const left = results.get(frame.leftId); if (!left || left.kind !== "known") { results.set(frame.resultId, left || unknown("scenario-reason-call-unsupported")); continue; } const shortCircuit = frame.expression.operator === "and" ? !left.value : frame.expression.operator === "or" ? Boolean(left.value) : left.value !== null && left.value !== undefined; if (shortCircuit) { results.set(frame.resultId, left); continue; } const right = frame.expression.members[1]; if (!right) { results.set(frame.resultId, left); continue; } frames.push({ tag: "expression-enter", expression: right, environment: frame.environment, depth: frame.depth, ancestry: frame.ancestry, resultId: frame.resultId }); continue; }
        if (frame.tag === "await-resume") { results.set(frame.resultId, results.get(frame.awaitedId) || unknown("scenario-reason-await-required")); continue; }
        if (frame.tag === "unary-resume") {
          const operand = results.get(frame.operandId); let value = operand || unknown("scenario-reason-call-unsupported");
          if (operand?.kind === "known") {
            if (frame.expression.operator === "typeof") value = createFunctionLogicScenarioKnown(typeof operand.value, operand.origins);
            else if (frame.expression.operator === "non-nullish") value = createFunctionLogicScenarioKnown(operand.value !== null && operand.value !== undefined, operand.origins);
            else value = applyFunctionLogicScenarioUnary({ not: "u!", plus: "u+", minus: "u-" }[frame.expression.operator], operand);
          }
          results.set(frame.resultId, value); continue;
        }
        if (frame.tag === "composite-resume") {
          const items = frame.ids.map((id) => results.get(id)); const missing = items.find((item) => !item || item.kind !== "known");
          if (items.some((item) => !item || item.kind !== "known")) { results.set(frame.resultId, missing || unknown("scenario-reason-call-unsupported")); continue; }
          const value = frame.expression.kind === "array" ? items.map((item) => item.value)
            : Object.assign(Object.create(null), Object.fromEntries(frame.expression.entries.map((entry, index) => [entry.key, items[index].value])));
          results.set(frame.resultId, createFunctionLogicScenarioKnown(value, items.flatMap((item) => item.origins || []))); continue;
        }
        if (frame.tag === "member-resume") { results.set(frame.resultId, readFunctionLogicScenarioProgramMember(results.get(frame.objectId), frame.expression.path, frame.expression.optional)); continue; }
        if (frame.tag === "iterator-next-resume") { const state = results.get(frame.receiverId); const iterator = state?.kind === "known" ? state.value : undefined; if (!iterator || iterator.__functionTutorIterator !== true) { results.set(frame.resultId, unknown("scenario-reason-receiver-unknown")); continue; } if (iterator.done || iterator.index >= 24) { iterator.done = true; results.set(frame.resultId, createFunctionLogicScenarioKnown(Object.assign(Object.create(null), { value: undefined, done: true }), [])); continue; } if (iterator.index >= iterator.values.length) { iterator.done = true; const value = iterator.returned ? createFunctionLogicScenarioKnown(undefined, []) : (iterator.returned = true, iterator.returnValue || createFunctionLogicScenarioKnown(undefined, [])); if (value.kind !== "known") { results.set(frame.resultId, value); continue; } results.set(frame.resultId, createFunctionLogicScenarioKnown(Object.assign(Object.create(null), { value: value.value, done: true }), [])); continue; } const value = iterator.values[iterator.index++]; if (!value || value.kind !== "known") { results.set(frame.resultId, value || unknown("scenario-reason-call-unsupported")); continue; } results.set(frame.resultId, createFunctionLogicScenarioKnown(Object.assign(Object.create(null), { value: value.value, done: false }), [])); continue; }
        if (frame.tag === "binary-resume") { const operator = { eq: "==", neq: "!=", "strict-eq": "===", "strict-neq": "!==", lt: "<", lte: "<=", gt: ">", gte: ">=", add: "+", subtract: "-", multiply: "*", divide: "/", modulo: "%", in: "in" }[frame.expression.operator] || frame.expression.operator; results.set(frame.resultId, applyFunctionLogicScenarioBinary(operator, results.get(frame.leftId), results.get(frame.rightId))); continue; }
        if (frame.tag === "call-enter") {
          const environment = new Map();
          const parameters = frame.callee.bindings.filter((binding) => binding.parameterId)
            .sort((left, right) => (left.parameterIndex ?? Number.MAX_SAFE_INTEGER) - (right.parameterIndex ?? Number.MAX_SAFE_INTEGER));
          for (let index = 0; index < parameters.length; index += 1) environment.set(parameters[index].bindingId, results.get(frame.argumentIds[index]) || unknown("scenario-reason-parameter-unset"));
          const receiver = frame.receiverId ? results.get(frame.receiverId) : undefined;
          if (frame.construct) {
            const instance = Object.assign(Object.create(null), { __functionTutorBrand: frame.callee.ownerId }); let invalid = false;
            for (const field of frame.callee.fieldInitializers || []) {
              const value = field.value?.kind === "literal" ? literal(field.value.value) : unknown("scenario-reason-call-unsupported");
              if (value.kind !== "known" || FUNCTION_LOGIC_SCENARIO_BLOCKED_KEYS.has(field.key)) { invalid = true; break; }
              instance[field.key] = value.value;
            }
            if (invalid) { markUncertain(); results.set(frame.caller.resultId, unknown("scenario-reason-call-unsupported")); continue; }
            if (frame.callee.thisBindingId) environment.set(frame.callee.thisBindingId, createFunctionLogicScenarioKnown(instance, []));
            const childResultId = allocate();
            frames.push({ tag: "call-return", callerResultId: frame.caller.resultId, childResultId, environment, thisBindingId: frame.callee.thisBindingId });
            frames.push({ tag: "program-enter", program: frame.callee, environment, depth: frame.caller.depth + 1, ancestry: frame.caller.ancestry, keepRecords: false, resultId: childResultId, allowAsync: false }); continue;
          }
          if (frame.callee.invocationRole === "method" && (!receiver || receiver.kind !== "known" || receiver.value?.__functionTutorBrand !== frame.callee.ownerId)) {
            markUncertain(); results.set(frame.caller.resultId, unknown("scenario-reason-receiver-unknown")); continue;
          }
          if (frame.callee.thisBindingId && receiver) environment.set(frame.callee.thisBindingId, receiver);
          if (frame.callee.executionKind === "generator") {
            const resolveGeneratorValue = (expression) => expression?.kind === "literal" ? literal(expression.value) : expression?.kind === "binding" ? environment.get(expression.bindingId) : unknown("scenario-reason-call-unsupported");
            const values = (frame.callee.generatorYields || []).map(resolveGeneratorValue);
            results.set(frame.caller.resultId, createFunctionLogicScenarioKnown(Object.assign(Object.create(null), { __functionTutorIterator: true, values, returnValue: resolveGeneratorValue(frame.callee.generatorReturn), index: 0, done: false, returned: false }), [])); continue;
          }
          const childResultId = allocate();
          frames.push({ tag: "call-return", callerResultId: frame.caller.resultId, childResultId });
          frames.push({ tag: "program-enter", program: frame.callee, environment, depth: frame.caller.depth + 1, ancestry: frame.caller.ancestry, keepRecords: false, resultId: childResultId, allowAsync: frame.allowAsync }); continue;
        }
        if (frame.tag === "call-return") {
          const result = results.get(frame.childResultId) || unknown("scenario-reason-call-unsupported");
          if (result.kind !== "known") markUncertain();
          results.set(frame.callerResultId, frame.thisBindingId && result.kind === "known" ? frame.environment.get(frame.thisBindingId) || result : result);
        }
      }
      const rootResult = uncertain ? unknown("scenario-reason-call-unsupported") : results.get("root");
      const terminal = rootStory.terminal?.kind === "return"
        ? { kind: "return", value: functionLogicScenarioTutorReturnValue(rootResult) }
        : rootStory.terminal || { kind: "exit" };
      return { recordsByBlockId, inputStateByBindingId: rootInput, truncated, processed: work, scenarioPaths: [{ ...rootStory, terminal, certainty: rootResult?.kind === "known" ? "exact" : "unknown", limited: rootResult?.kind !== "known" || truncated }] };
    }

  `;
}
