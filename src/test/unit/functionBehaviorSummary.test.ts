/** Source-backed Summary regressions through the real Tutor builder and opaque projection. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../analyzer/functionTutor";
import { buildFunctionTutorModel, CodeFlowInsightCache } from "../../application/codeFlow";
import { createFunctionTutorPayload } from "../../application/codeFlow/functionTutor";
import { buildFunctionBehaviorSummary } from "../../application/codeFlow/functionTutor/behaviorSummary";
import type { FunctionTutorBuildModel, FunctionTutorCalleeFact } from "../../application/codeFlow/functionTutor/types";
import type { SymbolNode } from "../../shared/types";
import { createGraph } from "./helpers/projectReadingGuideFixtures";

// This contract view lets the first red tests exercise the existing builder
// before the optional production field is introduced.
type Summary = {
  status: string;
  purpose: { basis: string; sourcePreview?: string; presentationKey?: string };
  inputs: Array<{ name: string; defaultText?: string }>;
  outcomes: Array<{ kind: string; sourcePreview: string; conditions: unknown[]; blockIds: string[] }>;
  steps: Array<{ kind: string; sourcePreview: string; scope: string; blockIds: string[] }>;
  impacts: Array<{ kind: string; sourcePreview: string; blockIds: string[] }>;
};

test("Tutor builder supplies authored purpose and source outcomes without a second source read", async () => {
  const text = [
    "/** Returns the source count when ready. */",
    "export function saveEverything(count: number = 1, ready: boolean = false) {",
    "  if (!ready) return 0;",
    "  count += 1;",
    "  return count;",
    "}"
  ].join("\n");
  const { model, reads } = await build(text);
  const summary = (model as FunctionTutorBuildModel & { behaviorSummary?: Summary }).behaviorSummary;
  assert.ok(summary, "the real builder must include a static behavior summary");
  assert.equal(reads, 1, "Summary uses the source/context already collected by Tutor");
  assert.equal(summary.purpose.basis, "documentation");
  assert.equal(summary.purpose.sourcePreview, "Returns the source count when ready.");
  assert.deepEqual(summary.inputs.map((input) => input.name), ["count", "ready"]);
  assert.equal(summary.inputs[0].defaultText, "1");
  const returns = summary.outcomes.filter((outcome) => outcome.kind === "return");
  assert.equal(returns.length, 2, "alternative return source forms stay separate");
  assert.ok(returns.some((outcome) => outcome.conditions.length > 0));
  assert.ok(summary.steps.some((step) => step.kind === "condition"));
});

test("structural Summary never guesses business intent from the callable name or enters a defined callback", async () => {
  const { model } = await build([
    "export function saveEverything(count: number) {",
    "  const later = () => { count += 20; hidden(count); };",
    "  if (count < 0) return 0;",
    "  count += 1;",
    "  return count;",
    "}"
  ].join("\n"));
  const summary = (model as FunctionTutorBuildModel & { behaviorSummary?: Summary }).behaviorSummary;
  assert.ok(summary);
  assert.equal(summary.purpose.basis, "structure");
  assert.equal(summary.purpose.presentationKey, "summary-purpose-structure");
  assert.ok(!JSON.stringify(summary.purpose).includes("saveEverything"));
  assert.ok(!summary.impacts.some((item) => item.sourcePreview.includes("hidden") || item.sourcePreview.includes("20")));
  assert.ok(!summary.steps.some((item) => item.sourcePreview.includes("hidden") || item.sourcePreview.includes("20")), "creating a callback must not expose its deferred body as a current execution stage");
});

test("Summary references and evidence become snapshot-local identities during projection", async () => {
  const { model } = await build("export function saveEverything(count: number) { if (count < 0) throw count; return count; }");
  const blocks = new Map(model.functionLogic.blocks.map((block, index) => [block.id, `block:${index}`]));
  const edges = new Map(model.functionLogic.edges.map((edge, index) => [edge.id, `edge:${index}`]));
  const bindings = new Map((model.functionLogic.valueBindings || []).map((binding, index) => [binding.id, `binding:${index}`]));
  const payload = createFunctionTutorPayload(model, { flowId: "code-flow:summary", blockIds: blocks, edgeIds: edges, bindingIds: bindings, createEvidenceToken: () => "code-evidence:summary" });
  const summary = (payload as unknown as { behaviorSummary?: Summary })?.behaviorSummary;
  assert.ok(summary);
  assert.ok(summary.outcomes.every((item) => item.blockIds.every((id) => [...blocks.values()].includes(id))));
  assert.ok(!JSON.stringify(summary).includes("/workspace"));
  assert.ok(!JSON.stringify(summary).includes(model.declaration.functionNode.id));
  assert.ok(payload?.evidence.some((item) => item.token === "code-evidence:summary"));
});

