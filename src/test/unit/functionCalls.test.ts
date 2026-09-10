/** Fixture snapshots for call prerequisites, function identity, bounded exploration and cycle layout. */
import assert from "node:assert/strict";
import test from "node:test";
import { createFunctionCallContexts } from "../../analyzer/functionCalls";
import { createFunctionCallsSlice } from "../../application/functionCalls";
import { validateWebviewRequest } from "../../protocol/webviewRequestValidation";
import { getFunctionCallsGraphSource } from "../../webview/functionCalls/graphSource";
import { functionCallsToken, loadFunctionCallsFixture } from "./helpers/functionCallsFixture";

for (const language of ["typescript", "python"] as const) {
  test(`${language} call contexts snapshot preserves early exits, predicate evaluation and loop guards`, async () => {
    const fixture = await loadFunctionCallsFixture(language);
    const analysis = fixture.analysis(language === "python" ? "process_batch" : "processBatch");
    const contexts = createFunctionCallContexts(analysis, { sourceText: fixture.file.content });
    const early = language === "python" ? "if not enabled" : "!enabled";
    const ready = language === "python" ? "if is_ready(item)" : "isReady(item)";
    const loop = language === "python" ? "for item in items" : "for of items";
    const size = language === "python" ? "if len(items) > 4" : "items.length > 4";
    const truth = (expression: string, outcome = "true") => ({ expression, outcome });
    assert.deepEqual(contexts.filter(context => context.site.calleeText !== "len").map(({ site, guards, loops, limited }) =>
      [site.calleeText, guards, loops, limited]), [
      ["reject", [truth(early)], [], false],
      [language === "python" ? "is_ready" : "isReady", [truth(early, "false")], [loop], false],
      ["persist", [truth(early, "false"), truth(ready)], [loop], false],
      ["notify", [truth(early, "false"), truth(ready)], [loop], false],
      ["reject", [truth(early, "false"), truth(ready, "false")], [loop], false],
      ["audit", [truth(early, "false"), truth(size)], [], false],
      ["finish", [truth(early, "false")], [], false],
      ["persist", [truth(early, "false")], [], false]
    ]);
  });

  test(`${language} retains conditional-expression and short-circuit prerequisites`, async () => {
    const fixture = await loadFunctionCallsFixture(language);
    for (const [name, expression] of [["countdown", "value > 0"], [language === "python" ? "short_circuit" : "shortCircuit", "enabled"]]) {
      const [context] = createFunctionCallContexts(fixture.analysis(name), { sourceText: fixture.file.content });
      assert.deepEqual(context.guards, [{ expression, outcome: "true" }]);
      assert.equal(context.limited, false);
    }
  });
  test(`${language} retains the last branch of a loop without reaching it through the next iteration`, async () => {
    const f = await loadFunctionCallsFixture(language);
    const contexts = createFunctionCallContexts(f.analysis(language === "python" ? "final_branch_loop" : "finalBranchLoop"), { sourceText: f.file.content });
    const notify = contexts.find(context => context.site.calleeText === "notify")!;
    assert.deepEqual(notify.guards, [{ expression: language === "python" ? "if is_ready(item)" : "isReady(item)", outcome: "true" }]);
    assert.equal(notify.loops.length, 1);
  });
}

