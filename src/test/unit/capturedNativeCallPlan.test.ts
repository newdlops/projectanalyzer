/** Actual Rust graph/capture plus whole parser call facts; these fixtures never execute subject functions or a neural model. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { createCapturedFunctionCallPlan } from "../../application/functionCallNarratives";
import { getNarrativeSourceRoots } from "../../application/narrativeSources";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { wholeNarrativeHostFixture } from "../helpers/wholeNarrativeHost";

/** Bind only source tokens/evidence issued by the actual fixture Host. */
async function prepare(count: number, expression?: string, around: { beforeCalls?: string; afterCalls?: string } = {}) {
  const f = await wholeNarrativeHostFixture(count, {}, { ...(expression ? { callExpression: () => expression } : {}), ...around });
  const signal = new AbortController().signal, lease = await f.access.capture({ graph: f.graph, getCurrentGraph: () => f.graph, rootIds: getNarrativeSourceRoots(f.graph, f.root.id, f.access.maxDepth), signal });
  const analysis = analyzeFunctionLogic({ functionNode: f.root, sourceText: f.files[0].content, maxBlocks: 512 });
  const options = { graph: f.graph, source: f.files[0].content, analysis, lease, primarySnippetId: "root",
    createSourceToken: (id: string) => f.sourceNodeTokens.createToken(id), resolveSourceToken: f.sourceNodeTokens.resolve.bind(f.sourceNodeTokens),
    createEvidenceToken: f.evidenceTokens.createToken.bind(f.evidenceTokens), resolveEvidenceToken: f.evidenceTokens.resolve.bind(f.evidenceTokens),
    readSourceText: f.access.readFileText };
  return { ...f, lease, analysis, signal, options };
}

test("captured native plan keeps calls after the diagram's 96-site limit with complete actual root/helper/caller sources", async () => {
  const h = await prepare(100);
  try {
    const plan = createCapturedFunctionCallPlan(h.options); assert.equal(plan.count, 100);
    const earlier = Array.from({ length: 98 }, (_, index) => ({ callId: "call-" + (index + 1), role: "Earlier complete role.", inputs: "Earlier whole transfer.", output: "Earlier output remains unknown.", effects: "Earlier effects remain unknown.", reason: "Earlier source reaching reason." }));
    const context = await plan.context(98, earlier, h.signal);
    assert.deepEqual(context.callTask!.targets.map(target => target.callId), ["call-99", "call-100"]); assert.deepEqual(context.callTask!.earlierModelReadings, earlier);
    assert.equal(context.callTask!.sequence.length, 100); assert.equal(context.callTask!.includeSummary, false);
    assert.equal(context.snippets.find(snippet => snippet.role === "function")?.text, h.rootText);
    assert.ok(context.snippets.some(snippet => snippet.text === h.helperText)); assert.ok(context.snippets.some(snippet => snippet.text === h.callerText));
    assert.ok(context.snippets.every(snippet => !snippet.truncated)); assert.equal(context.sourceCallReadings, undefined);
  } finally { h.lease.dispose(); }
});

test("captured native plan preserves a whole long call expression and more than twelve source guards", async () => {
  const literal = "whole-😀-".repeat(240), expression = Array.from({ length: 15 }, (_, index) => "guard" + index).join(" && ") + ` && finish("${literal}")`;
  const h = await prepare(1, expression);
  try {
    h.analysis.signature = "Complete original signature ".repeat(120);
    const plan = createCapturedFunctionCallPlan(h.options), context = await plan.context(0, [], h.signal), target = context.callTask!.targets[0];
    assert.ok(target.expression.length > 1200); assert.ok(target.expression.includes(literal)); assert.ok(target.guards.length >= 15);
    assert.equal(context.callTask!.signature, h.analysis.signature); assert.ok(context.snippets.some(snippet => snippet.role === "caller" && snippet.text.includes(literal)));
  } finally { h.lease.dispose(); }
});

test("a captured native plan preserves unresolved calls rather than silently removing them", async () => {
  const h = await prepare(1, "unknownExternal(\"original argument\")");
  try {
    const plan = createCapturedFunctionCallPlan(h.options), context = await plan.context(0, [], h.signal);
    assert.equal(plan.count, 1); assert.equal(context.callTask!.targets[0].confidence, "unresolved"); assert.equal(context.callTask!.targets[0].sourceLimited, true);
    assert.equal(context.callTask!.targets[0].expression, 'unknownExternal("original argument")'); assert.equal(context.callTask!.targets[0].calleeSnippet, undefined);
  } finally { h.lease.dispose(); }
});

test("a whole-plan source budget gap rejects before returning a misleading prefix", async () => {
  const h = await prepare(1);
  try {
    h.analysis.gaps.push({ code: "parseLimited", message: "Explicit fixture source budget gap", presentation: { key: "logic-gap-statement-limit", params: { count: 1, limit: 512 } } });
    assert.throws(() => createCapturedFunctionCallPlan(h.options), error => error instanceof FunctionNarrativeError && error.code === "context-too-large");
  } finally { h.lease.dispose(); }
});

test("whole native source retains every lexical loop beyond the diagram ancestry limit", async () => {
  const h = await prepare(1, undefined, { beforeCalls: Array.from({ length: 40 }, (_, index) => `for (let loop${index} = 0; loop${index} < 1; loop${index}++) {\n`).join(""), afterCalls: "}\n".repeat(40) });
  try {
    const plan = createCapturedFunctionCallPlan(h.options), context = await plan.context(0, [], h.signal);
    assert.equal(context.callTask!.targets[0].loops.length, 40);
    assert.ok(context.snippets.find(snippet => snippet.role === "function")!.text.includes("loop39"));
  } finally { h.lease.dispose(); }
});