test("common Summary retains each guarded write but clears alternative guards at their shared return", async () => {
  const { model } = await build("export function saveEverything(count: number) { let value = 0; if (count > 0) { value = 1; } else { value = 2; } return value; }");
  const summary = model.behaviorSummary!;
  const writes = summary.impacts.filter((item) => item.kind === "write" && item.sourcePreview !== "value = 0");
  assert.equal(writes.length, 2); assert.ok(writes.every((item) => item.conditions.length === 1));
  assert.notEqual(writes[0].conditions[0].edgeId, writes[1].conditions[0].edgeId);
  assert.equal(summary.outcomes.find((item) => item.kind === "return")?.conditions.length, 0);
});

test("deferred lambda arguments cannot contribute an immediate write", async () => {
  const { model } = await build("export function saveEverything(count: number) { observe(() => { count += 20; }); return count; }");
  assert.ok(!model.behaviorSummary!.impacts.some((item) => item.kind === "write" && item.sourcePreview.includes("20")));
  assert.ok(model.behaviorSummary!.impacts.some((item) => item.kind === "call" || item.kind === "effect"));
});

test("an early return and fallthrough retain distinct source outcomes", async () => {
  const { model } = await build("export function saveEverything(count: number) { if (count < 0) return 0; count += 1; }");
  assert.deepEqual(model.behaviorSummary!.outcomes.map((item) => item.kind), ["return", "exit"]);
  const exit = model.behaviorSummary!.outcomes.find((item) => item.kind === "exit")!;
  assert.ok(exit.conditions.some((condition) => condition.outcome === "false"));
});

test("display limits preserve omission counts separately from analysis limits and source previews", async () => {
  const parameters = Array.from({ length: 10 }, (_, index) => `p${index}: number = ${index}`).join(", ");
  const branches = Array.from({ length: 12 }, (_, index) => `if (p0 === ${index}) return ${index};`).join("\n");
  const { model } = await build(`/** ${"Source documentation. ".repeat(40)} */\nexport function saveEverything(${parameters}) {\n${branches}\nreturn p0;\n}`);
  const summary = buildFunctionBehaviorSummary({ declaration: { ...model.declaration, gaps: [] }, functionLogic: { ...model.functionLogic, gaps: [] }, context: model.context, gaps: [] });
  assert.equal(summary.inputs.length, 8); assert.equal(summary.omittedCounts.inputs, 2);
  assert.equal(summary.steps.length, 5); assert.ok(summary.omittedCounts.steps > 0);
  assert.equal(summary.outcomes.length, 8); assert.equal(summary.omittedCounts.outcomes, 5);
  assert.equal(summary.limited, false, "display truncation does not mean the graph analysis was limited: " + JSON.stringify(model.functionLogic.gaps));
  assert.ok(summary.purpose.sourcePreview!.length <= 480);
  assert.ok([...summary.steps, ...summary.outcomes, ...summary.impacts].every((item) => item.sourcePreview.length <= 240 && item.blockIds.length <= 24 && item.edgeIds.length <= 24 && item.evidence.length <= 8));
  const limited = buildFunctionBehaviorSummary({ declaration: model.declaration, functionLogic: model.functionLogic, context: model.context, maxDepth: 1 });
  assert.equal(limited.limited, true); assert.equal(limited.status, "partial"); assert.ok(limited.gaps.some((gap) => gap.presentationKey === "summary-gap-limit"));
});

