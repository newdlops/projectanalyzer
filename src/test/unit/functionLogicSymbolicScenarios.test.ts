/** Real generated-runtime checks for bounded routes, capability gates, and shared root calculations. */
import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionLogicScenarioWorkspaceBrowserSource } from "../../webview/codeFlow/scenarioWorkspace";
import { getFunctionTutorBrowserSource } from "../../webview/codeFlow/tutor";
import { getFunctionLogicScenarioEvaluatorBrowserSource } from "../../webview/codeFlow/valuePreview";
import { evaluateFunctionTutorInputs } from "../../analyzer/functionTutor/inputEvaluation/evaluate";
import type { FunctionTutorDeclarationAnalysis } from "../../analyzer/functionTutor";

type Program = { evaluationMode?: string; entryBlockId: string; blocks: Array<{ blockId: string; kind: string; label: string; operations?: Array<{ kind: string; effectKind: string; summary: string }> }>; edges: Array<{ edgeId: string; sourceBlockId: string; targetBlockId: string; kind: string }> };

/** Uses actual emitted browser functions with a counted interpreter boundary. */
function runtime() {
  return new Function("functionTutorRunScenario", `${getFunctionLogicScenarioWorkspaceBrowserSource()}
    let plans = 0; const originalPlan = functionTutorPlanSymbolicPaths;
    functionTutorPlanSymbolicPaths = (...args) => { plans += 1; return originalPlan(...args); };
    return { plan: functionTutorPlanSymbolicPaths, acquire: acquireFunctionLogicScenarioWorkspace,
      dispose: disposeFunctionLogicScenarioWorkspaces, planCount: () => plans };`
  )(() => { throw new Error("A symbolic-only program must never enter the interpreter"); });
}

function program(blocks: Array<[string, string]>, edges: Array<[string, string, string]>): Program {
  return { evaluationMode: "symbolic-only", entryBlockId: blocks[0][0],
    blocks: blocks.map(([blockId, kind]) => ({ blockId, kind, label: blockId })),
    edges: edges.map(([sourceBlockId, targetBlockId, kind], index) => ({ edgeId: "edge-" + index, sourceBlockId, targetBlockId, kind })) };
}

test("a straight-line no-argument function still has one source-backed symbolic scenario", () => {
  const paths = runtime().plan({ program: program([["entry", "entry"], ["save", "call"], ["return", "return"], ["exit", "exit"]],
    [["entry", "save", "next"], ["save", "return", "next"], ["return", "exit", "return"]]) });
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0].blockIds, ["entry", "save", "return"]);
  assert.equal(paths[0].terminal.kind, "return");
  assert.equal(paths[0].limited, false);
  assert.deepEqual(paths[0].scenario.effects.map((item: { label: string }) => item.label), ["save"]);
});

test("symbolic routes preserve execution order and separate exception outcomes", () => {
  // Intentionally shuffled source storage proves that paths follow edges.
  const paths = runtime().plan({ program: program([["entry", "entry"], ["recovered", "return"], ["finish", "return"], ["work", "call"]],
    [["entry", "work", "next"], ["work", "finish", "next"], ["work", "recovered", "exception"]]) });
  assert.equal(paths.length, 2);
  assert.deepEqual(paths.map((path: { blockIds: string[] }) => path.blockIds), [["entry", "work", "finish"], ["entry", "work", "recovered"]]);
  assert.ok(paths.every((path: { blockIds: string[] }) => !(path.blockIds.includes("finish") && path.blockIds.includes("recovered"))));
});

test("loop and exception alternatives retain their source assumptions", () => {
  const loop = runtime().plan({ program: program([["entry", "entry"], ["loop", "loop"], ["body", "call"], ["exit", "exit"]],
    [["entry", "loop", "next"], ["loop", "body", "iterate"], ["loop", "exit", "exit"], ["body", "loop", "repeat"]]) });
  assert.deepEqual(loop.map((path: { scenario: { decisions: Array<{ outcome: string }> } }) => path.scenario.decisions.map((decision) => decision.outcome)), [["iterate"], ["exit"]]);
  const exception = runtime().plan({ program: program([["entry", "entry"], ["work", "call"], ["finish", "return"], ["recover", "return"]],
    [["entry", "work", "next"], ["work", "finish", "next"], ["work", "recover", "exception"]]) });
  assert.deepEqual(exception.map((path: { scenario: { decisions: Array<{ outcome: string }> } }) => path.scenario.decisions.map((decision) => decision.outcome)), [["next"], ["exception"]]);
});

