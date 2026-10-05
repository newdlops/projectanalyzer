/** Exercises real source grouping and decoration lifecycle; only the native VS Code boundary is replaced. */
import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";
import { createContentHash } from "../../shared/hash";
import { buildFunctionNarrativeSourceAnnotations, type FunctionNarrativeSourcePresentation } from "../../shared/functionNarratives";
import { FunctionNarrativeDecorationService } from "../../vscode/functionNarrativeDecorations";

const source = 'fun classify(enabled: Boolean): String {\n if (!enabled) return "disabled"\n return "ordinary"\n}\n';
const target: FunctionNarrativeSourcePresentation = {
  filePath: "/fixture/Example.kt", sourceHash: createContentHash(source), contextId: "context:fixture", functionName: "classify",
  language: "ko", modelName: "Local", snippets: [{ id: "root", role: "function", startLine: 1, endLine: 4, text: source.trim(), truncated: false }],
  narrative: { summary: "enabled에 따라 주문 상태를 결정한다.", scenarios: [
    { title: "비활성 주문", when: ["enabled == false"], steps: [
      { text: "enabled가 false이므로 !enabled는 true다. disabled를 반환하고 뒤의 반환문을 건너뛴다.", source: { snippetId: "root", startLine: 2, endLine: 2 } }
    ], outcome: "disabled 문자열을 반환한다.", assumptions: [] },
    { title: "활성 주문", when: ["enabled == true"], steps: [
      { text: "!enabled가 false이므로 조기 반환을 건너뛰고 다음 줄로 진행한다.", source: { snippetId: "root", startLine: 2, endLine: 2 } },
      { text: "ordinary를 반환한다.", source: { snippetId: "root", startLine: 3, endLine: 3 } }
    ], outcome: "ordinary 문자열을 반환한다.", assumptions: [] }
  ], limitations: [] }
};

/** Native objects record presentation calls without changing any source content. */
function nativeFixture() {
  const listeners: Record<string, (event: any) => void> = {};
  const commands = new Map<string, () => void>(); const contexts: unknown[] = [];
  let text = source; let enabled = true; let disposed = 0;
  const document = { uri: { scheme: "file", fsPath: target.filePath }, getText: () => text, lineCount: 5,
    lineAt: (line: number) => ({ text: text.split("\n")[line], range: new Range(line, 0, line, text.split("\n")[line].length) }) };
  const editor = { document, calls: [] as Array<{ type: unknown; options: any[] }>, setDecorations(type: unknown, options: any[]) { this.calls.push({ type, options }); } };
  const event = (name: string) => (listener: (value: any) => void) => { listeners[name] = listener; return { dispose() { delete listeners[name]; } }; };
  class MarkdownString {
    value = ""; textParts: string[] = []; isTrusted = true; supportHtml = true;
    appendText(value: string) { this.textParts.push(value); this.value += value; return this; }
    appendMarkdown(value: string) { this.value += value; return this; }
  }
  class Range { constructor(public startLine: number, public startCharacter: number, public endLine: number, public endCharacter: number) {} }
  const type = { dispose() { disposed += 1; } };
  const api = {
    window: { visibleTextEditors: [editor], createTextEditorDecorationType: () => type, onDidChangeVisibleTextEditors: event("visible") },
    workspace: { textDocuments: [document], getConfiguration: () => ({ get: () => enabled }), onDidChangeTextDocument: event("change"),
      onDidCloseTextDocument: event("close"), onDidChangeConfiguration: event("config") },
    commands: { registerCommand(id: string, callback: () => void) { commands.set(id, callback); return { dispose() { commands.delete(id); } }; },
      executeCommand(_id: string, _key: string, value: unknown) { contexts.push(value); return Promise.resolve(); } },
    Range, MarkdownString, ThemeColor: class { constructor(public id: string) {} },
    DecorationRangeBehavior: { ClosedClosed: 3 }, OverviewRulerLane: { Right: 4 }
  };
  const service = new FunctionNarrativeDecorationService(api as unknown as typeof vscode);
  return { api, service, editor, document, listeners, commands, contexts, type,
    changeText(value: string) { text = value; listeners.change?.({ document, contentChanges: [{}] }); },
    setEnabled(value: boolean) { enabled = value; listeners.config?.({ affectsConfiguration: () => true }); },
    get disposed() { return disposed; } };
}

test("LLM source lines combine scenario/step numbers and bound hints without dropping full explanations", () => {
  const rows = buildFunctionNarrativeSourceAnnotations(target.narrative, target.snippets);
  assert.equal(rows.length, 2); assert.equal(rows[0].line, 2);
  assert.deepEqual(rows[0].references.map((ref) => ref.label), ["1.1", "2.1"]);
  assert.match(rows[0].hint, /^LLM 1\.1, 2\.1/u);
  assert.ok(rows[0].hint.length <= 120);
  assert.equal(rows[0].references[0].step.text, target.narrative.scenarios[0].steps[0].text);
  const invalid = structuredClone(target.narrative); invalid.scenarios[0].steps[0].source.startLine = 99;
  assert.deepEqual(buildFunctionNarrativeSourceAnnotations(invalid, target.snippets), []);
});

