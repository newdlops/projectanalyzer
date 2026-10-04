/** Execution-scenario integration checks use the same emitted model as Function Guide. */
import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionTutorBrowserSource } from "../../webview/codeFlow/tutor";
import { getFunctionLogicScenarioWorkspaceBrowserSource } from "../../webview/codeFlow/scenarioWorkspace";
import { createFunctionExecutionScenarioModeler } from "../../shared/functionScenarios";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { installSidebarWebviewRuntime } from "./helpers/sidebarWebviewRuntime";
import { buildInputModel } from "./helpers/neuralScenarioFixtures";
import { createFunctionTutorPayload } from "../../application/codeFlow/functionTutor";
import { getFunctionLogicValuePreviewBrowserSource, getFunctionLogicScenarioEvaluatorBrowserSource } from "../../webview/codeFlow/valuePreview";
import { getFunctionLogicScenarioEvaluationBrowserSource } from "../../webview/codeFlow/scenarioEvaluation";
import { getFunctionLogicBrowserSource } from "../../webview/codeFlow/functionLogicBrowserSource";

type Model = {
  schema: number;
  basis: string;
  status: string;
  inputs: Array<{ name: string; value: unknown }>;
  conditions: Array<{ edgeId: string; verification: string }>;
  steps: Array<{ kind: string; blockId: string; sourcePreview: string; evidenceTokens: string[] }>;
  outcome: { kind: string; sourcePreview?: string; value?: unknown };
  gaps: Array<{ code: string; blockId?: string }>;
};

/** Runs the production projection; there is no synthetic evaluator or DOM in these tests. */
function project(tutor: object, rows: object[]) {
  return new Function(`${getFunctionTutorBrowserSource()}
    return (tutor, rows) => createFunctionTutorRepresentativeSummaryCache(tutor).read(rows, 1);`
  )()(tutor, rows) as { items: Array<{ execution?: Model }>; catalog?: { scenarios: Model[]; coverage: { checkedDecisionCount: number; analysisLimited: boolean } } };
}

function fixture() {
  const blocks = [
    { blockId: "entry", kind: "entry", label: "Function entry", operations: [], evidenceTokens: [] },
    { blockId: "fetch", kind: "mutation", label: "const value = fetch(input)", operations: [
      { kind: "effect", effectKind: "call", summary: "fetch(input)", certainty: "unknown" },
      { kind: "define", bindingId: "value", value: { kind: "unsupported", reason: "dynamic-call", summary: "fetch(input)" } }
    ], evidenceTokens: ["code-evidence:fetch"] },
    { blockId: "save", kind: "mutation", label: "count += 1; save(value)", operations: [
      { kind: "assign", target: { kind: "binding", bindingId: "count" }, operator: "add", value: { kind: "literal", value: { kind: "number", value: 1 } } },
      { kind: "effect", effectKind: "call", summary: "save(value)", certainty: "unknown" }
    ], evidenceTokens: ["code-evidence:save"] },
    { blockId: "return", kind: "return", label: "return count", operations: [], terminal: { kind: "return" }, evidenceTokens: ["code-evidence:return"] }
  ];
  const tutor = {
    parameters: [{ id: "input", name: "input", typeText: "Int" }],
    program: { evaluationMode: "symbolic-only", entryBlockId: "entry", blocks,
      bindings: [{ bindingId: "value", name: "value" }, { bindingId: "count", name: "count" }],
      edges: [
        { edgeId: "fetch-edge", sourceBlockId: "entry", targetBlockId: "fetch", kind: "next", certainty: "exact" },
        { edgeId: "save-edge", sourceBlockId: "fetch", targetBlockId: "save", kind: "next", certainty: "exact" },
        { edgeId: "return-edge", sourceBlockId: "save", targetBlockId: "return", kind: "next", certainty: "exact" }
      ], gapIds: [] },
    behaviorSummary: { outcomes: [], steps: [], impacts: [], gaps: [], omittedCounts: { impacts: 2 } }
  };
  const row = { seed: { id: "seed", source: "type", inputs: [{ parameterId: "input", value: { kind: "number", value: 7 }, certainty: "exact" }], gapIds: [], quality: { assumptions: [] } }, pathIndex: 0,
    path: { blockIds: ["entry", "fetch", "save", "return"], edgeIds: ["fetch-edge", "save-edge", "return-edge"], transitions: [], symbolic: true, limited: false,
      terminal: { kind: "return", blockId: "return" }, certainty: "inferred", scenario: { concrete: false, decisions: [], effects: [
        { blockId: "fetch", kind: "call", label: "fetch(input)" }, { blockId: "save", kind: "call", label: "save(value)" }
      ] } }
  };
  return { tutor, row };
}

