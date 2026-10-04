/** Owns one bounded editor annotation result; source changes revoke it instead of moving stale model prose. */
import type * as vscode from "vscode";
import { createContentHash } from "../../shared/hash";
import { buildFunctionNarrativeSourceAnnotations, type FunctionNarrativeSourcePresentation, type FunctionNarrativeSourcePresenter } from "../../shared/functionNarratives";
import { createNarrativeSourceHover } from "./hover";

/** Extension-session lifecycle. Native editor/configuration events only render or clear; they never infer. */
export class FunctionNarrativeDecorationService implements vscode.Disposable {
  private readonly type: vscode.TextEditorDecorationType;
  private readonly subscriptions: vscode.Disposable[];
  private readonly decorated = new Set<vscode.TextEditor>();
  private current?: { owner: object; presentation: FunctionNarrativeSourcePresentation };
  private disposed = false;

  public constructor(private readonly api: typeof vscode) {
    this.type = api.window.createTextEditorDecorationType({ isWholeLine: true,
      borderColor: new api.ThemeColor("editorCodeLens.foreground"), borderStyle: "none none dotted none", borderWidth: "0 0 1px 0",
      overviewRulerColor: new api.ThemeColor("editorCodeLens.foreground"), overviewRulerLane: api.OverviewRulerLane.Right,
      rangeBehavior: api.DecorationRangeBehavior.ClosedClosed });
    this.subscriptions = [
      api.window.onDidChangeVisibleTextEditors(() => this.render()),
      api.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length && this.matches(event.document)) this.clearCurrent();
      }),
      api.workspace.onDidCloseTextDocument((document) => { if (this.matches(document)) this.clearCurrent(); }),
      api.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("projectAnalyzer.functionNarratives.sourceDecorations") && !this.enabled()) this.clearCurrent();
      }),
      api.commands.registerCommand("projectAnalyzer.clearFunctionNarrativeDecorations", () => this.clearCurrent())
    ];
  }

  /** A stable ownership token lets each panel revoke only its own last successful result. */
  public createPresenter(): FunctionNarrativeSourcePresenter {
    const owner = {};
    return {
      show: (presentation) => {
        if (this.current?.owner === owner) this.clearCurrent();
        if (this.disposed || !this.enabled() || !/^[0-9a-f]{64}$/u.test(presentation.sourceHash)) return;
        // Git revisions and virtual documents can share fsPath with a working file.
        const open = this.api.workspace.textDocuments.find((document) => document.uri.scheme === "file" && document.uri.fsPath === presentation.filePath);
        if (open && createContentHash(open.getText()) !== presentation.sourceHash) return;
        if (!buildFunctionNarrativeSourceAnnotations(presentation.narrative, presentation.snippets).length) return;
        this.current = { owner, presentation }; this.render();
      },
      clear: () => { if (this.current?.owner === owner) this.clearCurrent(); }
    };
  }

  /** Releases only this feature's decorations, native listeners and the shared decoration type. */
  public dispose(): void {
    if (this.disposed) return;
    this.clearCurrent(); this.disposed = true;
    for (const subscription of this.subscriptions) subscription.dispose();
    this.type.dispose();
  }

  private enabled(): boolean { return this.api.workspace.getConfiguration("projectAnalyzer.functionNarratives").get<boolean>("sourceDecorations", true); }
  private matches(document: vscode.TextDocument): boolean { return document.uri.scheme === "file" && this.current?.presentation.filePath === document.uri.fsPath; }

  /** Reopening a matching source editor restores hints without changing focus or loading a model. */
  private render(): void {
    this.clearEditors();
    const presentation = this.current?.presentation;
    if (!presentation || this.disposed || !this.enabled()) return;
    const annotations = buildFunctionNarrativeSourceAnnotations(presentation.narrative, presentation.snippets);
    for (const editor of this.api.window.visibleTextEditors) {
      if (!this.matches(editor.document)) continue;
      if (createContentHash(editor.document.getText()) !== presentation.sourceHash) { this.clearCurrent(); return; }
      const options: vscode.DecorationOptions[] = annotations.map((annotation) => ({
        range: editor.document.lineAt(annotation.line - 1).range,
        hoverMessage: createNarrativeSourceHover(this.api, presentation, annotation),
        renderOptions: { after: { contentText: annotation.hint, color: new this.api.ThemeColor("editorCodeLens.foreground"),
          margin: "0 0 0 2em", fontStyle: "italic" } }
      }));
      editor.setDecorations(this.type, options); this.decorated.add(editor);
    }
    void this.api.commands.executeCommand("setContext", "projectAnalyzer.hasNarrativeDecorations", true);
  }

  /** No file writes, timers, inference or interaction with the graph's separate exact-source highlight. */
  private clearCurrent(): void {
    this.current = undefined; this.clearEditors();
    void this.api.commands.executeCommand("setContext", "projectAnalyzer.hasNarrativeDecorations", false);
  }
  private clearEditors(): void {
    for (const editor of this.decorated) editor.setDecorations(this.type, []);
    this.decorated.clear();
  }
}
