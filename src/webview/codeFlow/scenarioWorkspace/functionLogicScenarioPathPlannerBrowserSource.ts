/**
 * Browser-local symbolic path planning for Scenario Workspace. The planner
 * consumes only opaque Tutor CFG identities, bounds every product/traversal,
 * and never interprets source text as executable code.
 */
export function getFunctionLogicScenarioPathPlannerBrowserSource(): string {
  return /* js */ `
    const FUNCTION_TUTOR_SYMBOLIC_PATH_LIMIT = 12;
    const FUNCTION_TUTOR_SYMBOLIC_DECISION_LIMIT = 5;
    const FUNCTION_TUTOR_SYMBOLIC_STATE_LIMIT = 48;
    const FUNCTION_TUTOR_SYMBOLIC_DEPTH_LIMIT = 300;
    // Loop entry/exit and exception routes are source assumptions just like boolean/case choices.
    const FUNCTION_TUTOR_SYMBOLIC_CHOICE_KINDS = new Set(["true", "false", "case", "default", "iterate", "exit", "exception"]);

    /** Follows individual routes; mutually exclusive exits never become one reachable bag. */
    function functionTutorPlanSymbolicPaths(tutor, options = {}) {
      const program = tutor?.program;
      const blocks = program?.blocks || [];
      const edges = (program?.edges || []).filter((edge) => edge.kind !== "defines" && edge.kind !== "deferred");
      if (!program?.entryBlockId || !blocks.length) return [];
      const blockById = new Map(blocks.map((block) => [block.blockId, block]));
      if (!blockById.has(program.entryBlockId)) return [];
      const maxDepth = Math.max(1, Math.min(FUNCTION_TUTOR_SYMBOLIC_DEPTH_LIMIT, Number(options.maxDepth) || FUNCTION_TUTOR_SYMBOLIC_DEPTH_LIMIT));
      const outgoing = new Map();
      for (const edge of edges) {
        const values = outgoing.get(edge.sourceBlockId) || [];
        values.push(edge);
        outgoing.set(edge.sourceBlockId, values);
      }
      const plans = [];
      const seen = new Set();
      const pending = [{ nextBlockId: program.entryBlockId, blockIds: [], edgeIds: [], decisions: [], visited: new Set() }];
      let allocatedStates = 1; let truncated = false;
      function finish(state, terminalBlock, limited) {
        const signature = state.blockIds.join("|") + ":" + state.edgeIds.join("|");
        if (seen.has(signature)) return;
        seen.add(signature);
        const orderedBlocks = state.blockIds.map((id) => blockById.get(id)).filter(Boolean);
        const effects = orderedBlocks.flatMap((block) => {
          // Calls can live inside an assignment or return. The operation IR
          // retains that source evidence without interpreting the expression.
          const operations = (block.operations || []).filter((operation) => operation.kind === "effect");
          if (operations.length) return operations.map((operation) => ({ blockId: block.blockId, kind: operation.effectKind || "effect", label: operation.summary || block.label }));
          if (["call", "effect", "render", "event"].includes(block.kind)) return [{ blockId: block.blockId, kind: block.kind, label: block.label }];
          return (tutor.behaviorSummary?.impacts || []).filter((item) => ["call", "effect", "external-call", "unresolved-call"].includes(item.kind) && item.blockIds?.[0] === block.blockId)
            .map((item) => ({ blockId: block.blockId, kind: item.kind, label: item.sourcePreview }));
        });
        plans.push({
          blockIds: state.blockIds,
          edgeIds: state.edgeIds,
          transitions: [],
          terminal: { kind: ["return", "throw", "exit"].includes(terminalBlock?.kind) ? terminalBlock.kind : "unknown", blockId: terminalBlock?.blockId },
          certainty: "inferred",
          limited: Boolean(limited),
          symbolic: true,
          scenario: { ordinal: plans.length + 1, decisions: state.decisions, effects }
        });
      }
      // Linear segments advance within one state. Only forks consume the state
      // budget, so a long straight-line function still gets its full depth limit.
      while (pending.length && plans.length < FUNCTION_TUTOR_SYMBOLIC_PATH_LIMIT) {
        const state = pending.pop();
        while (true) {
          const block = blockById.get(state.nextBlockId);
          if (!block || state.visited.has(state.nextBlockId)) { finish(state, undefined, true); break; }
          state.visited.add(block.blockId); state.blockIds.push(block.blockId);
          if (["return", "throw", "exit"].includes(block.kind)) { finish(state, block, Boolean(block.terminal?.continuationId)); break; }
          if (state.blockIds.length >= maxDepth) { finish(state, undefined, true); break; }
          const choices = outgoing.get(block.blockId) || [];
          if (!choices.length) { finish(state, undefined, true); break; }
          const isDecision = choices.length > 1 && choices.some((edge) => FUNCTION_TUTOR_SYMBOLIC_CHOICE_KINDS.has(edge.kind));
          if (isDecision && state.decisions.length >= FUNCTION_TUTOR_SYMBOLIC_DECISION_LIMIT) { finish(state, undefined, true); break; }
          if (choices.length === 1) {
            state.edgeIds.push(choices[0].edgeId); state.nextBlockId = choices[0].targetBlockId; continue;
          }
          for (let index = choices.length - 1; index >= 0; index -= 1) {
            if (allocatedStates >= FUNCTION_TUTOR_SYMBOLIC_STATE_LIMIT) { truncated = true; continue; }
            const edge = choices[index];
            const decision = isDecision ? [{ blockId: block.blockId, label: block.label, edgeId: edge.edgeId, outcome: edge.kind, outcomeLabel: edge.label || edge.kind }] : [];
            pending.push({ nextBlockId: edge.targetBlockId, blockIds: [...state.blockIds], edgeIds: [...state.edgeIds, edge.edgeId], decisions: [...state.decisions, ...decision], visited: new Set(state.visited) });
            allocatedStates += 1;
          }
          if (!pending.length) finish(state, undefined, true);
          break;
        }
      }
      if (pending.length || truncated) for (const path of plans) path.limited = true;
      return plans;
    }

    /** Uses symbolic paths only when concrete inputs cannot determine a useful route. */
    function functionTutorResolveScenarioPaths(tutor, seed, evaluatedPaths, cachedPlans) {
      const evaluated = evaluatedPaths || [];
      // Python's bytecode owns its decisions; absent TS expression nodes are not an evaluation gap.
      if (tutor?.program?.python && evaluated.length && evaluated.every((path) => !path.limited && path.scenario?.concrete)
        && !(seed?.inputs || []).some((input) => input?.certainty === "unknown" || input?.value?.kind === "unknown")) return evaluated;
      // Remove symbolic combinations that contradict an independently checked
      // input prefix. Unchecked later branches remain explicitly symbolic.
      const checked = new Set(seed?.quality?.checkedEdgeIds || []);
      const planned = (cachedPlans || functionTutorPlanSymbolicPaths(tutor)).filter((path) => {
        const selected = new Map((path.scenario?.decisions || []).map((decision) => [decision.blockId, decision.edgeId]));
        return (tutor?.program?.edges || []).every((edge) => !checked.has(edge.edgeId)
          || !selected.has(edge.sourceBlockId) || selected.get(edge.sourceBlockId) === edge.edgeId);
      });
      const evaluatorHasStory = evaluated.some((path) => !path?.limited || (path?.transitions || []).length > 0);
      // A mixed seed can be labelled inferred even when one or more individual
      // parameters remain unknown. In that case a single evaluator route is not
      // evidence that the other source branches are unreachable. Likewise,
      // non-TypeScript adapters can expose exact true/false CFG edges without an
      // interpreter expression for the condition. Preserve every reachable CFG
      // combination instead of presenting the evaluator's first edge as reality.
      const seedHasUnknownInput = (seed?.inputs || []).some((input) =>
        input?.certainty === "unknown" || input?.value?.kind === "unknown"
      );
      const blockById = new Map((tutor?.program?.blocks || []).map((block) => [block.blockId, block]));
      const hasOpaquePlannedDecision = planned.some((path) => (path?.scenario?.decisions || []).some((decision) =>
        !blockById.get(decision.blockId)?.decision?.expression
      ));
      if (planned.length && (
        tutor?.program?.evaluationMode === "symbolic-only"
        || seed?.certainty === "unknown"
        || seedHasUnknownInput
        || hasOpaquePlannedDecision
        || !evaluated.length
        || !evaluatorHasStory
      )) return planned;
      if (!planned.length) return evaluated;
      return evaluated.map((path) => {
        const edgeIds = new Set(path?.edgeIds || []);
        const blockIds = new Set(path?.blockIds || []);
        const plan = planned.find((candidate) => candidate.blockIds.every((id) => blockIds.has(id))
          && candidate.scenario.decisions.every((decision) => edgeIds.has(decision.edgeId)));
        // The plan supplies labels, not certainty. Preserve a completed machine
        // result so TS/JS returns remain visible alongside the matched decisions.
        return plan ? { ...path, scenario: { ...plan.scenario, concrete: !path.limited && path.certainty === "exact" } } : path;
      });
    }

    /** Numbers structural routes without guessing business intent from call names. */
    function functionTutorScenarioTitle(path, fallbackOrdinal) {
      return projectAnalyzerText("scenario-path-number", { count: path?.scenario?.ordinal || fallbackOrdinal || 1 });
    }

    /** Formats the source-backed choices that distinguish one path row. */
    function functionTutorScenarioConditionText(path) {
      const decisions = path?.scenario?.decisions || [];
      if (!decisions.length) return projectAnalyzerText(path?.symbolic ? "scenario-path-source" : "scenario-path-evaluated");
      return decisions.map((decision) => decision.label + " → " + projectAnalyzerText("scenario-outcome-" + decision.outcome)).join(" · ");
    }

    /** Formats only calls/effects reachable through the selected choices. */
    function functionTutorScenarioEffectText(path) {
      if (path?.scenario?.concrete && path.terminal?.kind === "return") return projectAnalyzerText("may-return", { value: functionTutorValueText(path.terminal.value) });
      const effects = path?.scenario?.effects || [];
      if (!effects.length) return projectAnalyzerText("scenario-effect-none");
      return effects.map((effect) => effect.label).join(" → ");
    }
  `;
}