test("execution models preserve interleaved calls and writes even when static Summary omits them", () => {
  const { tutor, row } = fixture();
  const execution = project(tutor, [row]).items[0].execution;
  assert.equal(execution?.schema, 1, "representatives must expose a reusable execution model");
  assert.equal(execution?.basis, "symbolic");
  assert.deepEqual(execution?.steps.filter((step) => ["call", "write"].includes(step.kind)).map((step) => [step.kind, step.blockId]), [
    ["call", "fetch"], ["write", "fetch"], ["write", "save"], ["call", "save"]
  ]);
  assert.deepEqual(execution?.steps.find((step) => step.kind === "call")?.evidenceTokens, ["code-evidence:fetch"]);
  assert.equal(execution?.outcome.sourcePreview, "return count");
  assert.ok(execution?.gaps.some((gap) => gap.code === "unresolved-call"));
});

test("Kotlin capability wins over stale calculated values and retains source terminal evidence", () => {
  const { tutor, row } = fixture();
  row.path.symbolic = false; row.path.scenario.concrete = true;
  Object.assign(row.path.terminal, { value: { kind: "number", value: 8 } });
  const execution = project(tutor, [row]).items[0].execution;
  assert.equal(execution?.basis, "symbolic");
  assert.equal(execution?.outcome.value, undefined);
  assert.deepEqual(execution?.inputs.map((input) => [input.name, input.value]), [["input", { kind: "number", value: 7 }]]);
  assert.equal(execution?.outcome.sourcePreview, "return count");
});

test("unknown and disconnected route suffixes remain partial instead of inheriting a source return", () => {
  const { tutor, row } = fixture();
  row.path.blockIds = ["entry", "fetch", "missing", "return"];
  row.path.limited = true;
  const execution = project(tutor, [row]).items[0].execution;
  assert.equal(execution?.status, "partial");
  assert.equal(execution?.outcome.kind, "unknown");
  assert.equal(execution?.outcome.sourcePreview, undefined);
  assert.equal(execution?.steps.some((step) => step.blockId === "return"), false);
  assert.ok(execution?.gaps.some((gap) => gap.code === "missing-block" && gap.blockId === "missing"));
});

test("symbolic branch choices remain assumptions and never count as checked decision coverage", () => {
  const { tutor, row } = fixture();
  tutor.program.blocks[1].kind = "condition";
  tutor.program.edges[1].kind = "true";
  Object.assign(row.path.scenario, { decisions: [{ blockId: "fetch", edgeId: "save-edge", label: "input > 0", outcome: "true" }] });
  const projection = project(tutor, [row]);
  assert.deepEqual(projection.items[0].execution?.conditions.map((condition) => condition.verification), ["assumed"]);
  assert.equal(projection.catalog?.coverage.checkedDecisionCount, 0);
});

