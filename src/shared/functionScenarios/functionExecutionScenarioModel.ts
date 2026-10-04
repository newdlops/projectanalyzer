/** Pure bounded execution-scenario modeling and representative selection over existing Workspace routes. */
import type {
  FunctionExecutionScenario, FunctionExecutionScenarioCatalog, FunctionScenarioCertainty,
  FunctionScenarioGapCode, FunctionScenarioModelInput, FunctionScenarioModelOptions,
  FunctionScenarioModelRow, FunctionScenarioStep, FunctionScenarioTransition, FunctionScenarioValue
} from "./types";

/**
 * Creates one immutable program index and reusable model functions. All helpers
 * are enclosed so this tested implementation can also be emitted into a Webview.
 * It does not interpret expressions, perform I/O, or create another consumer.
 */
export function createFunctionExecutionScenarioModeler(input: FunctionScenarioModelInput, options: FunctionScenarioModelOptions = {}) {
  const bounded = (value: number | undefined, fallback: number, maximum: number) => Number.isFinite(value)
    ? Math.max(1, Math.min(maximum, Math.floor(value!))) : fallback;
  const maxDepth = bounded(options.maxDepth, 300, 300);
  const maxSteps = bounded(options.maxSteps, 80, 120);
  const maxScenarios = bounded(options.maxScenarios, 48, 48);
  const maxRepresentatives = bounded(options.maxRepresentatives, 5, 5);
  const choiceKinds = new Set(["true", "false", "case", "default", "iterate", "exit", "exception"]);
  const preview = (value: string | undefined) => (value || "").slice(0, 240);
  const certainty = (value: string | undefined): FunctionScenarioCertainty => value === "exact" || value === "inferred" ? value : "unknown";
  const program = input.program;
  const blocks = new Map((program?.blocks || []).map((block) => [block.blockId, block]));
  const edges = new Map((program?.edges || []).map((edge) => [edge.edgeId, edge]));
  const parameters = new Map((input.parameters || []).map((parameter) => [parameter.id, parameter]));
  const bindingNames = new Map((program?.bindings || []).map((binding) => [binding.bindingId, binding.name]));
  const outgoing = new Map<string, NonNullable<FunctionScenarioModelInput["program"]>["edges"][number][]>();
  for (const edge of edges.values()) {
    if (edge.kind === "defines" || edge.kind === "deferred") continue;
    const group = outgoing.get(edge.sourceBlockId) || [];
    group.push(edge); outgoing.set(edge.sourceBlockId, group);
  }
  const tokens = (blockId?: string) => [...new Set(blockId ? blocks.get(blockId)?.evidenceTokens || [] : [])].slice(0, 8);
  // Full checked choices survive the condition display budget. Weak keys avoid
  // retaining old catalogs after a Workspace result revision or root disposal.
  const checkedChoices = new WeakMap<FunctionExecutionScenario, Set<string>>();

  /** Copies JSON values iteratively; cycles, accessors, internal brands and depth budgets remain unknown. */
  function snapshot(value: unknown): { value: FunctionScenarioValue; limited: boolean } {
    const holder: { value: FunctionScenarioValue } = { value: null };
    const pending: Array<{ value: unknown; target: Record<string, FunctionScenarioValue> | FunctionScenarioValue[]; key: string | number; depth: number; ancestors: object[] }> = [{ value, target: holder, key: "value", depth: 0, ancestors: [] }];
    let work = 0; let limited = false;
    while (pending.length) {
      const item = pending.pop()!; const current = item.value;
      const assign = (next: FunctionScenarioValue) => { (item.target as Record<string, FunctionScenarioValue>)[String(item.key)] = next; };
      if (work++ >= 96 || item.depth > 6) { assign({ kind: "unknown", reason: "value-budget" }); limited = true; continue; }
      if (current === null || typeof current === "boolean") { assign(current); continue; }
      if (typeof current === "number" && Number.isFinite(current)) { assign(current); continue; }
      if (typeof current === "string") { assign(current.slice(0, 240)); limited ||= current.length > 240; continue; }
      if (current === undefined) { assign({ kind: "undefined" }); continue; }
      if (typeof current !== "object" || item.ancestors.includes(current)) { assign({ kind: "unknown", reason: "unsupported-value" }); limited = true; continue; }
      const proto = Object.getPrototypeOf(current);
      if (!Array.isArray(current) && proto !== Object.prototype && proto !== null) { assign({ kind: "unknown", reason: "unsupported-value" }); limited = true; continue; }
      if (["__proto__", "prototype", "constructor", "__functionTutorBrand", "__functionTutorIterator"].some((key) => Object.hasOwn(current, key))) {
        assign({ kind: "unknown", reason: "unsupported-value" }); limited = true; continue;
      }
      const array = Array.isArray(current);
      // Copy a dense bounded prefix, never a sparse numeric key into an array:
      // a single large index could otherwise allocate billions of JSON slots.
      const keys = array ? Array.from({ length: Math.min(16, current.length) }, (_, index) => String(index)) : Object.keys(current);
      // Reject long keys rather than shorten them into conflicting identities.
      if (keys.slice(0, 16).some((key) => key.length > 240)) { assign({ kind: "unknown", reason: "value-key-budget" }); limited = true; continue; }
      const target: Record<string, FunctionScenarioValue> | FunctionScenarioValue[] = array ? [] : proto === null ? Object.create(null) : {};
      assign(target); limited ||= array ? current.length > 16 : keys.length > 16;
      for (const key of keys.slice(0, 16).reverse()) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor)) { (target as Record<string, FunctionScenarioValue>)[key] = { kind: "unknown", reason: "accessor" }; limited = true; continue; }
        // Repeated references are independent JSON copies. An ancestor guard
        // catches cycles while the work budget also bounds alias expansion.
        pending.push({ value: descriptor.value, target, key, depth: item.depth + 1, ancestors: [...item.ancestors, current] });
      }
    }
    return { value: holder.value, limited };
  }

  /** Models one actual ordered route; an invalid suffix never supplies a successful terminal. */
  function create(row: FunctionScenarioModelRow): FunctionExecutionScenario | undefined {
    const path = row.path;
    if (!path) return undefined;
    const symbolic = program?.evaluationMode === "symbolic-only" || Boolean(path.symbolic)
      || !path.scenario?.concrete && !path.transitions?.length && path.terminal?.value === undefined;
    const basis = symbolic ? "symbolic" : "evaluated";
    const gaps: FunctionExecutionScenario["gaps"] = []; const seenGaps = new Set<string>();
    let analysisLimited = Boolean(path.limited); let invalidRoute = false;
    function gap(code: FunctionScenarioGapCode, blockId?: string, text?: string) {
      const key = code + ":" + (blockId || "") + ":" + (text || "");
      if (seenGaps.has(key)) return; seenGaps.add(key);
      gaps.push({ code, blockId, sourcePreview: text ? preview(text) : undefined, evidenceTokens: tokens(blockId) });
    }
    function valueOf(value: unknown, blockId?: string) {
      const result = snapshot(value); if (result.limited) gap("value-limit", blockId); return result.value;
    }
    const sourceInputs = row.seed.inputs || [];
    const inputs = sourceInputs.slice(0, 16).map((item) => ({
      parameterId: item.parameterId, name: preview(parameters.get(item.parameterId)?.name || item.parameterId),
      typeText: parameters.get(item.parameterId)?.typeText?.slice(0, 240), value: valueOf(item.value),
      omitted: Boolean(item.omitted), certainty: certainty(item.certainty)
    }));
    const route: string[] = []; const routeEdges: string[] = [];
    const occurrences = path.frames || path.occurrences || [];
    const sourceRoute = path.blockIds || [];
    for (let index = 0; index < sourceRoute.length; index += 1) {
      const id = sourceRoute[index]; const block = blocks.get(id);
      if (!block) { gap("missing-block", id); invalidRoute = true; break; }
      if (["defines", "deferred"].includes(block.embeddedRelation || "")) { gap("deferred-boundary", id); invalidRoute = true; break; }
      if (index >= maxDepth) { gap("path-limit", id, "depth-budget"); analysisLimited = true; invalidRoute = true; break; }
      const previous = route.at(-1);
      if (previous) {
        const edgeId = path.edgeIds?.[index - 1] || occurrences[index - 1]?.selectedEdgeId;
        const edge = edgeId ? edges.get(edgeId) : undefined;
        if (["return", "throw", "exit"].includes(blocks.get(previous)?.kind || "") || !edge
          || edge.sourceBlockId !== previous || edge.targetBlockId !== id || ["defines", "deferred"].includes(edge.kind)) {
          gap("disconnected-route", id); invalidRoute = true; break;
        }
        routeEdges.push(edge.edgeId);
      }
      if (!previous && program?.entryBlockId !== id) { gap("disconnected-route", id); invalidRoute = true; break; }
      route.push(id);
    }
    if (!route.length) { gap("missing-block", program?.entryBlockId); invalidRoute = true; }
    const checked = new Set(row.seed.quality?.checkedEdgeIds || []);
    const conditions: FunctionExecutionScenario["conditions"] = [];
    const decisionsByOccurrence = new Map<number, FunctionExecutionScenario["conditions"][number]>();
    // Evaluated loops can repeat/exit beyond a one-pass symbolic label plan.
    // Only actual ordered route edges establish choices and checked coverage.
    for (let index = 0; index < routeEdges.length; index += 1) {
      const edge = edges.get(routeEdges[index])!; const block = blocks.get(route[index])!;
      const choices = outgoing.get(block.blockId) || [];
      if (!choiceKinds.has(edge.kind) && !(choices.length > 1 && choices.some((candidate) => choiceKinds.has(candidate.kind)))) continue;
      const label = path.scenario?.decisions?.find((decision) => decision.blockId === block.blockId && decision.edgeId === edge.edgeId);
      const condition = {
        blockId: block.blockId, edgeId: edge.edgeId, sourcePreview: preview(label?.label || block.label), outcome: edge.kind,
        verification: program?.evaluationMode !== "symbolic-only" && ((!symbolic && (path.scenario?.concrete || path.certainty === "exact" && !path.limited)) || checked.has(edge.edgeId)) ? "checked" as const : "assumed" as const,
        evidenceTokens: tokens(block.blockId)
      };
      conditions.push(condition); decisionsByOccurrence.set(index, condition);
    }
    const steps: FunctionScenarioStep[] = []; let totalStepCount = 0;
    const visits = new Map<string, number>();
    const visitTotals = new Map<string, number>();
    for (const id of route) visitTotals.set(id, (visitTotals.get(id) || 0) + 1);
    const frameQueues = new Map<string, NonNullable<NonNullable<FunctionScenarioModelRow["path"]>["frames"]>[number][]>();
    for (const frame of occurrences.slice(0, maxDepth)) { const group = frameQueues.get(frame.blockId) || []; group.push(frame); frameQueues.set(frame.blockId, group); }
    function append(blockId: string, kind: FunctionScenarioStep["kind"], source: string, extra: Partial<FunctionScenarioStep> = {}) {
      const ordinal = ++totalStepCount;
      if (steps.length >= maxSteps) return;
      steps.push({ id: row.seed.id + ":" + row.pathIndex + ":step:" + ordinal, ordinal,
        kind, blockId, sourcePreview: preview(source), certainty: "exact", evidenceTokens: tokens(blockId), ...extra });
    }
    for (let routeIndex = 0; routeIndex < route.length; routeIndex += 1) {
      const id = route[routeIndex];
      const block = blocks.get(id)!;
      const visit = visits.get(id) || 0; visits.set(id, visit + 1);
      // Frames disambiguate repeated blocks. Without them, values from several
      // iterations must not be attached to whichever occurrence renders first.
      const transitions = symbolic ? [] : frameQueues.get(id)?.[visit]?.transitions
        || (visitTotals.get(id) === 1 ? (path.transitions || []).filter((change) => change.blockId === id) : []);
      const usedTransitions = new Set<FunctionScenarioTransition>();
      const operationCalls: string[] = [];
      let written = false;
      const decision = decisionsByOccurrence.get(routeIndex);
      for (const operation of block.operations || []) {
        if (operation.kind === "effect") {
          const source = operation.summary || block.label || id;
          const isCall = !operation.effectKind || operation.effectKind === "call";
          operationCalls.push(source); append(id, isCall ? "call" : "effect", source, { effectKind: operation.effectKind, certainty: certainty(operation.certainty) });
          if (isCall && operation.certainty !== "exact") gap("unresolved-call", id, source);
        } else if (["define", "assign", "increment", "delete"].includes(operation.kind)) {
          const bindingId = operation.bindingId || operation.target?.bindingId;
          const bindingName = bindingId ? bindingNames.get(bindingId) || bindingId : undefined;
          const transition = transitions.find((change) => !usedTransitions.has(change)
            && (bindingId ? change.targetBindingId === bindingId || change.target === bindingName || change.targetName === bindingName : true));
          if (transition) usedTransitions.add(transition);
          const segments = operation.target?.segments || operation.target?.path?.map((key) => ({ kind: "static" as const, key }));
          const sourceTarget = bindingName && bindingName + (segments || []).slice(0, 8).map((segment) => "[" + (segment.kind === "static" ? JSON.stringify(preview(segment.key)) : preview(bindingNames.get(segment.bindingId) || segment.bindingId)) + "]").join("");
          const targetName = preview(transition?.targetName || transition?.target || sourceTarget);
          const state = transition ? { before: valueOf(transition.before, id), after: valueOf(transition.after, id), certainty: certainty(transition.certainty) } : {};
          append(id, "write", block.label || targetName || id, { targetName, ...state }); written = true;
          if (transition?.certainty === "unknown") gap("unknown-value", id);
        } else if (operation.kind === "unsupported") gap("unsupported-operation", id, operation.summary || operation.reason);
      }
      for (const effect of path.scenario?.effects || []) {
        if (effect.blockId !== id || operationCalls.includes(effect.label)) continue;
        const isCall = ["call", "external-call", "unresolved-call"].includes(effect.kind);
        append(id, isCall ? "call" : "effect", effect.label, { effectKind: effect.kind, certainty: "inferred" });
        if (isCall) gap("unresolved-call", id, effect.label);
      }
      for (const transition of transitions) {
        if (usedTransitions.has(transition)) continue;
        // The evaluator invalidates every retained binding at an unsupported
        // boundary. Only operation-matched unknown writes are source-owned;
        // residual invalidations describe lost knowledge, not input mutation.
        if (transition.kind === "unknown" || transition.certainty === "unknown") { gap("unknown-value", id); continue; }
        append(id, "write", block.label || id, { targetName: preview(transition.targetName || transition.target),
          before: valueOf(transition.before, id), after: valueOf(transition.after, id), certainty: certainty(transition.certainty) }); written = true;
        if (transition.certainty === "unknown") gap("unknown-value", id);
      }
      // Other language adapters can expose source writes without operation IR.
      if (symbolic && !written) for (const item of input.behaviorSummary?.impacts || []) {
        if (item.kind === "write" && item.blockIds[0] === id) append(id, "write", item.sourcePreview, { certainty: certainty(item.certainty) });
      }
      // Calls and writes in the condition expression happen before choosing an
      // outgoing branch. The decision step records that completed source choice.
      if (["condition", "switch", "loop", "try"].includes(block.kind)) append(id, "decision", block.label || id, decision ? { decision: { edgeId: decision.edgeId, outcome: decision.outcome, verification: decision.verification } } : {});
      if (["return", "throw", "exit"].includes(block.kind)) append(id, block.kind as "return" | "throw" | "exit", block.label || id);
      else if (block.kind === "entry") append(id, "entry", block.label || id);
      else if (!written && !["condition", "switch", "loop", "try"].includes(block.kind) && !(block.operations || []).some((operation) => operation.kind === "effect")) append(id, "statement", block.label || id);
    }
    const terminalId = path.terminal?.blockId || route.at(-1);
    const terminalBlock = terminalId && terminalId === route.at(-1) ? blocks.get(terminalId) : undefined;
    const terminalKind = path.terminal?.kind;
    const knownTerminal = !invalidRoute && terminalBlock?.kind === terminalKind && ["return", "throw", "exit"].includes(terminalKind || "");
    const outcome: FunctionExecutionScenario["outcome"] = knownTerminal
      ? { kind: terminalKind as "return" | "throw" | "exit", blockId: terminalId, sourcePreview: preview(terminalBlock?.label), evidenceTokens: tokens(terminalId) }
      : { kind: "unknown", evidenceTokens: [] };
    if (knownTerminal && !symbolic && path.terminal?.value !== undefined) {
      outcome.value = valueOf(path.terminal.value, terminalId);
      const terminalValue = path.terminal.value as { kind?: string } | null;
      if (terminalValue?.kind === "unknown" || terminalValue?.kind === "unset") gap("unknown-value", terminalId);
    }
    if (!knownTerminal) gap("unknown-terminal", terminalId);
    if (path.limited) gap("path-limit", route.at(-1), path.terminal?.reason);
    if (path.partial || path.certainty === "unknown" || path.gaps?.length || row.seed.gapIds?.length || program?.gapIds?.length) gap("analysis-gap");
    if (terminalBlock?.terminal?.continuationId) gap("unsupported-operation", terminalId, "terminal-continuation");
    const result: FunctionExecutionScenario = {
      schema: 1, id: row.seed.id + ":path:" + row.pathIndex, seedId: row.seed.id, pathIndex: row.pathIndex,
      basis, status: gaps.length ? "partial" : "complete", certainty: certainty(path.certainty), observation: "static",
      inputs: inputs.slice(0, 16), conditions: conditions.slice(0, 12), steps: steps.slice(0, maxSteps), outcome,
      assumptions: [...new Set(row.seed.quality?.assumptions || [])].slice(0, 8).map((text) => preview(text)), gaps: gaps.slice(0, 16),
      graph: { blockIds: route, edgeIds: routeEdges },
      omittedCounts: { inputs: Math.max(0, sourceInputs.length - inputs.length), conditions: Math.max(0, conditions.length - 12), steps: Math.max(0, totalStepCount - steps.length), gaps: Math.max(0, gaps.length - 16) },
      analysisLimited: analysisLimited || invalidRoute
    };
    checkedChoices.set(result, new Set(conditions.filter((condition) => condition.verification === "checked").map((condition) => condition.edgeId)));
    return result;
  }

  /** Selects differing source choices, terminal values, inputs and assumptions without dropping navigation identities. */
  function representatives(scenarios: readonly FunctionExecutionScenario[]) {
    const features = (scenario: FunctionExecutionScenario) => new Set([
      "terminal:" + scenario.outcome.kind, "basis:" + scenario.basis, "partial:" + scenario.status,
      ...scenario.conditions.map((condition) => "choice:" + condition.edgeId),
      ...scenario.steps.filter((step) => ["call", "effect", "write"].includes(step.kind)).map((step) => step.kind + ":" + step.blockId + ":" + (step.targetName || step.sourcePreview)),
      "terminal-source:" + (scenario.outcome.blockId || ""), "value:" + JSON.stringify(scenario.outcome.value),
      ...scenario.inputs.map((item) => "input:" + item.parameterId + ":" + JSON.stringify(item.value)),
      ...scenario.assumptions.map((assumption) => "assumption:" + assumption)
    ]);
    const pending = scenarios.map((scenario) => ({ scenario, features: features(scenario) }));
    const result: string[] = []; const represented = new Set<string>();
    while (pending.length && result.length < maxRepresentatives) {
      let best = 0; let bestScore = -1;
      for (let index = 0; index < pending.length; index += 1) {
        const score = [...pending[index].features].filter((feature) => !represented.has(feature))
          .reduce((total, feature) => total + (feature.startsWith("terminal:") ? 8 : feature.startsWith("basis:") || feature.startsWith("partial:") ? 4 : 1), 0);
        if (score > bestScore) { best = index; bestScore = score; }
      }
      const chosen = pending.splice(best, 1)[0]; result.push(chosen.scenario.id);
      for (const feature of chosen.features) represented.add(feature);
    }
    return result;
  }

  /** Indexes current-scope source alternatives iteratively; assumed paths never become checked coverage. */
  function catalog(rows: readonly FunctionScenarioModelRow[]): FunctionExecutionScenarioCatalog {
    const available = rows.filter((row) => row.path);
    const scenarios = available.slice(0, maxScenarios).map(create).filter((value): value is FunctionExecutionScenario => Boolean(value));
    const pending = program?.entryBlockId ? [{ id: program.entryBlockId, depth: 0 }] : [];
    const visited = new Set<string>(); const sourceChoices = new Set<string>(); let sourceLimited = false;
    while (pending.length) {
      const item = pending.pop()!;
      if (visited.has(item.id)) continue;
      const block = blocks.get(item.id);
      if (!block || ["defines", "deferred"].includes(block.embeddedRelation || "")) continue;
      if (item.depth >= maxDepth || visited.size >= 300) { sourceLimited = true; continue; }
      visited.add(item.id);
      if (["return", "throw", "exit"].includes(block.kind)) continue;
      const choices = outgoing.get(item.id) || [];
      if (choices.length > 1 && choices.some((edge) => ["true", "false", "case", "default", "iterate", "exit", "exception"].includes(edge.kind))) for (const edge of choices) sourceChoices.add(edge.edgeId);
      for (const edge of choices) pending.push({ id: edge.targetBlockId, depth: item.depth + 1 });
    }
    const checked = new Set(scenarios.flatMap((scenario) => [...checkedChoices.get(scenario) || []]));
    return { schema: 1, scenarios, representativeIds: representatives(scenarios), coverage: {
      modeledScenarioCount: scenarios.length, omittedScenarioCount: available.length - scenarios.length,
      sourceDecisionCount: sourceChoices.size, checkedDecisionCount: [...checked].filter((id) => sourceChoices.has(id)).length,
      analysisLimited: sourceLimited || scenarios.some((scenario) => scenario.analysisLimited), exhaustive: false
    } };
  }
  return { create, catalog };
}
