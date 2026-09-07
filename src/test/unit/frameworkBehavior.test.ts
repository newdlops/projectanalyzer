/** Source-backed framework fixtures, shadowing guards and opaque projection contracts. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { analyzeFunctionFrameworkBehavior, type FrameworkBehaviorInput } from "../../analyzer/frameworkBehavior";
import { analyzeFunctionLogic } from "../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../analyzer/functionTutor";
import { buildFunctionTutorModel, CodeFlowInsightCache } from "../../application/codeFlow";
import { projectFrameworkBehavior } from "../../application/codeFlow/functionTutor/frameworkBehaviorProjection";
import type { FrameworkUnit, SymbolNode } from "../../shared/types";
import { createFramework, createFrameworkUnit, createGraph } from "./helpers/projectReadingGuideFixtures";

/** Test symbols select declarations by an explicit source marker, including arrow names. */
function input(sourceText: string, marker: string, python = false): FrameworkBehaviorInput {
  const start = sourceText.indexOf(marker);
  assert.ok(start >= 0, marker);
  const prefix = sourceText.slice(0, start).split("\n");
  const line = prefix.length - 1;
  const character = prefix.at(-1)!.length;
  const selectionRange = { startLine: line, startCharacter: character, endLine: line, endCharacter: character + marker.length };
  const functionNode: SymbolNode = {
    id: "selected", kind: "function", name: marker, qualifiedName: marker,
    filePath: python ? "/workspace/mail/views.py" : "/workspace/Inbox.tsx", language: python ? "python" : "typescriptreact",
    selectionRange, range: { ...selectionRange, endLine: sourceText.split("\n").length - 1, endCharacter: 1 }
  };
  return { sourceText, functionNode };
}

/** Proven model ownership comes from the existing project framework graph. */
function model(): FrameworkUnit {
  return { ...createFrameworkUnit("mail-model", "Django", "/workspace"), kind: "model", name: "Message", filePath: "/workspace/mail/models.py" };
}

const fixture = (file: string) => readFileSync(resolve("src/test/fixtures/frameworkBehavior", file), "utf8");
const kinds = (value: FrameworkBehaviorInput) => analyzeFunctionFrameworkBehavior(value)?.facts.map((fact) => fact.kind) ?? [];

test("React arrow fixture separates render, dependencies, cleanup and eager event calls", () => {
  const value = input(fixture("ReactOverview.tsx"), "Inbox");
  const result = analyzeFunctionFrameworkBehavior(value)!;
  assert.equal(result.role, "component");
  assert.deepEqual(result.facts.map(({ kind, phase, range }) => [kind, phase, range.startLine]), [
    ["react-render", "render", 4], ["react-state", "render", 5], ["react-memo", "render", 6],
    ["react-effect-deps", "commit", 7], ["react-cleanup", "commit", 9],
    ["react-event", "event", 13], ["react-event", "event", 14], ["react-event-eager", "render", 15]
  ]);
  assert.equal(result.facts.find((fact) => fact.kind === "react-state")?.subject, "[query, setQuery]");
});

test("React namespaces distinguish every-commit, empty, dynamic and layout dependencies", () => {
  const value = input('import * as R from "react"; function Component() { R.useEffect(() => {}); R.useEffect(() => () => release(), []); R.useEffect(setup, deps); R.useLayoutEffect(setup, [size]); R.useCallback(handler, []); R.useRef(null); R.useContext(Context); }', "Component");
  assert.deepEqual(kinds(value), ["react-effect-every", "react-effect-mount", "react-cleanup", "react-effect-dynamic", "react-layout-effect", "react-callback", "react-ref", "react-context"]);
  assert.deepEqual(kinds(input('import { useEffect } from "react"; function Component() { useEffect(async () => { return () => release(); }, []); }', "Component")), ["react-effect-mount"]);
});

