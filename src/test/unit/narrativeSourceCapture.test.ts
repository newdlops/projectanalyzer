/** Whole actual native/supplemental graph capture, freshness and resource failures. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { captureNarrativeSources, extractWholeSourceRange, readWholeCallableSource } from "../../application/narrativeSources";
import { SourceCaptureError, type SourceCaptureLimits, type NarrativeSourceLease } from "../../shared/narrativeSources";
import { createContentHash } from "../../shared/hash";
import { withNarrativeWorkspace, rootText, helperText, sourceLimits } from "../helpers/narrativeSourceWorkspace";

const active = () => new AbortController().signal;
const hasCode = (code: SourceCaptureError["code"]) => (error: unknown) => error instanceof SourceCaptureError && error.code === code;

test("actual Rust graph captures the entire220-line root and90-line cross-file helper", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const lease = await workspace.capture();
    try {
      assert.equal(lease.capture.complete, true);
      assert.equal(lease.capture.declarations.length, 2);
      const root = lease.capture.declarations.find((row) => row.name === "root")!, helper = lease.capture.declarations.find((row) => row.name === "finish")!;
      assert.equal(root.text, rootText.slice(rootText.indexOf("export function root"), rootText.indexOf("\r\nexport function left")));
      assert.equal(helper.text, helperText.slice(0, -2));
      assert.ok(root.text.includes('"😀 / 219"') && helper.text.includes('"원문 😀 / 89"'));
      assert.equal(root.fileSha256, createContentHash(rootText));
      assert.equal(lease.capture.fileVersions.length, 2); await lease.assertCurrent(active());
    } finally { lease.dispose(); }
  });
});

test("supplemental Kotlin expression bodies and their complete helper are acquired from real files", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const lease = await workspace.capture(["choose"]);
    try {
      assert.equal(lease.capture.complete, true);
      assert.deepEqual(lease.capture.declarations.map((row) => row.text), ["fun choose(value: Int): Int = keep(value)", "fun keep(value: Int): Int = value"]);
      assert.ok(lease.capture.analysisCaveats.length > 0);
    } finally { lease.dispose(); }
  });
});

test("all explicitly requested caller and parent roots survive shared helper deduplication", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const lease = await workspace.capture(["root", "finish"]);
    try {
      assert.equal(lease.capture.complete, true); assert.equal(lease.capture.rootIds.length, 2);
      assert.deepEqual(lease.capture.declarations.map((row) => [row.name, row.depth]), [["root", 0], ["finish", 0]]);
    } finally { lease.dispose(); }
  });
});

test("source-only recursive fixtures terminate by visited identities without executing source", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const lease = await workspace.capture(["left"], { maxDepth: 1 });
    try { assert.equal(lease.capture.complete, true); assert.deepEqual(lease.capture.declarations.map((row) => row.name), ["left", "right"]); }
    finally { lease.dispose(); }
  });
});

test("duplicate-target call edges retain callsite identities and inferred confidence", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const original = workspace.graph.edges.find((edge) => edge.sourceId === workspace.node("root").id && edge.kind === "calls")!;
    assert.ok(original); workspace.graph.edges.push({ ...structuredClone(original), id: original.id + ":second", confidence: "inferred" });
    const lease = await workspace.capture();
    try {
      assert.equal(lease.capture.complete, true); assert.equal(lease.capture.declarations.filter((row) => row.name === "finish").length, 1);
      assert.equal(lease.capture.edges.filter((edge) => edge.kind === "calls").length, 2);
      assert.ok(lease.capture.edges.some((edge) => edge.confidence === "inferred"));
    } finally { lease.dispose(); }
  });
});

test("unresolved relationships and a depth boundary stay explicit instead of becoming exact source", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const edge = workspace.graph.edges.find((edge) => edge.sourceId === workspace.node("root").id && edge.kind === "calls")!, original = edge.confidence;
    edge.confidence = "unresolved";
    const unresolved = await workspace.capture();
    try { assert.equal(unresolved.capture.complete, false); assert.ok(unresolved.capture.gaps.some((gap) => gap.reason === "unresolved")); assert.equal(unresolved.capture.declarations.length, 1); }
    finally { unresolved.dispose(); }
    edge.confidence = original;
    const depth = await workspace.capture(["root"], { maxDepth: 0 });
    try { assert.equal(depth.capture.complete, false); assert.ok(depth.capture.gaps.some((gap) => gap.reason === "depth-limit")); assert.equal(depth.capture.declarations.length, 1); }
    finally { depth.dispose(); }
  });
});

test("every source, file, declaration and graph budget rejects the whole acquisition", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const original = workspace.graph.edges.find((edge) => edge.sourceId === workspace.node("root").id && edge.kind === "calls")!;
    workspace.graph.edges.push({ ...structuredClone(original), id: original.id + ":budget" });
    const fileTotal = Buffer.byteLength(rootText) + Buffer.byteLength(helperText);
    const bounds: Partial<SourceCaptureLimits>[] = [{ maxDeclarations: 1 }, { maxSourceBytes: 10 }, { maxFileBytes: 10 },
      { maxTotalFileBytes: fileTotal - 1 }, { maxGraphNodes: 1 }, { maxEdges: 1 }];
    for (const limit of bounds) await assert.rejects(workspace.capture(["root"], limit), hasCode("context-too-large"));
  });
});

test("invalid limits also dispose the action-owned graph authority", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const graph = workspace.authority();
    await assert.rejects(captureNarrativeSources({ rootIds: [workspace.node("root").id], graph, reader: workspace.reader,
      signal: active(), limits: { ...sourceLimits, maxEdges: undefined } as unknown as SourceCaptureLimits }), RangeError);
    assert.throws(() => graph.getNode(workspace.node("root").id), hasCode("disposed"));
  });
});

test("file changes after acquisition reject publication through the same lease", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const lease = await workspace.capture();
    try { await fs.writeFile(workspace.helperPath, helperText + "// changed\r\n"); await assert.rejects(lease.assertCurrent(active()), hasCode("source-changed")); }
    finally { lease.dispose(); }
  });
});

test("graph replacement and in-place node, edge, file or diagnostic mutation are rejected", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const original = structuredClone(workspace.graph), rootId = workspace.node("root").id;
    for (const mutate of [() => { workspace.current = structuredClone(workspace.graph); },
      () => { workspace.graph.nodes.find((node) => node.id === rootId)!.name = "changed"; },
      () => { workspace.graph.edges.find((edge) => edge.sourceId === rootId && edge.kind === "calls")!.confidence = "unresolved"; },
      () => { workspace.graph.nodes.find((node) => node.kind === "file" && node.filePath === workspace.rootPath)!.metadata!.contentHash = "0".repeat(64); },
      () => { workspace.graph.diagnostics.push({ severity: "error", code: "changed", message: "new diagnostic" }); }]) {
      workspace.graph = structuredClone(original); workspace.current = workspace.graph;
      const lease = await workspace.capture();
      try { mutate(); await assert.rejects(lease.assertCurrent(active()), hasCode("source-changed")); }
      finally { lease.dispose(); }
    }
  });
});

test("source payload mutation and use after disposal cannot publish an owned action", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const lease = await workspace.capture();
    lease.capture.declarations[0].text += "changed payload";
    await assert.rejects(lease.assertCurrent(active()), hasCode("source-changed"));
    lease.dispose(); lease.dispose(); await assert.rejects(lease.assertCurrent(active()), hasCode("disposed"));
  });
});

test("missing analyzed-input bindings and missing parser callsite edges remain incomplete", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const original = structuredClone(workspace.graph);
    delete workspace.graph.nodes.find((node) => node.kind === "file" && node.filePath === workspace.rootPath)!.metadata!.contentHash;
    const unbound = await workspace.capture();
    try { assert.equal(unbound.capture.complete, false); assert.ok(unbound.capture.gaps.some((gap) => gap.reason === "source-unbound")); }
    finally { unbound.dispose(); }
    workspace.graph = structuredClone(original); workspace.current = workspace.graph;
    workspace.graph.edges = workspace.graph.edges.filter((edge) => edge.sourceId !== workspace.node("root").id || edge.kind !== "calls");
    const missing = await workspace.capture();
    try { assert.equal(missing.capture.complete, false); assert.ok(missing.capture.gaps.some((gap) => gap.reason === "call-unrepresented")); }
    finally { missing.dispose(); }
  });
});

test("cancellation after real I/O disposes authority and returns no partial lease", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const controller = new AbortController(), graph = workspace.authority();
    await assert.rejects(captureNarrativeSources({ rootIds: [workspace.node("root").id], graph, limits: sourceLimits, signal: controller.signal,
      reader: { async read(file, bytes, signal) { const value = await workspace.reader.read(file, bytes, signal); controller.abort(); return value; } } }), hasCode("cancelled"));
    assert.throws(() => graph.getNode(workspace.node("root").id), hasCode("disposed"));
  });
});

test("exact UTF16 extraction preserves CRLF, bareCR, astral and unpaired units", () => {
  assert.equal(extractWholeSourceRange("a😀\r\nb\r끝\n", { startLine: 0, startCharacter: 1, endLine: 2, endCharacter: 1 }), "😀\r\nb\r끝");
  assert.equal(extractWholeSourceRange("\ud800x", { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 }), "\ud800");
  assert.throws(() => extractWholeSourceRange("text", { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 }), hasCode("invalid-range"));
});

test("a mismatched parser identity cannot fall back to the native declaration header", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const root = workspace.node("root"), id = root.id; root.name = "wrong-graph-name";
    const lease = await captureNarrativeSources({ rootIds: [id], graph: workspace.authority(), reader: workspace.reader, signal: active(), limits: sourceLimits });
    try { assert.equal(lease.capture.complete, false); assert.equal(lease.capture.declarations.length, 0); assert.ok(lease.capture.gaps.some((gap) => gap.reason === "declaration-unavailable")); }
    finally { lease.dispose(); }
  });
});

test("an extra graph edge inside an argument cannot masquerade as a source callsite", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const edge = workspace.graph.edges.find((edge) => edge.sourceId === workspace.node("root").id && edge.kind === "calls")!;
    workspace.graph.edges.push({ ...structuredClone(edge), id: edge.id + ":argument", range: { startLine: 222, startCharacter: 16, endLine: 222, endCharacter: 21 } });
    const lease = await workspace.capture();
    try { assert.equal(lease.capture.complete, false); assert.ok(lease.capture.gaps.some((gap) => gap.edgeId === edge.id + ":argument" && gap.reason === "call-unrepresented")); }
    finally { lease.dispose(); }
  });
});

test("payload mutation while freshness I/O is pending is rejected after that I/O", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    let lease: NarrativeSourceLease | undefined, mutate = false;
    lease = await captureNarrativeSources({ rootIds: [workspace.node("root").id], graph: workspace.authority(), limits: sourceLimits, signal: active(),
      reader: { async read(file, bytes, signal) {
        const value = await workspace.reader.read(file, bytes, signal);
        if (mutate && lease) { mutate = false; lease.capture.declarations[0].text += "mutation during await"; }
        return value;
      } } });
    try { mutate = true; await assert.rejects(lease.assertCurrent(active()), hasCode("source-changed")); }
    finally { lease.dispose(); }
  });
});

test("whole graph parent, original header range, selection and long nested metadata remain exact", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    const root = workspace.node("root"); root.metadata = { ...root.metadata, originalScope: { detail: "원래 범위 ".repeat(1000), nested: { kind: "declared" } } };
    const original = structuredClone(root), lease = await workspace.capture();
    try {
      const declaration = lease.capture.declarations.find((row) => row.id === root.id)!;
      assert.deepEqual(declaration.graphNode, original); assert.notStrictEqual(declaration.graphNode, root);
      assert.equal(declaration.graphNode.parentId, root.parentId);
      await lease.assertCurrent(active());
    } finally { lease.dispose(); }
  });
});

test("a declaration resolver cannot rewrite the captured source owner", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    await assert.rejects(captureNarrativeSources({ rootIds: [workspace.node("root").id], graph: workspace.authority(), reader: workspace.reader,
      signal: active(), limits: sourceLimits, resolveDeclaration(node, source) {
        const value = readWholeCallableSource(node, source); node.name = "mutated source owner"; return value;
      } }), hasCode("source-changed"));
  });
});

test("the action owns its resource policy across asynchronous source reads", async () => {
  await withNarrativeWorkspace(async (workspace) => {
    for (const weaken of [false, true]) {
      const limits = { ...sourceLimits, maxDeclarations: weaken ? 1 : sourceLimits.maxDeclarations }, initial = { ...limits };
      const operation = captureNarrativeSources({ rootIds: [workspace.node("root").id], graph: workspace.authority(), signal: active(), limits,
        reader: { async read(file, bytes, signal) {
          const value = await workspace.reader.read(file, bytes, signal);
          limits.maxDeclarations = weaken ? 1000 : 1; limits.maxSourceBytes = weaken ? 1_000_000 : 1;
          return value;
        } } });
      if (weaken) await assert.rejects(operation, hasCode("context-too-large"));
      else { const lease = await operation; try { assert.equal(lease.capture.complete, true); assert.deepEqual(lease.capture.limits, initial); } finally { lease.dispose(); } }
    }
  });
});