test("optional evaluation mode survives projection and changes the semantic fingerprint", async () => {
  const { model } = await build("export function saveEverything(count: number) { return count / 2; }");
  const context = { flowId: "code-flow:summary" as const, blockIds: new Map(model.functionLogic.blocks.map((block, index) => [block.id, `block:${index}`])), edgeIds: new Map(model.functionLogic.edges.map((edge, index) => [edge.id, `edge:${index}`])), bindingIds: new Map((model.functionLogic.valueBindings || []).map((binding, index) => [binding.id, `binding:${index}`])), createEvidenceToken: () => "code-evidence:summary" as const };
  const legacy = createFunctionTutorPayload(model, context)!; assert.equal(legacy.program.evaluationMode, undefined);
  const symbolic = createFunctionTutorPayload({ ...model, declaration: { ...model.declaration, program: { ...model.declaration.program, evaluationMode: "symbolic-only" } } }, context)!;
  assert.equal(JSON.parse(JSON.stringify(symbolic)).program.evaluationMode, "symbolic-only"); assert.notEqual(symbolic.fingerprint, legacy.fingerprint);
  const oldModel = { ...model, behaviorSummary: undefined }; const oldPayload = createFunctionTutorPayload(oldModel, context)!;
  assert.equal(oldPayload.behaviorSummary, undefined); assert.equal(oldPayload.version, 3);
});

test("Kotlin return-expression calls survive Summary without a resolved graph target", async () => {
  const { model, reads } = await buildKotlin("fun read(service: Service): Int = service.fetch()");
  const callsite = model.functionLogic.callsites.find((call) => call.calleeText === "service.fetch");
  assert.ok(callsite); assert.equal(callsite.confidence, "inferred");
  const terminal = model.declaration.program.blocks.find((block) => block.terminal?.kind === "return")!;
  assert.ok(terminal.operations.some((operation) => operation.kind === "effect" && operation.effectKind === "call"));
  assert.equal(model.context.callees.length, 0, "the graph contains no resolved receiver target");
  assert.equal(reads, 1, "Summary reuses the existing source facts");
  const calls = model.behaviorSummary!.impacts.filter((impact) => impact.kind === "call");
  assert.equal(calls.length, 1, "the return block and its effect/callsite facts describe one invocation");
  assert.equal(calls[0].sourcePreview, "service.fetch()");
  assert.equal(calls[0].certainty, "inferred");
  assert.equal(calls[0].blockIds[0], terminal.blockId);
  assert.equal(model.behaviorSummary!.purpose.presentationParams?.calls, 1);
  assert.equal(model.behaviorSummary!.purpose.certainty, "inferred");
  const programOnly = buildFunctionBehaviorSummary({ declaration: model.declaration, functionLogic: { ...model.functionLogic, callsites: [] }, context: model.context });
  assert.deepEqual(programOnly.impacts.filter((impact) => impact.kind === "call").map((impact) => [impact.sourcePreview, impact.certainty]), [["service.fetch()", "inferred"]]);
  const payload = createFunctionTutorPayload(model, { flowId: "code-flow:summary", blockIds: new Map(model.functionLogic.blocks.map((block, index) => [block.id, `block:${index}`])), edgeIds: new Map(model.functionLogic.edges.map((edge, index) => [edge.id, `edge:${index}`])), bindingIds: new Map(), createEvidenceToken: () => "code-evidence:summary" })!;
  assert.ok(payload.behaviorSummary!.impacts[0].evidenceTokens.includes("code-evidence:summary"));
  assert.ok(!JSON.stringify(payload.behaviorSummary).includes("/workspace"));
  assert.ok(!JSON.stringify(payload.behaviorSummary).includes(terminal.blockId));
});

