/** Pure reading summary of the selected function's displayed, directly owned statements. */
import type { FunctionLogicBlockPayload } from "../../../protocol/functionLogic";

type ReadingInput = {
  blocks: readonly (Pick<FunctionLogicBlockPayload, "id" | "kind" | "parentBlockId"> & { embeddedBoundaryId?: string; functionScopeId?: string })[];
  layout: { nodes: readonly { blockId: string }[] };
  valueBindings?: readonly { name: string; kind: string; definitionBlockId?: string }[];
  tutor?: { parameters: readonly { name: string }[]; program: { blocks: readonly { blockId: string }[] }; frameworkBehavior?: { facts: readonly { kind: string; blockId?: string }[] } };
};

/** Counts source sites, never runtime executions, excluding attached and deferred bodies. */
export function createFunctionUnderstandingModel(logic: ReadingInput, resolveBlockId: (id: string) => string | undefined = (id) => id, maxDepth = 100) {
  const visible = new Set(logic.layout.nodes.map((node) => node.blockId));
  const owned = logic.tutor?.program?.blocks ? new Set(logic.tutor.program.blocks.map((block) => resolveBlockId(block.blockId))) : undefined;
  const blocksById = new Map(logic.blocks.map((block) => [block.id, block]));
  const rootScope = logic.blocks.find((block) => block.kind === "entry")?.functionScopeId;
  const seen = new Set<string>();
  const depthLimit = Math.max(1, Math.min(100, Math.floor(maxDepth) || 100));
  const blocks = logic.blocks.filter((block) => {
    if (seen.has(block.id) || !visible.has(block.id) || block.embeddedBoundaryId || owned && !owned.has(block.id)) return false;
    if (rootScope && block.functionScopeId !== rootScope) return false;
    seen.add(block.id);
    const ancestors = new Set<string>();
    let parent = block.parentBlockId;
    while (parent && ancestors.size < depthLimit) {
      if (ancestors.has(parent)) return false;
      ancestors.add(parent);
      const owner = blocksById.get(parent);
      if (owner?.kind === "callable" || owner?.kind === "embedded") return false;
      parent = owner?.parentBlockId;
    }
    return !parent;
  });
  const ofKind = (kinds: string[]) => blocks.filter((block) => kinds.includes(block.kind)).map((block) => block.id);
  const directIds = new Set(blocks.map((block) => block.id));
  const effects = new Set(ofKind(["effect"]));
  for (const fact of logic.tutor?.frameworkBehavior?.facts ?? []) {
    const id = fact.blockId && resolveBlockId(fact.blockId);
    if (fact.kind === "django-query-write" && id && directIds.has(id)) effects.add(id);
  }
  return {
    inputs: logic.tutor?.parameters ? logic.tutor.parameters.map((parameter) => parameter.name)
      : (logic.valueBindings ?? []).filter((binding) => binding.kind === "parameter" && (!binding.definitionBlockId || directIds.has(binding.definitionBlockId))).map((binding) => binding.name),
    entryId: ofKind(["entry"])[0],
    decisionIds: ofKind(["condition", "loop", "switch", "try"]),
    returnIds: ofKind(["return"]), throwIds: ofKind(["throw"]), effectIds: [...effects]
  };
}

/** Uses the same tested projection inside the CSP-protected Webview. */
export function getFunctionUnderstandingModelBrowserSource(): string {
  return createFunctionUnderstandingModel.toString();
}