test("Guide and Values share one model catalog across selection, playback and repeated acquisition", () => {
  assert.equal(getFunctionLogicBrowserSource().match(/function createFunctionExecutionScenarioModeler\(/g)?.length, 1,
    "the production bundle must not ship a second copy of the shared modeler");
  const { tutor, row } = fixture();
  Object.assign(tutor, { seeds: [row.seed] });
  const browser = new Function(`${getFunctionLogicScenarioWorkspaceBrowserSource()}
    ${getFunctionTutorBrowserSource()}
    return { acquire: acquireFunctionLogicScenarioWorkspace, project: createFunctionTutorRepresentativeSummaryCache };`
  )() as {
    acquire(key: string, tutor: object): {
      acquire(): void; release(): void;
      readModels?: () => { scenarios: Model[] };
      read(): { resultRevision: number };
      select(seedId: string, pathIndex: number): void;
      setPlaybackState(seedId: string, pathIndex: number, phase: string): void;
    };
    project(tutor: object): { read(rows: object[], revision: number, catalog: unknown): { items: Array<{ execution: Model }> } };
  };
  const workspace = browser.acquire("execution-model", tutor);
  assert.equal(workspace.readModels?.().scenarios.length, 0, "idle construction must not enumerate or evaluate paths");
  workspace.acquire();
  const catalog = workspace.readModels!();
  assert.equal(catalog.scenarios.length, 1);
  const projected = browser.project(tutor).read([row], workspace.read().resultRevision, catalog);
  assert.equal(projected.items[0].execution, catalog.scenarios[0], "both surfaces must consume the same semantic object");
  workspace.select("seed", 0); workspace.setPlaybackState("seed", 0, "playing"); workspace.release(); workspace.acquire();
  assert.equal(workspace.readModels!(), catalog, "navigation and playback do not invalidate semantic models");
});

test("yield and external writes remain effects rather than being relabeled as calls", () => {
  const { tutor, row } = fixture();
  tutor.program.blocks[1].operations = [{ kind: "effect", effectKind: "yield", summary: "yield value", certainty: "exact" }];
  row.path.scenario.effects = [{ blockId: "fetch", kind: "yield", label: "yield value" }];
  const execution = project(tutor, [row]).items[0].execution;
  assert.equal(execution?.steps.some((step) => step.kind === "effect" && step.sourcePreview === "yield value"), true);
  assert.equal(execution?.steps.some((step) => step.kind === "call" && step.sourcePreview === "yield value"), false);
});

test("a route cannot execute source steps after a return and still claim that return as its outcome", () => {
  const { tutor, row } = fixture();
  tutor.program.edges.push({ edgeId: "after-return", sourceBlockId: "return", targetBlockId: "save", kind: "next", certainty: "exact" });
  row.path.blockIds.push("save"); row.path.edgeIds.push("after-return");
  const execution = createFunctionExecutionScenarioModeler(tutor).create(row)!;
  assert.equal(execution.outcome.kind, "unknown");
  assert.equal(execution.steps.filter((step) => step.blockId === "save" && step.kind === "write").length, 1);
  assert.ok(execution.gaps.some((gap) => gap.code === "disconnected-route"));
});

test("repeated evaluated blocks retain each occurrence's own write snapshots", () => {
  const { tutor, row } = fixture();
  tutor.program.evaluationMode = "concrete"; row.path.symbolic = false; row.path.scenario.concrete = true;
  row.path.blockIds = ["entry", "fetch", "save", "save", "return"];
  tutor.program.edges.push({ edgeId: "repeat", sourceBlockId: "save", targetBlockId: "save", kind: "repeat", certainty: "exact" });
  row.path.edgeIds = ["fetch-edge", "save-edge", "repeat", "return-edge"];
  Object.assign(row.path, { occurrences: [
    { blockId: "save", transitions: [{ blockId: "save", targetBindingId: "count", before: { kind: "number", value: 0 }, after: { kind: "number", value: 1 }, certainty: "exact" }] },
    { blockId: "save", transitions: [{ blockId: "save", targetBindingId: "count", before: { kind: "number", value: 1 }, after: { kind: "number", value: 2 }, certainty: "exact" }] }
  ] });
  const execution = createFunctionExecutionScenarioModeler(tutor).create(row)!;
  assert.deepEqual(execution.steps.filter((step) => step.blockId === "save" && step.kind === "write").map((step) => [step.before, step.after]), [
    [{ kind: "number", value: 0 }, { kind: "number", value: 1 }],
    [{ kind: "number", value: 1 }, { kind: "number", value: 2 }]
  ]);
});

test("value snapshots preserve safe aliases without retaining the mutable evaluator object", () => {
  const { tutor, row } = fixture();
  const shared = { kind: "number", value: 3 };
  Object.assign(row.seed.inputs[0], { value: { kind: "array", items: [shared, shared], truncated: false } });
  const execution = createFunctionExecutionScenarioModeler(tutor).create(row)!;
  assert.deepEqual(execution.inputs[0].value, { kind: "array", items: [{ kind: "number", value: 3 }, { kind: "number", value: 3 }], truncated: false });
  shared.value = 99;
  assert.ok(JSON.stringify(execution.inputs[0].value).includes('"value":3'));
  assert.equal(execution.gaps.some((gap) => gap.code === "value-limit"), false);
});

test("sparse arrays cannot escape the model value budget through a large numeric index", () => {
  const { tutor, row } = fixture(); const sparse: unknown[] = []; sparse[100_000] = 1;
  Object.assign(row.seed.inputs[0], { value: { kind: "array", items: sparse, truncated: false } });
  const execution = createFunctionExecutionScenarioModeler(tutor).create(row)!;
  const copied = execution.inputs[0].value as { items: unknown[] };
  assert.ok(copied.items.length <= 16);
  assert.ok(execution.gaps.some((gap) => gap.code === "value-limit"));
});

test("member-write values keep the field target instead of claiming the receiver became a scalar", () => {
  const { tutor, row } = fixture(); tutor.program.evaluationMode = "concrete"; row.path.symbolic = false; row.path.scenario.concrete = true;
  tutor.program.bindings.push({ bindingId: "state", name: "state" });
  Object.assign(tutor.program.blocks[2].operations[0], { target: { kind: "member", bindingId: "state", path: ["count"] } });
  Object.assign(row.path, { transitions: [{ blockId: "save", targetBindingId: "state", targetName: 'state["count"]', before: { kind: "number", value: 1 }, after: { kind: "number", value: 2 }, certainty: "exact" }] });
  const execution = createFunctionExecutionScenarioModeler(tutor).create(row)!;
  assert.equal(execution.steps.find((step) => step.blockId === "save" && step.kind === "write")?.targetName, 'state["count"]');
});

test("Values renders model calls and writes in one ordered list with an explicit source outcome", () => {
  const runtime = installSidebarWebviewRuntime();
  try {
    const { tutor, row } = fixture(); Object.assign(tutor, { seeds: [row.seed] });
    const create = new Function(`${getBrowserLocalizationSource()}${getFunctionLogicScenarioWorkspaceBrowserSource()}${getFunctionTutorBrowserSource()}
      return tutor => { const session=acquireFunctionLogicScenarioWorkspace("values-model",tutor); return createFunctionLogicScenarioWorkspace(session,{tutor}); };`
    )();
    const panel = create(tutor) as { element: HTMLElement; activate(): void; dispose(): void };
    document.getElementById("execution-root")!.append(panel.element); panel.activate();
    assert.equal(runtime.countRenderedByClass("execution-root", "logic-scenario-work-order"), 1);
    const sources = Array.from({ length: runtime.countRenderedByClass("execution-root", "logic-scenario-work-step") }, (_, index) =>
      document.getElementById(runtime.getRenderedIdentityByClassNth("execution-root", "logic-scenario-work-step", index))!.textContent);
    assert.deepEqual(sources, ["fetch(input)", "const value = fetch(input)", "count += 1; save(value)", "save(value)"]);
    assert.ok(runtime.getRenderedText("execution-root").some((text) => text.includes("Source terminal: return count")));
    panel.dispose();
  } finally { runtime.restore(); }
});

test("actual evaluated loop choices retain every iteration and exit despite one-pass symbolic labels", async () => {
  const input = await buildInputModel("export function inspect(n: number) { let count = 0; while (count < n) { count++; } return count; }");
  const tutor = createFunctionTutorPayload(input, {
    flowId: "code-flow:loop-model",
    blockIds: new Map(input.functionLogic.blocks.map((block, index) => [block.id, "block-" + index])),
    edgeIds: new Map(input.functionLogic.edges.map((edge, index) => [edge.id, "edge-" + index])),
    bindingIds: new Map(input.declaration.program.bindings.map((binding, index) => [binding.bindingId, "binding-" + index])),
    createEvidenceToken: () => undefined
  });
  assert.ok(tutor);
  const browser = new Function("projectAnalyzerText", `${getFunctionLogicValuePreviewBrowserSource()}${getFunctionLogicScenarioEvaluatorBrowserSource()}${getFunctionLogicScenarioEvaluationBrowserSource()}${getFunctionTutorBrowserSource()}${getFunctionLogicScenarioWorkspaceBrowserSource()}
    return {run: functionTutorRunScenario, resolve: functionTutorResolveScenarioPaths};`
  )((key: string) => key);
  const seed = { id: "seed-loop", certainty: "exact", inputs: tutor.parameters.map((parameter) => ({ parameterId: parameter.id, value: { kind: "number", value: 2 }, certainty: "exact" })) };
  const path = browser.resolve(tutor, seed, browser.run(tutor, seed))[0];
  assert.equal(path.terminal.value.value, 2);
  const execution = createFunctionExecutionScenarioModeler(tutor).create({ seed, pathIndex: 0, path })!;
  assert.deepEqual(execution.conditions.map((condition) => [condition.outcome, condition.verification]), [["iterate", "checked"], ["iterate", "checked"], ["exit", "checked"]]);
  assert.equal(createFunctionExecutionScenarioModeler(tutor).catalog([{ seed, pathIndex: 0, path }]).coverage.checkedDecisionCount, 2);
});

test("symbolic-only capability suppresses stale checked-prefix claims as well as calculated values", () => {
  const { tutor, row } = fixture();
  tutor.program.blocks[1].kind = "condition"; tutor.program.edges[1].kind = "true";
  row.path.symbolic = false; row.path.scenario.concrete = true;
  Object.assign(row.seed.quality, { checkedEdgeIds: ["save-edge"] });
  Object.assign(row.path.scenario, { decisions: [{ blockId: "fetch", edgeId: "save-edge", label: "input > 0", outcome: "true" }] });
  const catalog = createFunctionExecutionScenarioModeler(tutor).catalog([row]);
  assert.equal(catalog.scenarios[0].conditions[0].verification, "assumed");
  assert.equal(catalog.coverage.checkedDecisionCount, 0);
});

test("a condition's source calls and writes precede its branch-outcome step", () => {
  const { tutor, row } = fixture();
  tutor.program.blocks[1].kind = "condition"; tutor.program.edges[1].kind = "true";
  const execution = createFunctionExecutionScenarioModeler(tutor).create(row)!;
  assert.deepEqual(execution.steps.filter((step) => step.blockId === "fetch").map((step) => step.kind), ["call", "write", "decision"]);
  assert.equal(execution.steps.find((step) => step.kind === "decision")?.decision?.outcome, "true");
});

test("an oversized object key cannot bypass snapshot or representative serialization limits", () => {
  const { tutor, row } = fixture();
  Object.assign(row.seed.inputs[0], { value: { ["x".repeat(100_000)]: 1 } });
  const catalog = createFunctionExecutionScenarioModeler(tutor).catalog([row]);
  assert.ok(JSON.stringify(catalog.scenarios[0].inputs[0].value).length < 1_000);
  assert.ok(catalog.scenarios[0].gaps.some((gap) => gap.code === "value-limit"));
});

test("displaying only twelve conditions does not hide checked loop-exit coverage", () => {
  const tutor = { program: { entryBlockId: "entry", blocks: [
    { blockId: "entry", kind: "entry" }, { blockId: "loop", kind: "loop", label: "count < n" },
    { blockId: "body", kind: "statement" }, { blockId: "return", kind: "return", label: "return count" }
  ], edges: [
    { edgeId: "enter", sourceBlockId: "entry", targetBlockId: "loop", kind: "next" },
    { edgeId: "iterate", sourceBlockId: "loop", targetBlockId: "body", kind: "iterate" },
    { edgeId: "repeat", sourceBlockId: "body", targetBlockId: "loop", kind: "repeat" },
    { edgeId: "exit", sourceBlockId: "loop", targetBlockId: "return", kind: "exit" }
  ] } };
  const row = { seed: { id: "bounded-loop", inputs: [] }, pathIndex: 0, path: {
    blockIds: ["entry", "loop", ...Array.from({ length: 13 }, () => ["body", "loop"]).flat(), "return"],
    edgeIds: ["enter", ...Array.from({ length: 13 }, () => ["iterate", "repeat"]).flat(), "exit"],
    terminal: { kind: "return", blockId: "return", value: 13 }, certainty: "exact", scenario: { concrete: true }
  } };
  const catalog = createFunctionExecutionScenarioModeler(tutor).catalog([row]);
  assert.equal(catalog.scenarios[0].conditions.length, 12);
  assert.equal(catalog.scenarios[0].omittedCounts.conditions, 2);
  assert.equal(catalog.coverage.checkedDecisionCount, 2);
});

test("known object write snapshots preserve safe formatting after copying evaluator values", () => {
  const { tutor, row } = fixture(); tutor.program.evaluationMode = "concrete"; row.path.symbolic = false; row.path.scenario.concrete = true;
  const value = Object.assign(Object.create(null), { count: 2 });
  Object.assign(row.path, { transitions: [{ blockId: "save", targetBindingId: "count", before: { kind: "known", value: Object.assign(Object.create(null), { count: 1 }), origins: [] }, after: { kind: "known", value, origins: [] }, certainty: "exact" }] });
  const execution = createFunctionExecutionScenarioModeler(tutor).create(row)!;
  const format = new Function(`${getBrowserLocalizationSource()}${getFunctionTutorBrowserSource()} return functionTutorValueText;`)();
  assert.equal(format(execution.steps.find((step) => step.blockId === "save" && step.kind === "write")?.after), "{count: 2}");
  value.count = 9;
  assert.equal(format(execution.steps.find((step) => step.blockId === "save" && step.kind === "write")?.after), "{count: 2}");
});

test("analysis invalidations are gaps while source-owned writes with unknown values remain writes", () => {
  const { tutor, row } = fixture(); tutor.program.evaluationMode = "concrete"; row.path.symbolic = false; row.path.scenario.concrete = true;
  Object.assign(row.path, { transitions: [
    { blockId: "fetch", kind: "unknown", targetBindingId: "input", targetName: "input", before: { kind: "known", value: 7 }, after: { kind: "unknown", reason: "unsupported-call" }, certainty: "unknown" },
    { blockId: "save", kind: "unknown", targetBindingId: "count", targetName: "count", before: { kind: "known", value: 1 }, after: { kind: "unknown", reason: "unsupported-value" }, certainty: "unknown" }
  ] });
  const execution = createFunctionExecutionScenarioModeler(tutor).create(row)!;
  assert.equal(execution.steps.some((step) => step.kind === "write" && step.targetName === "input"), false);
  assert.equal(execution.steps.some((step) => step.kind === "write" && step.targetName === "count" && step.after !== undefined), true);
  assert.ok(execution.gaps.some((gap) => gap.code === "unknown-value" && gap.blockId === "fetch"));
});