test("a source call inside a mutation remains a reached effect without value interpretation", () => {
  const data = program([["entry", "entry"], ["assignment", "mutation"], ["return", "return"]],
    [["entry", "assignment", "next"], ["assignment", "return", "next"]]);
  data.blocks[1].operations = [{ kind: "effect", effectKind: "call", summary: "save(clean)" }];
  const paths = runtime().plan({ program: data });
  assert.deepEqual(paths[0].scenario.effects, [{ blockId: "assignment", kind: "call", label: "save(clean)" }]);
});

test("cycle and requested depth limits terminate routes with an explicit limitation", () => {
  const cyclic = program([["entry", "entry"], ["loop", "condition"], ["body", "call"], ["exit", "exit"]],
    [["entry", "loop", "next"], ["loop", "body", "true"], ["loop", "exit", "false"], ["body", "loop", "loop-back"]]);
  const paths = runtime().plan({ program: cyclic });
  assert.ok(paths.some((path: { limited: boolean }) => path.limited));
  assert.ok(paths.some((path: { terminal: { kind: string }; limited: boolean }) => path.terminal.kind === "exit" && !path.limited));
  const shallow = runtime().plan({ program: cyclic }, { maxDepth: 2 });
  assert.ok(shallow.length > 0 && shallow.every((path: { blockIds: string[]; limited: boolean }) => path.blockIds.length <= 2 && path.limited));
});

test("one root caches symbolic plans across seeds and keeps resultRevision stable during navigation", () => {
  const browser = runtime();
  const tutor = { id: "symbolic-root", program: program([["entry", "entry"], ["return", "return"]], [["entry", "return", "next"]]),
    parameters: [], seeds: [1, 2, 3].map((id) => ({ id: "seed-" + id, source: "type", inputs: [], certainty: "unknown" })) };
  const workspace = browser.acquire("root", tutor);
  assert.equal(workspace.read().resultRevision, 0);
  assert.equal(browser.planCount(), 0, "idle mount must remain calculation-free");
  workspace.acquire();
  assert.equal(workspace.read().phase, "ready");
  assert.equal(workspace.read().results.size, 3);
  assert.equal(browser.planCount(), 1, "seed count must not multiply graph planning");
  const revision = workspace.read().resultRevision;
  assert.ok(revision > 0);
  workspace.select("seed-2", 0); workspace.markModified(); workspace.setPlaybackState("seed-2", 0, "playing");
  workspace.setSnapshot(new Map([["input", "42"]])); workspace.clearPlaybackState();
  assert.equal(workspace.read().resultRevision, revision);
  assert.equal(browser.acquire("root", tutor), workspace);
  workspace.release(); workspace.acquire();
  assert.equal(browser.planCount(), 1);
  assert.equal(workspace.appendSeeds([{ id: "model", source: "model", inputs: [] }]), 1);
  assert.ok(workspace.read().resultRevision > revision);
  assert.equal(browser.planCount(), 1);
  browser.dispose();
  assert.equal(workspace.read().results.size, 0);
});

test("symbolic-only capability blocks host and direct browser concrete evaluation", () => {
  const declaration = { language: "typescript", program: { evaluationMode: "symbolic-only" } } as FunctionTutorDeclarationAnalysis;
  assert.deepEqual(evaluateFunctionTutorInputs(declaration, []), {
    status: "partial", blockIds: [], edgeIds: [], decisions: [], reason: "language-gap"
  });
  const run = new Function(`${getFunctionTutorBrowserSource()}; return functionTutorRunScenario;`)();
  assert.deepEqual(run({ program: { evaluationMode: "symbolic-only" } }, { inputs: [] }), []);
  const calculate = new Function(`${getFunctionLogicScenarioEvaluatorBrowserSource()}; return calculateFunctionLogicScenario;`)();
  const values = calculate({ tutor: { program: { evaluationMode: "symbolic-only" } } }, new Map(), new Map());
  assert.equal(values.recordsByBlockId.size, 0);
  assert.equal(values.inputStateByBindingId.size, 0);
  assert.equal(values.processed, 0);
});
