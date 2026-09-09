/**
 * Contract tests for the browser-only shared Scenario Workspace boundary.
 * They keep its lifecycle, identity-only application, and responsive/a11y
 * surface explicit without requiring an Extension Host or source execution.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionLogicScenarioWorkspaceBrowserSource } from "../../webview/codeFlow/scenarioWorkspace";
import { getFunctionLogicDataFlowBrowserSource } from "../../webview/codeFlow/dataFlow";
import { getFunctionVisualizerBrowserSource } from "../../webview/functionVisualizer/functionVisualizerBrowserSource";
import { getFunctionLogicValueFlowPlaybackBrowserSource } from "../../webview/codeFlow/dataFlow";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import { getFunctionTutorBrowserSource, getFunctionTutorStyles } from "../../webview/codeFlow/tutor";
import { getFunctionLogicScenarioEvaluationBrowserSource } from "../../webview/codeFlow/scenarioEvaluation";
import { getFunctionLogicScenarioEvaluatorBrowserSource, getFunctionLogicValuePreviewBrowserSource } from "../../webview/codeFlow/valuePreview";
import { createFunctionTutorPayload } from "../../application/codeFlow/functionTutor";
import { buildInputModel } from "./helpers/neuralScenarioFixtures";

test("checked nested parameter paths retain both concrete returns in the scenario explanation", async () => {
  const model = await buildInputModel('export function inspect(x: number, y: number, z: number) {\n if (x * 5 + 3 === 188) {\n  if (y * 7 - 2 === 215) {\n   if (z * 3 + 4 === 55) return "reached";\n  }\n }\n return "ordinary";\n}');
  const payload = createFunctionTutorPayload(model, {
    flowId: "code-flow:nested-parameter-test",
    blockIds: new Map(model.functionLogic.blocks.map((block, index) => [block.id, `block-${index}`])),
    edgeIds: new Map(model.functionLogic.edges.map((edge, index) => [edge.id, `edge-${index}`])),
    bindingIds: new Map(model.declaration.program.bindings.map((binding, index) => [binding.bindingId, `binding-${index}`])),
    createEvidenceToken: () => undefined
  })!;
  const browser = new Function("projectAnalyzerText", `${getFunctionLogicValuePreviewBrowserSource()}${getFunctionLogicScenarioEvaluatorBrowserSource()}${getFunctionLogicScenarioEvaluationBrowserSource()}${getFunctionTutorBrowserSource()}${getFunctionLogicScenarioWorkspaceBrowserSource()}
    return { run: functionTutorRunScenario, resolve: functionTutorResolveScenarioPaths, effect: functionTutorScenarioEffectText };`)(
    (key: string, params?: { value?: string }) => key + ":" + (params?.value ?? ""));
  for (const [z, expected] of [[17, "reached"], [16, "ordinary"]] as const) {
    const values = [37, 31, z];
    const seed = { source: "model", certainty: "inferred", inputs: payload.parameters.map((parameter, index) => ({
      parameterId: parameter.id, value: { kind: "number", value: values[index] }, certainty: "inferred" })) };
    const evaluated = browser.run(payload, seed); const paths = browser.resolve(payload, seed, evaluated);
    assert.equal(paths.length, 1); assert.equal(paths[0].limited, false); assert.equal(paths[0].scenario.concrete, true);
    assert.equal(paths[0].scenario.decisions.length, 3); assert.equal(browser.effect(paths[0]), "may-return:" + expected);
    const limited = browser.resolve(payload, seed, evaluated.map((path: object) => ({ ...path, limited: true, certainty: "unknown" })));
    assert.ok(limited.every((path: { scenario?: { concrete?: boolean } }) => !path.scenario?.concrete));
  }
});

test("neural cases remain visible when symbolic paths exhaust the table budget", () => {
  const rows = new Function(`${getFunctionLogicScenarioWorkspaceBrowserSource()}; return readFunctionTutorScenarioRows;`)();
  const seeds = Array.from({ length: 12 }, (_, index) => ({ id: `seed-${index}`, source: "type" }));
  const results = new Map(seeds.map((seed) => [seed.id, Array.from({ length: 12 }, () => ({ symbolic: true }))]));
  const neural = { id: "neural", source: "model" }; results.set(neural.id, [{ symbolic: false }]);
  const visible = rows({ results }, [...seeds, neural]);
  assert.equal(visible.length, 48); assert.equal(visible[0].seed.id, "neural");
});

test("Scenario Workspace keeps one root/fingerprint cache and no Host or dynamic execution boundary", () => {
  const source = getFunctionLogicScenarioWorkspaceBrowserSource();
  assert.match(source, /functionLogicScenarioWorkspaceRegistry/);
  assert.match(source, /sessionKey \+ "::" \+ fingerprint/);
  assert.match(source, /functionTutorRunScenario/);
  assert.doesNotMatch(source, /postMessage|acquireVsCodeApi|\beval\s*\(|Function\s*\(/);
});

test("Apply Inputs uses opaque program binding identities and Apply & Play owns scenario frames", () => {
  const source = getFunctionLogicDataFlowBrowserSource();
  assert.match(source, /tutor\?\.program\?\.bindings/);
  assert.match(source, /readFunctionLogicScenarioSeedInputs/);
  assert.match(source, /__scenario_workspace__/);
  assert.match(source, /readFunctionLogicScenarioStoryFrames/);
  assert.match(source, /const previousOwner = ownerFor\(previous\)/);
  assert.match(source, /previousOwner && previousOwner === frameOwner/);
});

test("symbolic Scenario stories preserve calculation, decision, effect, and result order", () => {
  const createStoryHelpers = new Function(
    "projectAnalyzerText",
    "functionTutorScenarioTitle",
    "functionTutorScenarioEffectText",
    "readFunctionLogicValuePreview",
    `${getFunctionLogicDataFlowBrowserSource()}\nreturn { readFunctionLogicSymbolicScenarioStoryFrames, findFunctionLogicPlaybackPath };`
  ) as (...dependencies: Array<(...args: unknown[]) => unknown>) => {
    readFunctionLogicSymbolicScenarioStoryFrames: (...args: unknown[]) => Array<{ type: string; block?: { id: string } }>;
    findFunctionLogicPlaybackPath: (...args: unknown[]) => unknown;
  };
  const text = (key: unknown) => String(key);
  const helpers = createStoryHelpers(text, () => "Delete then create", () => "delete → create", () => undefined);
  const blocks = [
    { id: "entry", kind: "entry", label: "Enter" },
    { id: "calculate", kind: "mutation", label: "existing_events = …", valueChanges: [{ target: "existing_events", operator: "assign", value: "{…}", confidence: "exact" }] },
    { id: "delete-decision", kind: "condition", label: "if events_to_delete" },
    { id: "delete-effect", kind: "effect", label: "bulk_delete(…)" },
    { id: "create-decision", kind: "condition", label: "if events_to_add" },
    { id: "create-effect", kind: "effect", label: "bulk_create(…)" },
    { id: "exit", kind: "exit", label: "Exit" }
  ];
  const path = {
    blockIds: blocks.map((block) => block.id), transitions: [], certainty: "inferred",
    scenario: {
      ordinal: 4,
      decisions: [
        { blockId: "delete-decision", label: "if events_to_delete", outcome: "true" },
        { blockId: "create-decision", label: "if events_to_add", outcome: "true" }
      ],
      effects: [
        { blockId: "delete-effect", label: "bulk_delete(…)" },
        { blockId: "create-effect", label: "bulk_create(…)" }
      ]
    }
  };
  const frames = helpers.readFunctionLogicSymbolicScenarioStoryFrames(
    path,
    { program: { bindings: [] } },
    new Map(),
    new Map(blocks.map((block) => [block.id, block])),
    undefined
  );
  assert.deepEqual(frames.map((frame) => frame.type), [
    "scene", "change", "decision", "effect", "decision", "effect", "result"
  ]);
  assert.deepEqual(frames.map((frame) => frame.block?.id), blocks.map((block) => block.id));

  const visiblePath = { classList: { contains: () => false } };
  const record = { flow: { confidence: "exact" }, path: visiblePath };
  assert.equal(helpers.findFunctionLogicPlaybackPath(
    new Map(),
    new Map([["entry→calculate", record]]),
    "__scenario_workspace__",
    frames[0],
    frames[1]
  ), record);
});

test("compound root context constructs and verifies scenario identities without suffix matching", () => {
  const source = getFunctionVisualizerBrowserSource();
  assert.match(source, /resolveScenarioBindingId/);
  assert.match(source, /createCompoundBindingId\(rootScopeId, bindingId\)/);
  assert.match(source, /resolveScenarioBlockId/);
  assert.match(source, /createCompoundEdgeId\(rootScopeId, edgeId\)/);
});

test("Apply & Play starts the existing playback scheduler after making its first scenario frame active", () => {
  const source = getFunctionLogicValueFlowPlaybackBrowserSource();
  assert.match(source, /playFromStart\(\) \{[\s\S]*setActive\([\s\S]*play\(\);/);
});

test("Scenario Workspace exposes keyboard rows, live states, identity snapshots, and narrow labeled cells", () => {
  const source = getFunctionLogicScenarioWorkspaceBrowserSource();
  assert.match(source, /aria-current/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /state\.phase/);
  assert.match(source, /setSnapshot/);
  assert.match(source, /onRestore/);
  assert.match(source, /dataset\.label/);
  assert.match(source, /Apply & Play|apply-play/);
  assert.match(source, /logic-scenario-workspace-row-selector/);
  assert.match(source, /logic-scenario-workspace-play/);
  assert.match(source, /callbacks\.onPreview\?\.\(session\.selected\(\)\.path\);[\s\S]*callbacks\.onApplyPlay/);
  assert.match(source, /play\.disabled = unavailable \|\| isPlaying/);
  assert.match(source, /parameter\.name \+ \(parameter\.typeText \? " · " \+ parameter\.typeText/);
});

test("Function Guide mirrors path rows instead of collapsing each seed to its first path", () => {
  const source = getFunctionTutorBrowserSource();
  const styles = getFunctionTutorStyles();
  assert.match(source, /readFunctionTutorScenarioRows\(workspaceState \|\| \{ results: resultsBySeed \}, seeds\)/);
  assert.match(source, /const columnKeys = \["scenario", "path-conditions", "expected-effects", "evidence"\]/);
  assert.match(source, /item\.pathIndex === selectedPathIndex/);
  assert.match(source, /workspace\?\.select\(seed\.id, item\.pathIndex\)/);
  assert.match(source, /evidence\.textContent = projectAnalyzerText\(path\?\.symbolic \? "scenario-symbolic" : certainty\)/);
  assert.doesNotMatch(source, /const primary = result\?\.\[0\]/);
  assert.doesNotMatch(source, /resultsBySeed\.get\(selectedSeedId\)\?\.\[0\]/);
  assert.match(styles, /container: function-guide \/ inline-size/);
  assert.match(styles, /@container function-guide \(max-width: 560px\)/);
});

test("Scenario rows flatten every seed path and retain the exact selected path", () => {
  const source = getFunctionLogicScenarioWorkspaceBrowserSource();
  assert.match(source, /for \(let pathIndex = 0; pathIndex < paths\.length; pathIndex \+= 1\)/);
  assert.match(source, /rows\.push\(\{ seed, pathIndex, path: paths\[pathIndex\] \}\)/);
  assert.match(source, /item\.pathIndex === selected\.pathIndex/);
  assert.match(source, /session\.select\(seed\.id, item\.pathIndex\)/);
  assert.match(source, /setPlaybackState\(seedId, pathIndex, nextPhase\)/);
  assert.doesNotMatch(source, /paths\?\.\[0\]/);
});

test("Scenario row action ARIA names include the localized current action state", () => {
  const source = getFunctionLogicScenarioWorkspaceBrowserSource();
  assert.match(source, /const actionState = unavailable \? projectAnalyzerText\("scenario-workspace-play-unavailable-action"\)/);
  assert.match(source, /isPlaying \? projectAnalyzerText\("scenario-workspace-playing"\)/);
  assert.match(source, /isPaused \? projectAnalyzerText\("scenario-workspace-paused-action"\)/);
  assert.match(source, /isComplete \? projectAnalyzerText\("replay"\)/);
  assert.match(source, /"scenario-workspace-play-title", \{ scenario: title, state: actionState \}/);
  assert.match(source, /play\.setAttribute\("aria-label", play\.title\)/);
});

test("Scenario replay action state has finite English and Korean browser copy", () => {
  const catalog = getBrowserLocalizationSource();
  assert.match(catalog, /"replay":"Replay"/);
  assert.match(catalog, /"replay":"다시 재생"/);
});

test("idle Scenario rows use explicit ready copy instead of a calculating outcome", () => {
  const source = getFunctionLogicScenarioWorkspaceBrowserSource();
  // This branch runs before activation: a seed has no path, so it must choose
  // the finite workspace status rather than delegate to outcomeText(undefined).
  assert.match(source, /path \? functionTutorScenarioConditionText\(path\) : projectAnalyzerText\(state\.phase === "idle" \? "scenario-workspace-idle"/);
  assert.doesNotMatch(source, /!path \? functionTutorScenarioOutcomeText\(path\)/);
  assert.match(source, /state\.phase === "calculating" \? projectAnalyzerText\("calculating"\)/);
});

test("Scenario Workspace refreshes its retained landmark label for both locales", () => {
  const source = getFunctionLogicScenarioWorkspaceBrowserSource();
  assert.match(source, /section\.setAttribute\("aria-label", projectAnalyzerText\("scenario-workspace"\)\)/);
  assert.match(source, /function render\(\)/);
});

test("Scenario Workspace activates once from direct focus or pointer interaction, never at mount", () => {
  const source = getFunctionLogicScenarioWorkspaceBrowserSource();
  assert.match(source, /let activated = false/);
  assert.match(source, /section\.addEventListener\("focusin", activate\)/);
  assert.match(source, /section\.addEventListener\("pointerdown", activate\)/);
  assert.match(source, /if \(activated\) return; activated = true; session\.acquire\(\)/);
  assert.match(source, /if \(phase === "paused"\) phase = "idle";[\s\S]*calculate\(\);/);
  assert.doesNotMatch(source, /acquire\(\) \{[^}]*calculate\(\); notify\(\);/);
});