test("lookalike hooks, type imports, nested callbacks and shadowed imports stay unclassified", () => {
  for (const source of [
    'function Component() { useEffect(setup, []); return <div />; }',
    'import type { useEffect } from "react"; function Component() { useEffect(setup, []); }',
    'import { useEffect } from "other"; function Component() { useEffect(setup, []); }',
    'import { useEffect } from "react"; function Component(useEffect) { useEffect(setup, []); }',
    'import R from "react"; function Component({ R }) { R.useState(0); }',
    'import { useEffect } from "react"; function Component() { function later() { useEffect(setup, []); } }',
    'import { useEffect } from "react"; function outer(useEffect) { function Component() { useEffect(setup, []); } }'
  ]) assert.deepEqual(kinds(input(source, "Component")), [], source);
});

test("automatic JSX runtime requires a matching project root and remains inferred", () => {
  const value = input("function Component() { return <div />; }", "Component");
  assert.deepEqual(kinds({ ...value, frameworks: [createFramework("React", "/another")] }), []);
  const result = analyzeFunctionFrameworkBehavior({ ...value, frameworks: [createFramework("React", "/workspace")] });
  assert.equal(result?.facts[0].kind, "react-render");
  assert.equal(result?.facts[0].confidence, "inferred");
});

test("Django fixture links request guards, lazy queries, evaluation, writes and responses", () => {
  const value = input(fixture("DjangoView.py"), "inbox", true);
  value.units = [model(), { ...createFrameworkUnit("view", "Django", "/workspace"), kind: "view", name: "inbox", filePath: value.functionNode.filePath, range: value.functionNode.range }];
  const result = analyzeFunctionFrameworkBehavior(value)!;
  assert.equal(result.role, "view");
  assert.deepEqual(result.facts.map(({ kind, range }) => [kind, range.startLine]), [
    ["django-view", 10], ["django-auth", 8], ["django-method", 9], ["django-query-lazy", 12],
    ["django-query-read", 13], ["django-response", 15], ["django-atomic", 16],
    ["django-query-write", 17], ["django-commit", 18], ["django-response", 19]
  ]);
});

test("Django model aliases preserve ownership and query aliases require one lazy assignment", () => {
  const value = input('from .models import Message as Mail\ndef view(request):\n    pending = Mail.objects.filter(active=True)\n    for item in pending:\n        pass\n    first = Mail.objects.get(pk=1)\n    first.save()\n    first.count()\n    other = Mail()\n    other.save()\n', "view", true);
  assert.deepEqual(kinds({ ...value, units: [model()] }), ["django-query-lazy", "django-query-read", "django-query-read", "django-query-write", "django-query-write"]);
  assert.deepEqual(kinds({ ...value, units: [{ ...model(), filePath: "/another/models.py" }] }), []);
  const ambiguous = input('from .models import Message as Mail\ndef view(request):\n    pending = Mail.objects.filter(active=True)\n    pending = other\n    pending.count()\n', "view", true);
  assert.deepEqual(kinds({ ...ambiguous, units: [model()] }), ["django-query-lazy"]);
  const asynchronous = input('from .models import Message as Mail\nasync def view(request):\n    deferred = Mail.objects.acount()\n    return await Mail.objects.acount()\n', "view", true);
  assert.deepEqual(kinds({ ...asynchronous, units: [model()] }), ["django-query-read"]);
});

test("Django decorators and imported shortcuts have explicit contracts", () => {
  const value = input('from django.dispatch import receiver as receive\nfrom django.shortcuts import render as template, redirect\nfrom django.db import transaction\n@receive(post_save)\n@transaction.atomic\ndef handler(sender):\n    transaction.atomic()\n    template(request, "ok.html")\n    return redirect("home")\n', "handler", true);
  const result = analyzeFunctionFrameworkBehavior(value)!;
  assert.equal(result.role, "signal");
  assert.deepEqual(result.facts.map((fact) => fact.kind), ["django-signal", "django-atomic", "django-render", "django-redirect"]);
});

