/** Business-call scope regressions: portable ownership, builtin collisions, library aliases and budgets. */
import assert from "node:assert/strict";
import test from "node:test";
import { createFunctionCallsSlice, createProjectCallableScope } from "../../application/functionCalls";
import { createPythonCallTargetFilter } from "../../analyzer/functionCalls";
import { PythonAnalyzer } from "../../analyzer/languages/python";
import { createFunctionLogicDrillTargets } from "../../application/codeFlow";
import { functionCallsToken, loadFunctionCallsFixture } from "./helpers/functionCallsFixture";

test("project callable scope excludes installed packages and outside paths on POSIX, Windows and UNC", async () => {
  const node = (await loadFunctionCallsFixture("python")).analysis("persist").functionNode;
  for (const root of ["/workspace", "C:\\Work\\App", "\\\\server\\share\\app"]) {
    const accepts = createProjectCallableScope(root);
    for (const path of ["services/order.py", "packages/business.py", "site-packages-report/check.py"]) {
      assert.equal(accepts({ ...node, filePath: `${root}/${path}` }), true, path);
    }
    for (const path of ["site-packages/sdk.py", "lib/python3.12/site-packages/sdk.py", "dist-packages/sdk.py",
      ".venv/lib/python3.12/re.py", "venv/helpers.py", "node_modules/sdk/save.ts", ".tox/test/sdk.py", "__pypackages__/3.12/lib/sdk.py", "../other/helper.py"]) {
      assert.equal(accepts({ ...node, filePath: `${root}/${path}` }), false, path);
    }
    assert.equal(accepts({ ...node, filePath: `${root}-other/service.py` }), false);
    assert.equal(accepts({ ...node, filePath: "" }), false);
    assert.equal(accepts({ ...node, kind: "external" }), false);
  }
  assert.equal(createProjectCallableScope("C:\\Work\\App")({ ...node, filePath: "c:\\work\\APP\\Lib\\SITE-PACKAGES\\sdk.py" }), false);
});

test("Python business snapshots omit builtins and aliased libraries without losing builtin conditions or loops", async () => {
  const f = await loadFunctionCallsFixture("python", "business");
  const template = f.analysis("persist").functionNode;
  f.graph.nodes.push({ ...template, id: "settle", name: "settle", qualifiedName: "settle", filePath: "/workspace/billing/services.py" });
  // A custom len elsewhere must not steal the builtin call; append/get are local collisions.
  f.graph.nodes.push({ ...template, id: "foreign-len", name: "len", qualifiedName: "len", filePath: "/workspace/unrelated.py" });
  f.graph.nodes.push({ ...template, id: "foreign-decode", name: "decode_payload", qualifiedName: "decode_payload", filePath: "/workspace/unrelated.py" });
  const slice = (name: string) => {
    const analysis = f.analysis(name);
    return createFunctionCallsSlice(f.graph, analysis, { graphVersion: "snapshot:test", sourceToken: functionCallsToken(analysis.functionNode.id), requestId: 1 }, functionCallsToken, () => undefined, f.file.content);
  };
  const check = () => {
    const result = slice("process_orders");
    // Source declares decode after its import, so Python's final module binding is a project function.
    assert.deepEqual(result.nodes.map(node => node.name), ["process_orders", "decode", "is_valid", "persist", "settle"]);
    const persist = result.nodes.find(node => node.name === "persist")!;
    const edge = result.connections.find(edge => edge.to === persist.id)!;
    assert.deepEqual(edge.guards, [{ expression: "if len(orders) > 4", outcome: "true" }, { expression: "if is_valid(order)", outcome: "true" }]);
    assert.deepEqual(edge.loops, ["for order in orders"]);
    assert.equal(result.omittedCount, 0);
    assert.ok(result.connections.every(connection => !connection.limited));
    assert.equal(slice("is_valid").nodes.length, 1);
    assert.equal(slice("custom_builtin_name").nodes[1].name, "len", "a locally defined len is business source");
    assert.equal(slice("save").nodes[1].name, "commit", "self methods retain proven ownership");
    assert.equal(slice("shadowed_parameter").nodes.length, 1, "a dynamic parameter cannot borrow the module function's identity");
    assert.equal(slice("default_callback").nodes[1].name, "persist", "a parameter default does not introduce a local binding");
    assert.equal(slice("local_import").nodes.length, 1, "a function-local library import shadows the project get");
    assert.equal(slice("local_project_import").nodes[1].name, "settle");
  };
  check();
  // Run the same acceptance against the fallback analyzer's graph edges, including guessed member calls.
  const analyzer = new PythonAnalyzer();
  f.graph.edges = await analyzer.extractEdges(await analyzer.parse(f.file), { sourceFiles: [f.file], workspaceRoot: "/workspace" });
  check();
  const analysis = f.analysis("local_import");
  const target = f.graph.nodes.find(node => node.name === "get")!;
  assert.equal(createPythonCallTargetFilter(f.file.content, "/workspace")(analysis.callsites[0], target, "resolved"), false);
});

test("dependency and unresolved calls consume neither visible budgets nor source token authority", async () => {
  const f = await loadFunctionCallsFixture();
  const analysis = f.analysis("processBatch");
  const root = analysis.functionNode;
  const site = analysis.callsites[0];
  const external = Array.from({ length: 150 }, (_, index) => ({ ...root, id: `external:${index}`, name: `library${index}`, qualifiedName: `library${index}`, filePath: `/workspace/lib/site-packages/sdk${index}.py` }));
  const business = f.graph.nodes.find(node => node.name === "persist")!;
  f.graph.nodes.push(...external);
  analysis.callsites = [...external, business].map(node => ({ ...site, calleeName: node.name, calleeText: node.name }));
  analysis.callsites.unshift(...Array.from({ length: 150 }, (_, index) => ({ ...site, calleeName: `unknown${index}`, calleeText: `unknown${index}` })));
  const issued: string[] = [];
  const request = { graphVersion: "snapshot:test", sourceToken: functionCallsToken(root.id), requestId: 1 };
  const project = () => createFunctionCallsSlice(f.graph, analysis, request, id => { issued.push(id); return functionCallsToken(id); }, () => undefined);
  let result = project();
  assert.deepEqual(result.nodes.map(node => node.name), ["processBatch", "persist"]);
  assert.deepEqual(issued, [business.id]);
  assert.equal(result.omittedCount, 0);
  assert.equal(result.limited, false);
  const originalDrill = createFunctionLogicDrillTargets(f.graph, root, analysis, functionCallsToken, 100);
  assert.ok(originalDrill.callees.some(target => target.name.startsWith("library")), "statement drill behavior is unchanged");
  f.graph.edges = external.map(target => ({ id: `edge:${target.id}`, kind: "calls", sourceId: root.id, targetId: target.id, filePath: root.filePath, range: site.range, confidence: "resolved" }));
  issued.length = 0;
  result = project();
  assert.equal(result.nodes.length, 2, "resolved and graph-only installed callees are filtered too");
  assert.deepEqual(issued, [business.id]);
  assert.equal(result.omittedCount, 0);
  analysis.functionNode = external[0];
  assert.equal(project().status, "unavailable", "a dependency cannot become an expansion root");
});
