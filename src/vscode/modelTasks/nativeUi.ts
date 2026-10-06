/** Native status-bar/Quick-Pick work monitor; opening it reads metadata and never requests inference. */
import type * as vscode from "vscode";
import type { ModelTaskManager, ModelTaskRecord } from "../../shared/modelTasks";
import { modelTaskDiagnosticText, modelTaskFailureText, modelTaskPhaseText } from "./copy";
export type ModelTasksVsCodeApi = Pick<typeof vscode, "window" | "commands" | "StatusBarAlignment" | "ThemeIcon">;
export type ModelTasksUi = { updateLanguage(language: "ko" | "en"): void; dispose(): void };
type TaskItem = vscode.QuickPickItem & { taskId?: string };

/** Owns one status item and at most one live native list, with bounded manager snapshots. */
export function createModelTasksUi(api: ModelTasksVsCodeApi, manager: ModelTaskManager, initialLanguage: "ko" | "en"): ModelTasksUi {
  let language = initialLanguage, picker: vscode.QuickPick<TaskItem> | undefined;
  let snapshot = manager.snapshot();
  const status = api.window.createStatusBarItem("projectAnalyzer.modelTasks", api.StatusBarAlignment.Right, 30);
  status.command = "projectAnalyzer.openModelTasks";
  const title = () => language === "ko" ? "모델 작업" : "Model Tasks";
  const waiting = () => language === "ko" ? `대기 ${snapshot.waiting.length}개` : `${snapshot.waiting.length} waiting`;

  /** Queue updates retain the focused row's identity and never modify function inputs/results. */
  function render(): void {
    status.name = title();
    const latest = snapshot.active ?? snapshot.history.at(-1);
    if (!latest && !snapshot.waiting.length) status.hide();
    else {
      const phase = latest ? modelTaskPhaseText(latest.phase, language) : modelTaskPhaseText("queued", language);
      status.text = `${snapshot.active ? "$(sync~spin)" : "$(sparkle)"} ${title()} · ${phase}${snapshot.waiting.length ? " · " + waiting() : ""}`;
      status.tooltip = title() + " · " + waiting() + (latest?.failure ? "\n" + modelTaskFailureText(latest.failure, language) : "")
        + (latest?.detailCode ? "\n" + modelTaskDiagnosticText(latest.detailCode, language) : "");
      status.show();
    }
    if (!picker) return;
    const activeId = picker.activeItems[0]?.taskId;
    const cancel = { iconPath: new api.ThemeIcon("close"), tooltip: language === "ko" ? "이 작업 취소" : "Cancel this task" };
    const row = (record: ModelTaskRecord, position?: number): TaskItem => ({
      label: record.label, description: modelTaskPhaseText(record.phase, language) + (position ? language === "ko" ? ` · 대기 순서 ${position}` : ` · position ${position}` : ""),
      detail: record.id + (record.failure ? " · " + modelTaskFailureText(record.failure, language) : "") + (record.detailCode ? " · " + modelTaskDiagnosticText(record.detailCode, language) : "")
        + (record.startedAt !== undefined && record.finishedAt !== undefined ? ` · ${((record.finishedAt - record.startedAt) / 1000).toFixed(1)} s` : ""),
      taskId: record.id, buttons: record === snapshot.active || position !== undefined ? [cancel] : []
    });
    const items = [...(snapshot.active ? [row(snapshot.active)] : []), ...snapshot.waiting.map((record, index) => row(record, index + 1)),
      ...[...snapshot.history].reverse().map(record => row(record))];
    picker.title = title() + " · " + waiting();
    picker.placeholder = language === "ko" ? "진행 중·대기 작업은 오른쪽 버튼으로 취소할 수 있습니다. 완료된 해설은 유지합니다." : "Use the row button to cancel running or waiting work. Saved explanations are retained.";
    picker.buttons = [{ iconPath: new api.ThemeIcon("clear-all"), tooltip: language === "ko" ? "현재 모델 작업 모두 취소" : "Cancel all current model tasks" }];
    picker.items = items.length ? items : [{ label: language === "ko" ? "모델 작업이 없습니다" : "No model tasks", description: language === "ko" ? "설명 버튼을 누르면 작업이 등록됩니다." : "Use an explanation button to add work." }];
    if (activeId) { const retained = picker.items.find(item => item.taskId === activeId); if (retained) picker.activeItems = [retained]; }
  }

  /** Inspection is read-only; only explicit cancel buttons alter queue ownership. */
  function open(): void {
    if (picker) { picker.show(); return; }
    const current = api.window.createQuickPick<TaskItem>(); picker = current;
    current.matchOnDescription = true; current.matchOnDetail = true;
    const subscriptions = [
      current.onDidTriggerItemButton(event => { if (event.item.taskId) manager.cancel(event.item.taskId); }),
      current.onDidTriggerButton(() => manager.cancelAll()),
      current.onDidAccept(() => current.hide()),
      current.onDidHide(() => { if (picker === current) picker = undefined; for (const disposable of subscriptions) disposable.dispose(); current.dispose(); })
    ];
    render(); current.show();
  }
  const subscription = manager.subscribe(value => { snapshot = value; render(); });
  const command = api.commands.registerCommand("projectAnalyzer.openModelTasks", open);
  return { updateLanguage(value) { language = value; render(); },
    dispose() { subscription.dispose(); command.dispose(); picker?.hide(); status.dispose(); } };
}
