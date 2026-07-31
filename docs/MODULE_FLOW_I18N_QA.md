# Module Flow i18n desktop QA

This procedure validates the runtime-language behavior with the committed
`src/test/fixtures/moduleFlowQaWorkspace` workspace. Its local settings start in
Korean, disable auto-analysis and persisted cache, and restrict analysis to its
TypeScript sources.

1. From the repository root, run `npm run dev:prepare`. Open the repository in
   VS Code, launch **Run Project Analyzer Extension**, and open the fixture folder
   in the Extension Development Host.
2. Open the **Code Flow** Activity Bar container. Its unresolved contribution
   labels use the VS Code display language; after the sidebar resolves, verify
   the child view title is `코드 이해` and the visible runtime copy is Korean.
3. Run **Analyze Workspace** and wait for the completed graph/status signal.
   Open **Project Module Flow**, choose the execution lens, select a module, open
   its detail, expand a boundary-function branch, and pan or zoom the canvas.
4. Change `projectAnalyzer.uiLanguage` from `ko` to `en`, then back to `ko`.
   Each switch must immediately update the resolved sidebar title, Module Flow
   editor-panel title, visible copy, and accessibility text. The selected lens,
   selected module/detail, expanded function branch, and viewport must remain.
   The completed graph must remain present without a new error.
5. Split the Module Flow editor narrowly beside another editor and repeat the
   title/copy check. Confirm controls and detail text remain visible rather than
   overlapping or causing page-level horizontal overflow.
6. Open **Developer: Toggle Developer Tools** and inspect Console after both
   switches; there must be no new Project Analyzer error. Do not expect the
   Activity Bar container, command/menu labels, Settings UI, or extension label
   to switch: those are immutable manifest labels and change only with VS Code's
   display language after reload.
7. Restore any user settings changed for the check. The fixture's `.vscode`
   settings are test-only and should not be copied into another workspace.