test("native source decorations show inferred detail on the matching dirty snapshot and escape model prose", () => {
  const f = nativeFixture(); const presenter = f.service.createPresenter();
  try {
    assert.equal(f.editor.calls.length, 0);
    const hostile = structuredClone(target); hostile.narrative.summary = '[open](command:unsafe) <b>html</b>';
    hostile.narrative.scenarios[0].explanation = 'enabled가 false라 조기 반환한다. [open](command:unsafe) <b>html</b>';
    hostile.narrative.scenarios[0].steps[0].reason = "!enabled는 true다.";
    hostile.narrative.scenarios[0].steps[0].effect = "ordinary 반환문을 건너뛴다.";
    hostile.narrative.scenarios[0].steps[0].syntax = "논리 부정은 Boolean을 반대로 바꾼다. [open](command:unsafe)";
    hostile.narrative.scenarios[0].analysis = { pathReason: "false를 부정해 true가 된다.", stateChange: "입력은 바뀌지 않고 반환한다.", alternative: "true 입력은 조기 반환을 건너뛴다." };
    presenter.show(hostile);
    const options = f.editor.calls.at(-1)!.options;
    assert.equal(options.length, 2); assert.equal(options[0].range.startLine, 1);
    assert.match(options[0].renderOptions.after.contentText, /LLM 1\.1, 2\.1/u);
    assert.equal(options[0].hoverMessage.isTrusted, false); assert.equal(options[0].hoverMessage.supportHtml, false);
    assert.ok(options[0].hoverMessage.textParts.includes(hostile.narrative.summary));
    assert.ok(options[0].hoverMessage.textParts.includes(hostile.narrative.scenarios[0].explanation));
    assert.match(options[0].hoverMessage.value, /실제 실행 미검증/u);
    assert.match(options[0].hoverMessage.value, /disabled 문자열을 반환한다/u);
    assert.match(options[0].hoverMessage.value, /판단 근거/u);
    assert.match(options[0].hoverMessage.value, /ordinary 반환문을 건너뛴다/u);
    assert.ok(options[0].hoverMessage.textParts.includes(hostile.narrative.scenarios[0].steps[0].syntax));
    assert.ok(options[0].hoverMessage.textParts.includes(hostile.narrative.scenarios[0].analysis.alternative));
    assert.equal(f.document.getText(), source);
    f.changeText(source.replace('"ordinary"', '"changed"'));
    assert.deepEqual(f.editor.calls.at(-1)!.options, []);
    presenter.show(target); assert.deepEqual(f.editor.calls.at(-1)!.options, []);
  } finally { f.service.dispose(); }
  assert.equal(f.disposed, 1); assert.equal(Object.keys(f.listeners).length, 0);
});

test("source presentation ownership, explicit clear, editor reopening and disabled states remain inert", () => {
  const f = nativeFixture(); const older = f.service.createPresenter(); const current = f.service.createPresenter();
  try {
    older.show(target); current.show({ ...target, contextId: "context:new" }); older.clear();
    assert.equal(f.editor.calls.at(-1)!.options.length, 2);
    f.api.window.visibleTextEditors = []; f.listeners.visible([]); assert.deepEqual(f.editor.calls.at(-1)!.options, []);
    f.api.window.visibleTextEditors = [f.editor]; f.listeners.visible([f.editor]); assert.equal(f.editor.calls.at(-1)!.options.length, 2);
    f.commands.get("projectAnalyzer.clearFunctionNarrativeDecorations")!();
    assert.deepEqual(f.editor.calls.at(-1)!.options, []);
    f.listeners.visible([f.editor]); assert.deepEqual(f.editor.calls.at(-1)!.options, []);
    current.show(target); f.setEnabled(false); assert.deepEqual(f.editor.calls.at(-1)!.options, []);
    current.show(target); assert.deepEqual(f.editor.calls.at(-1)!.options, []);
    f.setEnabled(true); assert.deepEqual(f.editor.calls.at(-1)!.options, []);
    current.show(target); f.listeners.close(f.document); assert.deepEqual(f.editor.calls.at(-1)!.options, []);
  } finally { f.service.dispose(); }
});

test("dense and long LLM annotation text stays bounded and clears only its own decoration type", () => {
  const f = nativeFixture(); const presenter = f.service.createPresenter();
  const dense = structuredClone(target);
  dense.narrative.scenarios = Array.from({ length: 4 }, (_, scenarioIndex) => ({ ...target.narrative.scenarios[0],
    title: `시나리오 ${scenarioIndex + 1}`, steps: Array.from({ length: 5 }, () => ({ ...target.narrative.scenarios[0].steps[0], text: "이해 설명 ".repeat(80) })) }));
  try {
    presenter.show(dense); const options = f.editor.calls.at(-1)!.options;
    assert.equal(options.length, 1); assert.ok(options[0].renderOptions.after.contentText.length <= 120);
    assert.match(options[0].hoverMessage.value, /4\.5/u);
    presenter.clear(); assert.deepEqual(f.editor.calls.at(-1)!, { type: f.type, options: [] });
  } finally { f.service.dispose(); }
});

test("Git revision documents cannot reject or clear annotations on the working file", () => {
  const f = nativeFixture();
  const revision = { ...f.document, uri: { scheme: "git", fsPath: target.filePath }, getText: () => "older source" };
  const diffEditor = { ...f.editor, document: revision, calls: [] as typeof f.editor.calls };
  f.api.workspace.textDocuments = [revision, f.document];
  f.api.window.visibleTextEditors = [diffEditor, f.editor];
  try {
    f.service.createPresenter().show(target);
    assert.equal(f.editor.calls.at(-1)?.options.length, 2);
    assert.equal(diffEditor.calls.length, 0);
    f.listeners.change({ document: revision, contentChanges: [{}] });
    f.listeners.close(revision); f.listeners.visible([diffEditor, f.editor]);
    assert.equal(f.editor.calls.at(-1)?.options.length, 2);
  } finally { f.service.dispose(); }
});
