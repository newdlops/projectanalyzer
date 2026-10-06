/** Native task monitoring is inert, retains selection and cancels only the explicitly selected model operation. */
import assert from "node:assert/strict";
import test from "node:test";
import { ModelTaskManager } from "../../shared/modelTasks";
import { createModelTasksUi, type ModelTasksVsCodeApi } from "../../vscode/modelTasks";

function event<T>() { const listeners = new Set<(value: T) => void>(); return {
  listen(callback: (value: T) => void) { listeners.add(callback); return { dispose() { listeners.delete(callback); } }; },
  fire(value: T) { for (const callback of listeners) callback(value); }
}; }

test("native monitor reads empty/history state and preserves queued task focus without inference", async () => {
  const manager = new ModelTaskManager(), trigger = event<{ item: { taskId?: string } }>(), hidden = event<void>(), accept = event<void>(), all = event<void>();
  let open = () => {}, entered = 0, shown = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const picker = { items: [] as Array<{ taskId?: string; label: string; description?: string; buttons?: unknown[] }>, activeItems: [] as Array<{ taskId?: string }>, title: "", placeholder: "", buttons: [] as unknown[],
    onDidTriggerItemButton: trigger.listen, onDidTriggerButton: all.listen, onDidAccept: accept.listen, onDidHide: hidden.listen,
    show() {}, hide() { hidden.fire(); }, dispose() {} };
  const status = { text: "", name: "", tooltip: "", command: "", show() { shown = true; }, hide() { shown = false; }, dispose() {} };
  const api = { StatusBarAlignment: { Right: 2 }, ThemeIcon: class { constructor(public id: string) {} },
    commands: { registerCommand(_name: string, callback: () => void) { open = callback; return { dispose() {} }; } },
    window: { createStatusBarItem() { return status; }, createQuickPick() { return picker; } } } as unknown as ModelTasksVsCodeApi;
  const ui = createModelTasksUi(api, manager, "en");
  try {
    assert.equal(shown, false); open(); assert.equal(picker.items[0].label, "No model tasks"); assert.equal(manager.snapshot().history.length, 0);
    const first = manager.run({ kind: "inference", label: "caller", signal: new AbortController().signal, async execute() { entered++; await gate; } });
    const second = manager.run({ kind: "inference", label: "callee", signal: new AbortController().signal, async execute() { entered++; } });
    const cancelled = assert.rejects(second, { message: "cancelled" });
    const waiting = picker.items.find(item => item.label === "callee")!; picker.activeItems = [waiting];
    ui.updateLanguage("ko"); assert.ok(picker.title.includes("모델 작업")); assert.equal(picker.activeItems[0].taskId, waiting.taskId);
    assert.ok(picker.items.find(item => item.taskId === waiting.taskId)?.description?.includes("대기 순서 1"));
    trigger.fire({ item: waiting }); await cancelled; assert.equal(manager.snapshot().waiting.length, 0);
    release(); await first; assert.equal(entered, 1); assert.ok(status.text.includes("완료"));
    assert.equal(picker.items.find(item => item.label === "callee")?.buttons?.length, 0);
    assert.ok(picker.items.find(item => item.label === "callee")?.description?.includes("취소"));
  } finally { release(); ui.dispose(); await manager.dispose(); }
});