test("Django local bindings, unrelated managers and strings do not prove a framework call", () => {
  for (const source of [
    'def view(request):\n    return JsonResponse({})\n',
    'from other import JsonResponse\ndef view(request):\n    return JsonResponse({})\n',
    'from django.http import JsonResponse\ndef view(JsonResponse):\n    return JsonResponse({})\n',
    'from django.http import JsonResponse\ndef view(request):\n    a, JsonResponse = values\n    return JsonResponse({})\n',
    'from django.http import JsonResponse\ndef view(request):\n    for JsonResponse in values:\n        JsonResponse({})\n',
    'from django.shortcuts import render\ndef view(request):\n    try:\n        pass\n    except Error as render:\n        render()\n',
    'from django.http import JsonResponse\ndef view(request):\n    from other import JsonResponse\n    return JsonResponse({})\n',
    'from django.http import JsonResponse\nJsonResponse = custom\ndef view(request):\n    return JsonResponse({})\n',
    'def view(request):\n    "from django.http import JsonResponse"\n    return Data.objects.get(pk=1)\n'
  ]) assert.deepEqual(kinds(input(source, "view", true)), [], source);
});

test("bounds preserve honest omissions and malformed or oversized input is unsupported", () => {
  const value = input(fixture("ReactOverview.tsx"), "Inbox");
  const limited = analyzeFunctionFrameworkBehavior({ ...value, maxFacts: 2 })!;
  assert.equal(limited.facts.length, 2); assert.equal(limited.omittedCount, 6); assert.equal(limited.limited, true);
  assert.deepEqual(kinds({ ...value, maxDepth: 1 }), []);
  assert.deepEqual(kinds({ ...value, sourceText: "x".repeat(1_000_001) }), []);
  assert.deepEqual(kinds(input('function Component() {', "Component")), []);
  assert.deepEqual(kinds(input('def view(:\n', "view", true)), []);
});

test("Django convention view scopes distinguish dispatch methods from helpers and closures", () => {
  const text = 'from django.http import JsonResponse\nclass InboxView:\n    def get(self, request):\n        return JsonResponse({})\n    def helper(self):\n        return JsonResponse({})\n';
  const get = input(text, "get", true);
  const unit = { ...createFrameworkUnit("view", "Django", "/workspace"), kind: "view" as const, name: "InboxView", filePath: get.functionNode.filePath, range: { startLine: 1, startCharacter: 0, endLine: 6, endCharacter: 0 } };
  assert.ok(kinds({ ...get, units: [unit] }).includes("django-view"));
  assert.equal(kinds({ ...input(text, "helper", true), units: [unit] }).includes("django-view"), false);
  assert.deepEqual(kinds(input('from django.http import JsonResponse\ndef outer(JsonResponse):\n    def inner():\n        return JsonResponse({})\n', "inner", true)), []);
});

test("application resolves engine-relative framework roots before automatic React JSX analysis", async () => {
  const value = input("function Component() { return <div />; }", "Component");
  const logic = analyzeFunctionLogic(value);
  const declaration = analyzeFunctionTutorDeclaration({ ...value, functionLogic: logic });
  const graph = createGraph({ files: [value.functionNode.filePath], callables: [value.functionNode], frameworks: [createFramework("React", ".")] });
  graph.workspaceRoot = "/workspace";
  const insights = new CodeFlowInsightCache().get(graph);
  const model = await buildFunctionTutorModel({ graph, declaration, functionLogic: logic, architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows, functionIndex: insights.functionIndex, readSourceText: async () => value.sourceText });
  assert.equal(model.frameworkBehavior?.facts[0].kind, "react-render");
});

test("projection replaces framework ranges with opaque source evidence and matching blocks", () => {
  const value = input(fixture("ReactOverview.tsx"), "Inbox");
  const behavior = analyzeFunctionFrameworkBehavior(value)!;
  const logic = analyzeFunctionLogic(value);
  const locations: unknown[] = [];
  const payload = projectFrameworkBehavior(behavior, logic, {
    flowId: "flow:opaque", blockIds: new Map(logic.blocks.map((block, index) => [block.id, "block:" + index])),
    createEvidenceToken(file, range) { locations.push([file, range]); return ("code-evidence:" + locations.length) as `code-evidence:${string}`; }
  })!;
  assert.equal(locations.length, behavior.facts.length);
  assert.ok(payload.facts.some((fact) => fact.blockId));
  assert.ok(payload.facts.every((fact) => fact.evidenceToken?.startsWith("code-evidence:")));
  assert.equal(JSON.stringify(payload).includes("/workspace/"), false);
  assert.equal(JSON.stringify(payload).includes("startLine"), false);
});