test("direct neighborhoods retain one function identity and distinct callsite conditions", async () => {
  const fixture = await loadFunctionCallsFixture();
  const project = (name: string) => {
    const analysis = fixture.analysis(name);
    return createFunctionCallsSlice(fixture.graph, analysis, { graphVersion: "snapshot:test", sourceToken: functionCallsToken(analysis.functionNode.id), requestId: 1 }, functionCallsToken, () => undefined, fixture.file.content);
  };
  const batch = project("processBatch");
  const persist = batch.nodes.find(node => node.name === "persist")!;
  assert.ok(persist.sourceToken);
  assert.equal(batch.nodes.filter(node => node.name === "persist").length, 1);
  const sites = batch.connections.filter(edge => edge.to === persist.id);
  assert.equal(sites.length, 2);
  assert.notEqual(sites[0].id, sites[1].id);
  assert.equal(sites[0].guards.length, 2);
  assert.equal(sites[0].loops.length, 1);
  assert.equal(sites[1].guards.length, 1);
  assert.equal(sites[1].loops.length, 0);
  assert.ok(sites.every(edge => edge.confidence === "inferred"));
  const auditIds = [batch, project("persist"), project("notify")].map(slice => slice.nodes.find(node => node.name === "audit")?.id);
  assert.ok(auditIds[0]);
  assert.equal(new Set(auditIds).size, 1);
  assert.doesNotMatch(JSON.stringify(batch), /\/workspace\//u);
  assert.equal(project("countdown").connections[0].from, project("countdown").connections[0].to);
  const unknown = project("finish");
  assert.equal(unknown.nodes.length, 1, "unresolved library calls are not business function nodes");
  assert.equal(unknown.connections.length, 0);
  assert.equal(unknown.omittedCount, 0, "scope exclusions do not imply a diagram budget limit");
  assert.equal(project("audit").connections.length, 0);
  assert.equal(project("deferred").connections.length, 0, "returning a closure does not eagerly call its body");
});

test("nested argument branches and optional dispatch do not appear unconditional", async () => {
  const f = await loadFunctionCallsFixture();
  const contexts = createFunctionCallContexts(f.analysis("conditionalArguments"), { sourceText: f.file.content });
  const guards = (name: string) => contexts.filter(context => context.site.calleeText === name).map(context => context.guards);
  assert.deepEqual(guards("persist"), [[{ expression: "enabled", outcome: "true" }]]);
  assert.deepEqual(guards("audit"), [[{ expression: "enabled", outcome: "false" }], [{ expression: "enabled", outcome: "false" }]]);
  assert.deepEqual(guards("isReady"), [[{ expression: "callback", outcome: "notNullish" }], [{ expression: "service", outcome: "notNullish" }]]);
  assert.deepEqual(guards("notify"), [[]], "the enclosing call runs after either conditional argument arm");
});

test("context traversal and projections bound dense, duplicate and incomplete source graphs", async () => {
  const fixture = await loadFunctionCallsFixture();
  const analysis = fixture.analysis("processBatch");
  assert.ok(createFunctionCallContexts(analysis, { maxDepth: 1 }).some(context => context.limited));
  const targets = Array.from({ length: 150 }, (_, index) => ({ ...analysis.functionNode, id: `dense:${index}`, name: `business${index}`, qualifiedName: `business${index}` }));
  fixture.graph.nodes.push(...targets);
  analysis.callsites = targets.map(target => ({ ...analysis.callsites[0], calleeName: target.name, calleeText: target.name }));
  const slice = createFunctionCallsSlice(fixture.graph, analysis, { graphVersion: "snapshot:test", sourceToken: functionCallsToken(analysis.functionNode.id), requestId: 2 }, functionCallsToken, () => undefined);
  assert.equal(slice.nodes.length, 32);
  assert.equal(slice.connections.length, 31);
  assert.equal(slice.omittedCount, 119);
  assert.equal(slice.limited, true);
  analysis.callsites = [analysis.callsites[0], analysis.callsites[0]];
  const duplicate = createFunctionCallsSlice(fixture.graph, analysis, { graphVersion: "snapshot:test", sourceToken: functionCallsToken(analysis.functionNode.id), requestId: 3 }, functionCallsToken, () => undefined);
  assert.equal(duplicate.connections.length, 1);
});

test("call layout groups shared sites, draws self/mutual cycles and bounds depth without following unknown edges", () => {
  const layout = new Function(`${getFunctionCallsGraphSource()}; return layoutFunctionCalls;`)();
  const nodes = ["root", "left", "right", "shared"].map(id => ({ id }));
  const connections = [["root", "left"], ["root", "left"], ["root", "right"], ["left", "shared"], ["right", "shared"], ["shared", "root"], ["left", "left"], ["root", "missing"]].map(([from, to], index) => ({ id: String(index), from, to }));
  const graph = layout(nodes, connections, "root");
  assert.equal(graph.positions.size, 4);
  assert.equal(graph.positions.get("shared").depth, 2);
  assert.equal(graph.groups.find((group: { from: string; to: string }) => group.from === "root" && group.to === "left").edges.length, 2);
  assert.ok(graph.groups.every((group: { cycle: boolean; path: string }) => group.cycle && !group.path.includes("NaN")));
  assert.equal(graph.groups.length, 6);
  const bounded = layout(nodes, connections, "root", 1);
  assert.equal(bounded.positions.get("shared").depth, 1);
});

test("graph-only targets beyond the visible node limit are counted without inventing guards", async () => {
  const f = await loadFunctionCallsFixture();
  const analysis = f.analysis("processBatch"); analysis.callsites = [];
  const root = analysis.functionNode;
  const targets = Array.from({ length: 40 }, (_, index) => ({ ...root, id: `target:${index}`, name: `target${index}`, qualifiedName: `target${index}` }));
  f.graph.nodes = [root, ...targets];
  f.graph.edges = targets.map(target => ({ id: `edge:${target.id}`, sourceId: root.id, targetId: target.id, filePath: root.filePath, kind: "calls", confidence: "resolved" }));
  const slice = createFunctionCallsSlice(f.graph, analysis, { graphVersion: "snapshot:test", sourceToken: functionCallsToken(root.id), requestId: 1 }, functionCallsToken, () => undefined);
  assert.equal(slice.nodes.length, 32);
  assert.equal(slice.omittedCount, 9);
  assert.ok(slice.connections.every(edge => edge.limited && edge.guards.length === 0));
  const site = f.analysis("processBatch").callsites[0];
  analysis.callsites = targets.map(target => ({ ...site, calleeText: target.name, calleeName: target.name }));
  const syntax = createFunctionCallsSlice(f.graph, analysis, { graphVersion: "snapshot:test", sourceToken: functionCallsToken(root.id), requestId: 2 }, functionCallsToken, () => undefined);
  assert.equal(syntax.omittedCount, 9, "syntax-owned omissions are not counted again as graph-only targets");
});

test("call-mode request protocol rejects paths, extra fields, non-opaque tokens and invalid sequences", () => {
  const payload = { graphVersion: "sidebar-snapshot:test:1", sourceToken: functionCallsToken("root"), requestId: 1 };
  const validate = (value: unknown) => validateWebviewRequest({ type: "functionCalls/load", payload: value }).ok;
  assert.equal(validate(payload), true);
  for (const invalid of [{ ...payload, sourceToken: "/workspace/file.ts" }, { ...payload, filePath: "/workspace/file.ts" },
    { ...payload, requestId: -1 }, { ...payload, requestId: 1.5 }, { ...payload, requestId: Number.MAX_SAFE_INTEGER + 1 }, { ...payload, graphVersion: "" }]) assert.equal(validate(invalid), false);
});