test("Kotlin Summary counts nested argument invocations once and excludes lambda/local bodies", async () => {
  const { model } = await buildKotlin([
    "fun read(service: Service): Int {",
    "  fun later() = service.hidden()",
    "  val callback = { service.deferred() }",
    "  service.observe { service.hiddenAgain() }",
    "  return if (service.ready()) service.fetch(service.fetch()) else service.cached()",
    "}"
  ].join("\n"));
  const calls = model.behaviorSummary!.impacts.filter((impact) => impact.kind === "call");
  assert.deepEqual(calls.map((impact) => impact.sourcePreview).sort(), ["service.cached()", "service.fetch()", "service.fetch()", "service.observe()", "service.ready()"]);
  assert.equal(new Set(calls.map((impact) => impact.id)).size, calls.length, "two same-name calls have separate source occurrence identities");
  const fetches = calls.filter((impact) => impact.sourcePreview === "service.fetch()");
  const cached = calls.find((impact) => impact.sourcePreview === "service.cached()")!;
  assert.ok(fetches.every((impact) => impact.conditions.some((condition) => condition.outcome === "true")));
  assert.ok(cached.conditions.some((condition) => condition.outcome === "false"));
  assert.ok(!calls.some((impact) => /hidden|deferred/u.test(impact.sourcePreview)));
  assert.equal(model.behaviorSummary!.purpose.presentationParams?.calls, 5);
  assert.equal(model.behaviorSummary!.steps.find((step) => step.sourcePreview.startsWith("service.observe"))?.certainty, "inferred", "a call stage retains unresolved receiver certainty");
});

test("callee context enriches only one exact source occurrence inside a shared Kotlin return block", async () => {
  const { model } = await buildKotlin("fun read(service: Service) = service.fetch(helper())");
  const helper = model.functionLogic.callsites.find((call) => call.calleeName === "helper")!;
  const fetch = model.functionLogic.callsites.find((call) => call.calleeName === "fetch")!;
  assert.ok(helper && fetch); assert.notDeepEqual(helper.range, fetch.range);
  const helperSource = model.behaviorSummary!.impacts.find((impact) => impact.sourcePreview === "helper()")!;
  const fetchSource = model.behaviorSummary!.impacts.find((impact) => impact.sourcePreview === "service.fetch()")!;
  assert.equal(helperSource.blockIds[0], fetchSource.blockIds[0], "nested calls share one terminal block");
  const callee: FunctionTutorCalleeFact = { nodeId: "function:helper", name: "helper", kind: "local", relation: "call", callCount: 1, certainty: "exact", sourceBlockId: helperSource.blockIds[0], evidence: [{ kind: "direct-callee", certainty: "exact", filePath: helper.filePath, range: helper.range, summary: "Resolved local helper call." }] };
  const summarize = (callees: FunctionTutorCalleeFact[], calls = model.functionLogic.callsites) => buildFunctionBehaviorSummary({ declaration: model.declaration, functionLogic: { ...model.functionLogic, callsites: calls }, context: { ...model.context, callees } });
  const summary = summarize([callee]);
  const receiver = summary.impacts.find((impact) => impact.sourcePreview === "service.fetch()")!;
  const local = summary.impacts.find((impact) => impact.sourcePreview === "helper()")!;
  assert.equal(receiver.certainty, "inferred", "the helper's resolved edge cannot resolve its outer receiver call");
  assert.ok(!receiver.evidence.some((evidence) => evidence.kind === "direct-callee"));
  assert.deepEqual(local.evidence.find((evidence) => evidence.kind === "direct-callee")?.range, helper.range);
  assert.equal(summary.purpose.presentationParams?.calls, 2);
  assert.equal(summary.purpose.certainty, "inferred");
  const conflicting = summarize([callee, { ...callee, kind: "external", certainty: "inferred" }]);
  assert.equal(conflicting.impacts.find((impact) => impact.sourcePreview === "helper()")?.kind, "call", "a source occurrence is enriched at most once");
  assert.equal(conflicting.impacts.length, 2, "repeated context descriptions never append another source invocation");
  const noMatch = summarize([{ ...callee, evidence: [{ ...callee.evidence[0], range: model.declaration.functionNode.range }] }]);
  assert.equal(noMatch.impacts.length, 2);
  assert.ok(noMatch.impacts.every((impact) => !impact.evidence.some((evidence) => evidence.kind === "direct-callee")), "a containing function range cannot identify either call");
  const owner = model.functionLogic.blocks.find((block) => block.id === helperSource.blockIds[0])!;
  const ambiguous = summarize([{ ...callee, evidence: [{ ...callee.evidence[0], range: owner.range }] }], []);
  assert.equal(ambiguous.impacts.length, 2);
  assert.ok(ambiguous.impacts.every((impact) => !impact.evidence.some((evidence) => evidence.kind === "direct-callee")), "effect descriptions with the same enclosing range cannot be distinguished");
  assert.equal(ambiguous.impacts.find((impact) => impact.sourcePreview === "service.fetch()")?.certainty, "inferred");
});

