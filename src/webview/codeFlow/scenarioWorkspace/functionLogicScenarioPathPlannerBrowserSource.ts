/**
 * Browser-local symbolic path planning for Scenario Workspace. The planner
 * consumes only opaque Tutor CFG identities, bounds every product/traversal,
 * and never interprets source text as executable code.
 */
export function getFunctionLogicScenarioPathPlannerBrowserSource(): string {
  return /* js */ `
    const FUNCTION_TUTOR_SYMBOLIC_PATH_LIMIT = 12;
    const FUNCTION_TUTOR_SYMBOLIC_DECISION_LIMIT = 5;
    const FUNCTION_TUTOR_SYMBOLIC_CHOICE_KINDS = new Set(["true", "false", "case"]);

    /** Enumerates reachable condition combinations while collapsing loop counts. */
    function functionTutorPlanSymbolicPaths(tutor) {
      const program = tutor?.program;
      const blocks = program?.blocks || [];
      const edges = (program?.edges || []).filter((edge) => edge.kind !== "defines" && edge.kind !== "deferred");
      if (!program?.entryBlockId || !blocks.length || !edges.length) return [];
      const outgoing = new Map();
      for (const edge of edges) {
        const values = outgoing.get(edge.sourceBlockId) || [];
        values.push(edge);
        outgoing.set(edge.sourceBlockId, values);
      }
      const decisions = [];
      for (const block of blocks) {
        const choices = (outgoing.get(block.blockId) || []).filter((edge) => FUNCTION_TUTOR_SYMBOLIC_CHOICE_KINDS.has(edge.kind));
        if (choices.length > 1) decisions.push({ block, choices });
      }
      if (!decisions.length) return [];
      const boundedDecisions = decisions.slice(0, FUNCTION_TUTOR_SYMBOLIC_DECISION_LIMIT);
      let combinations = [new Map()];
      for (const decision of boundedDecisions) {
        const next = [];
        for (const combination of combinations) {
          for (const choice of decision.choices) {
            const selected = new Map(combination); selected.set(decision.block.blockId, choice.edgeId); next.push(selected);
            if (next.length >= FUNCTION_TUTOR_SYMBOLIC_PATH_LIMIT * 4) break;
          }
          if (next.length >= FUNCTION_TUTOR_SYMBOLIC_PATH_LIMIT * 4) break;
        }
        combinations = next;
      }
      const plans = [];
      const seen = new Set();
      for (const selection of combinations) {
        const reachable = functionTutorReachableScenarioSlice(program.entryBlockId, outgoing, selection);
        const selectedDecisions = boundedDecisions.flatMap((decision) => {
          if (!reachable.blockIds.has(decision.block.blockId)) return [];
          const selectedEdgeId = selection.get(decision.block.blockId);
          const edge = decision.choices.find((candidate) => candidate.edgeId === selectedEdgeId);
          return edge ? [{ blockId: decision.block.blockId, label: decision.block.label, edgeId: edge.edgeId, outcome: edge.kind, outcomeLabel: edge.label || edge.kind }] : [];
        });
        if (!selectedDecisions.length) continue;
        const signature = selectedDecisions.map((item) => item.blockId + "=" + item.edgeId).join("|");
        if (seen.has(signature)) continue;
        seen.add(signature);
        const orderedBlocks = blocks.filter((block) => reachable.blockIds.has(block.blockId));
        const effects = orderedBlocks.filter((block) => ["call", "effect", "render", "event"].includes(block.kind)).map((block) => ({ blockId: block.blockId, kind: block.kind, label: block.label }));
        const terminalBlock = [...orderedBlocks].reverse().find((block) => ["return", "throw", "exit"].includes(block.kind));
        plans.push({
          blockIds: orderedBlocks.map((block) => block.blockId),
          edgeIds: edges.filter((edge) => reachable.edgeIds.has(edge.edgeId)).map((edge) => edge.edgeId),
          transitions: [],
          terminal: { kind: terminalBlock?.kind || "exit" },
          certainty: "inferred",
          limited: decisions.length > boundedDecisions.length,
          symbolic: true,
          scenario: { ordinal: plans.length + 1, decisions: selectedDecisions, effects: effects }
        });
        if (plans.length >= FUNCTION_TUTOR_SYMBOLIC_PATH_LIMIT) break;
      }
      return plans;
    }

    /** Computes a selected-edge reachability slice with an explicit visited set. */
    function functionTutorReachableScenarioSlice(entryBlockId, outgoing, selection) {
      const blockIds = new Set(); const edgeIds = new Set(); const queue = [entryBlockId];
      while (queue.length > 0) {
        const blockId = queue.shift();
        if (!blockId || blockIds.has(blockId)) continue;
        blockIds.add(blockId);
        for (const edge of outgoing.get(blockId) || []) {
          const selectedEdgeId = selection.get(blockId);
          if (FUNCTION_TUTOR_SYMBOLIC_CHOICE_KINDS.has(edge.kind) && selectedEdgeId && edge.edgeId !== selectedEdgeId) continue;
          edgeIds.add(edge.edgeId);
          if (!blockIds.has(edge.targetBlockId)) queue.push(edge.targetBlockId);
        }
      }
      return { blockIds, edgeIds };
    }

    /** Uses symbolic paths only when concrete inputs cannot determine a useful route. */
    function functionTutorResolveScenarioPaths(tutor, seed, evaluatedPaths) {
      const evaluated = evaluatedPaths || [];
      // Python's bytecode owns its decisions; absent TS expression nodes are not an evaluation gap.
      if (tutor?.program?.python && evaluated.length && evaluated.every((path) => !path.limited && path.scenario?.concrete)
        && !(seed?.inputs || []).some((input) => input?.certainty === "unknown" || input?.value?.kind === "unknown")) return evaluated;
      // Remove symbolic combinations that contradict an independently checked
      // input prefix. Unchecked later branches remain explicitly symbolic.
      const checked = new Set(seed?.quality?.checkedEdgeIds || []);
      const planned = functionTutorPlanSymbolicPaths(tutor).filter((path) => {
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
        seed?.certainty === "unknown"
        || seedHasUnknownInput
        || hasOpaquePlannedDecision
        || !evaluated.length
        || !evaluatorHasStory
      )) return planned;
      if (!planned.length) return evaluated;
      return evaluated.map((path) => {
        const edgeIds = new Set(path?.edgeIds || []);
        const plan = planned.find((candidate) => candidate.scenario.decisions.every((decision) => edgeIds.has(decision.edgeId)));
        // The plan supplies labels, not certainty. Preserve a completed machine
        // result so TS/JS returns remain visible alongside the matched decisions.
        return plan ? { ...path, scenario: { ...plan.scenario, concrete: !path.limited && path.certainty === "exact" } } : path;
      });
    }

    /** Produces a short localized scenario name from its reached effects. */
    function functionTutorScenarioTitle(path, fallbackOrdinal) {
      const effects = path?.scenario?.effects || [];
      const kinds = effects.map((effect) => functionTutorScenarioActionKind(effect.label));
      const unique = [...new Set(kinds.filter(Boolean))];
      if (unique.length === 0) return projectAnalyzerText("scenario-path-no-effects");
      if (unique.length === 1 && unique[0] === "delete") return projectAnalyzerText("scenario-path-delete-only");
      if (unique.length === 1 && unique[0] === "create") return projectAnalyzerText("scenario-path-create-only");
      if (unique.includes("delete") && unique.includes("create")) return projectAnalyzerText("scenario-path-delete-create");
      return projectAnalyzerText("scenario-path-number", { count: path?.scenario?.ordinal || fallbackOrdinal || 1 });
    }

    /** Keeps name heuristics presentation-only; the source label remains visible. */
    function functionTutorScenarioActionKind(label) {
      const name = String(label || "").toLowerCase();
      if (/delete|remove|destroy|drop/u.test(name)) return "delete";
      if (/create|add|insert|append/u.test(name)) return "create";
      if (/update|edit|save|write|set/u.test(name)) return "update";
      return "call";
    }

    /** Formats the source-backed choices that distinguish one path row. */
    function functionTutorScenarioConditionText(path) {
      const decisions = path?.scenario?.decisions || [];
      if (!decisions.length) return projectAnalyzerText("scenario-path-evaluated");
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