test("normal Kotlin finally cleanup retains its typed scope through a nested conditional", async () => {
  const { model } = await buildKotlin([
    "fun read(service: Service) {",
    "  try { work() } catch (error: Exception) { failed() }",
    "  finally { if (service.ready()) { release() } }",
    "}"
  ].join("\n"));
  const cleanup = model.functionLogic.blocks.find((block) => block.label === "release()")!;
  assert.ok(cleanup);
  assert.ok(!model.functionLogic.edges.some((edge) => edge.kind === "finally"), "normal cleanup is a next continuation, not an alternate finally edge");
  const enclosing = model.functionLogic.blocks.find((block) => block.id === cleanup.parentBlockId)!;
  assert.equal(enclosing.branchPresentation?.key, "logic-edge-finally");
  const summaryCleanup = model.behaviorSummary!.impacts.find((impact) => impact.sourcePreview === "release()")!;
  assert.ok(summaryCleanup); assert.equal(summaryCleanup.scope, "finally");
  assert.equal(model.behaviorSummary!.steps.find((step) => step.blockIds[0] === cleanup.id)?.scope, "finally");
});

test("normal Python finally cleanup shares the typed lexical scope contract", async () => {
  const source = ["def read():", "    try:", "        work()", "    except Exception:", "        failed()", "    finally:", "        if ready():", "            release()"].join("\n");
  const lines = source.split("\n");
  const node: SymbolNode = { id: "function:read", kind: "function", name: "read", qualifiedName: "read", language: "python", filePath: "/workspace/src/summary.py", range: { startLine: 0, startCharacter: 0, endLine: lines.length - 1, endCharacter: lines.at(-1)!.length }, selectionRange: { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 8 } };
  const { model } = await buildSource(source, node);
  const cleanup = model.functionLogic.blocks.find((block) => block.label === "release()")!;
  assert.ok(cleanup);
  assert.ok(!model.functionLogic.edges.some((edge) => edge.kind === "finally"));
  const enclosing = model.functionLogic.blocks.find((block) => block.id === cleanup.parentBlockId)!;
  assert.equal(enclosing.branchPresentation?.key, "logic-edge-finally");
  assert.equal(model.behaviorSummary!.impacts.find((impact) => impact.sourcePreview === "release()")?.scope, "finally");
});

/** Builds real analysis facts and records the existing Tutor source acquisition count. */
async function build(sourceText: string) {
  const lines = sourceText.split("\n"); const firstLine = lines.findIndex((line) => line.startsWith("export function"));
  const node: SymbolNode = { id: "function:saveEverything", kind: "function", name: "saveEverything", qualifiedName: "saveEverything", language: "typescript", filePath: "/workspace/src/summary.ts", range: { startLine: firstLine, startCharacter: 0, endLine: lines.length - 1, endCharacter: lines.at(-1)!.length }, selectionRange: { startLine: firstLine, startCharacter: 16, endLine: firstLine, endCharacter: 30 } };
  return buildSource(sourceText, node);
}

/** Kotlin fixture keeps receiver targets unresolved to exercise syntax/program facts alone. */
async function buildKotlin(sourceText: string) {
  const lines = sourceText.split("\n");
  const node: SymbolNode = { id: "function:read", kind: "function", name: "read", qualifiedName: "read", language: "kotlin", filePath: "/workspace/src/summary.kt", range: { startLine: 0, startCharacter: 0, endLine: lines.length - 1, endCharacter: lines.at(-1)!.length }, selectionRange: { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 8 } };
  return buildSource(sourceText, node);
}

/** Runs the production builder with a graph that supplies no inferred callee edges. */
async function buildSource(sourceText: string, node: SymbolNode) {
  const logic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic: logic });
  const graph = createGraph({ files: [node.filePath], callables: [node] }); const insights = new CodeFlowInsightCache().get(graph); let reads = 0;
  const model = await buildFunctionTutorModel({ graph, declaration, functionLogic: logic, architectureIndex: insights.functionArchitecture, semanticFlows: insights.semanticFlows, functionIndex: insights.functionIndex, readSourceText: async () => { reads += 1; return sourceText; } });
  return { model, reads };
}
