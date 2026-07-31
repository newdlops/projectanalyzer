/**
 * Shared UI locale contract. This module deliberately contains only owned
 * presentation text; source code, identifiers, paths, and external errors
 * remain literals at their original boundary.
 */

/** Resolved locale that may cross the Extension Host/Webview protocol. */
export type UiLanguage = "ko" | "en";
/** User preference accepted by the public VS Code setting. */
export type UiLanguagePreference = "auto" | UiLanguage;

/** Resolves explicit settings first, then the VS Code display locale. */
export function resolveUiLanguage(preference: unknown, vscodeLanguage?: string): UiLanguage {
  if (preference === "ko" || preference === "en") return preference;
  return /^ko(?:-|$)/i.test(vscodeLanguage ?? "") ? "ko" : "en";
}

/** Small Host catalog used for mutable panel chrome and owned error wrappers. */
const hostCopy = {
  en: {
    explorerView: "Understand Code",
    functionVisualizer: "Function Visualizer",
    functionFlow: "Function Flow",
    moduleFlow: "Module Flow",
    projectGraph: "Project Analyzer Graph",
    anonymous: "Anonymous",
    saveSourceFirst: "Save this supported source file before visualizing its function flow.",
    placeCursor: "Place the cursor inside a supported function, method, constructor, lambda, or callback.",
    visualizing: "Code Flow: visualizing {name}",
    visualizeFailed: "Could not visualize the current function: {detail}",
    preparingModule: "Code Flow: preparing project module flow",
    openWorkspace: "Open a workspace folder before visualizing project Module Flow.",
    moduleOpened: "Module Flow opened in an editor tab.",
    functionVisualizerOpened: "Function Visualizer opened in a new tab",
    analyzingWorkspace: "Analyzing workspace", indexedWorkspace: "Indexed {files} files, {nodes} nodes",
    moduleFailed: "Could not open project Module Flow: {detail}", exportCompleted: "Export completed: {detail}", analysisAlreadyRunning: "Analysis already running", openWorkspaceFolder: "Open a workspace folder first", loadedCachedWorkspace: "Loaded cached workspace graph, {nodes} nodes", analysisFailed: "Analysis failed", unknownAnalysisFailure: "Unknown analysis failure", openSourceFile: "Open a source file first", analyzingCurrentFile: "Analyzing current file", loadedCachedFile: "Loaded cached {file}, {nodes} nodes", analyzedFile: "Analyzed {file}, {nodes} nodes", currentFileAnalysisFailed: "Current-file analysis failed", unknownCurrentFileAnalysisFailure: "Unknown current-file analysis failure", cacheClearFailed: "In-memory graph cleared; persisted cache could not be cleared", cacheCleared: "Cache cleared", noAnalysisRunning: "No analysis is running", cancellationPending: "Cancellation will stop future analyzer workers", analyzeBeforeExport: "Analyze before exporting", exportNotImplemented: "{format} export is not implemented yet", exportCanceled: "Export canceled", graphBrowserEmpty: "Graph browser opened; analyze to load graph", graphBrowserOpened: "Graph browser opened", analyzeBeforeFocus: "Analyze before focusing graph nodes", graphBrowserFocused: "Graph browser focused", graphRenderingDisabled: "Graph rendering is temporarily disabled", analyzeBeforeFunctionFlows: "Analyze before loading function flows", graphChangedChooseFunction: "The analyzed graph changed; choose the function again", functionUnavailable: "This function is no longer available", nodeUnavailable: "Node is not available", noGraphLoaded: "No graph loaded",
    staleGraph: "The analyzed graph changed. {action}", startAgain: "Start the flow again.", searchAgain: "Search again.", visualizeAgain: "Visualize the function again.", reopenLogic: "Reopen the function logic.", flowNotFound: "This flow is not available in the current analysis.", sourceNotFound: "This source result is no longer available.", sourceNotCallable: "Select a concrete function, method, or constructor.", evidenceNotFound: "This statement evidence is no longer available.", currentFunctionUnavailable: "The current function is not available in this analysis.", cursorNotCallable: "The cursor is not inside a concrete callable.", tutorUnavailable: "Function Guide could not parse the selected declaration; source-backed graph facts remain available.", moduleBuildFailed: "Could not build Module Flow: {detail}", graphItemUnavailable: "The selected graph item is unavailable.", moduleNotExpandable: "This module cannot be expanded in the active graph.", functionDetached: "This function is no longer attached to the active Module Flow.", functionEvidenceExpired: "This function statement evidence has expired.", sourceEvidenceExpired: "This source evidence has expired.", sourceDefinitionExpired: "This source definition has expired.", moduleGraphStale: "The project graph changed. Reload Module Flow and try again.",
    unknownVisualizationFailure: "Unknown visualization failure", unknownModuleFailure: "Unknown module visualization failure",
    analysisFailedDetail: "Analysis failed: {detail}",
    currentFileAnalysisFailedDetail: "Current-file analysis failed: {detail}",
    exportSucceeded: "Exported {nodes} nodes",
    exportGraph: "Export Graph",
    noCallersFound: "No callers found for {name}", noCalleesFound: "No callees found for {name}",
    showingCallers: "Showing callers for {name} ({count} call edges, depth {depth})", showingCallees: "Showing callees for {name} ({count} call edges, depth {depth})",
  },
  ko: {
    explorerView: "코드 이해",
    functionVisualizer: "함수 시각화",
    functionFlow: "함수 흐름",
    moduleFlow: "모듈 흐름",
    projectGraph: "프로젝트 분석 그래프",
    anonymous: "익명",
    saveSourceFirst: "함수 흐름을 시각화하기 전에 지원되는 소스 파일을 저장하세요.",
    placeCursor: "지원되는 함수, 메서드, 생성자, 람다 또는 콜백 안에 커서를 두세요.",
    visualizing: "코드 흐름: {name} 시각화 중",
    visualizeFailed: "현재 함수를 시각화할 수 없음: {detail}",
    preparingModule: "코드 흐름: 프로젝트 모듈 흐름 준비 중",
    openWorkspace: "프로젝트 모듈 흐름을 시각화하기 전에 작업 영역 폴더를 여세요.",
    moduleOpened: "편집기 탭에서 모듈 흐름을 열었습니다.",
    functionVisualizerOpened: "새 탭에서 함수 시각화를 열었습니다.",
    analyzingWorkspace: "작업 영역 분석 중", indexedWorkspace: "파일 {files}개, 노드 {nodes}개를 인덱싱했습니다",
    moduleFailed: "프로젝트 모듈 흐름을 열 수 없음: {detail}", exportCompleted: "내보내기 완료: {detail}", analysisAlreadyRunning: "분석이 이미 실행 중입니다", openWorkspaceFolder: "먼저 작업 영역 폴더를 여세요", loadedCachedWorkspace: "캐시된 작업 영역 그래프를 불러왔습니다. 노드 {nodes}개", analysisFailed: "분석에 실패했습니다", unknownAnalysisFailure: "알 수 없는 분석 실패", openSourceFile: "먼저 소스 파일을 여세요", analyzingCurrentFile: "현재 파일 분석 중", loadedCachedFile: "캐시된 {file}을(를) 불러왔습니다. 노드 {nodes}개", analyzedFile: "{file}을(를) 분석했습니다. 노드 {nodes}개", currentFileAnalysisFailed: "현재 파일 분석에 실패했습니다", unknownCurrentFileAnalysisFailure: "알 수 없는 현재 파일 분석 실패", cacheClearFailed: "메모리 그래프는 지웠지만 유지된 캐시를 지울 수 없습니다", cacheCleared: "캐시를 지웠습니다", noAnalysisRunning: "실행 중인 분석이 없습니다", cancellationPending: "향후 analyzer 작업자가 중지됩니다", analyzeBeforeExport: "내보내기 전에 분석하세요", exportNotImplemented: "{format} 내보내기는 아직 구현되지 않았습니다", exportCanceled: "내보내기를 취소했습니다", graphBrowserEmpty: "그래프 브라우저를 열었습니다. 그래프를 불러오려면 분석하세요", graphBrowserOpened: "그래프 브라우저를 열었습니다", analyzeBeforeFocus: "그래프 노드에 포커스하기 전에 분석하세요", graphBrowserFocused: "그래프 브라우저에 포커스했습니다", graphRenderingDisabled: "그래프 렌더링이 일시적으로 비활성화되어 있습니다", analyzeBeforeFunctionFlows: "함수 흐름을 불러오기 전에 분석하세요", graphChangedChooseFunction: "분석된 그래프가 변경되었습니다. 함수를 다시 선택하세요", functionUnavailable: "이 함수는 더 이상 사용할 수 없습니다", nodeUnavailable: "노드를 사용할 수 없습니다", noGraphLoaded: "불러온 그래프가 없습니다",
    staleGraph: "분석된 그래프가 변경되었습니다. {action}", startAgain: "흐름을 다시 시작하세요.", searchAgain: "다시 검색하세요.", visualizeAgain: "함수를 다시 시각화하세요.", reopenLogic: "함수 로직을 다시 여세요.", flowNotFound: "이 흐름은 현재 분석에서 사용할 수 없습니다.", sourceNotFound: "이 소스 결과는 더 이상 사용할 수 없습니다.", sourceNotCallable: "구체적인 함수, 메서드 또는 생성자를 선택하세요.", evidenceNotFound: "이 문 근거는 더 이상 사용할 수 없습니다.", currentFunctionUnavailable: "현재 함수는 이 분석에서 사용할 수 없습니다.", cursorNotCallable: "커서가 구체적인 호출 가능 항목 안에 있지 않습니다.", tutorUnavailable: "함수 가이드가 선택한 선언을 해석할 수 없지만 소스 기반 그래프 사실은 계속 사용할 수 있습니다.", moduleBuildFailed: "모듈 흐름을 만들 수 없음: {detail}", graphItemUnavailable: "선택한 그래프 항목을 사용할 수 없습니다.", moduleNotExpandable: "이 모듈은 활성 그래프에서 확장할 수 없습니다.", functionDetached: "이 함수는 더 이상 활성 모듈 흐름에 연결되어 있지 않습니다.", functionEvidenceExpired: "이 함수 문 근거가 만료되었습니다.", sourceEvidenceExpired: "이 소스 근거가 만료되었습니다.", sourceDefinitionExpired: "이 소스 정의가 만료되었습니다.", moduleGraphStale: "프로젝트 그래프가 변경되었습니다. 모듈 흐름을 다시 불러오고 시도하세요.",
    unknownVisualizationFailure: "알 수 없는 시각화 실패", unknownModuleFailure: "알 수 없는 모듈 시각화 실패",
    analysisFailedDetail: "분석에 실패했습니다: {detail}",
    currentFileAnalysisFailedDetail: "현재 파일 분석에 실패했습니다: {detail}",
    exportSucceeded: "노드 {nodes}개를 내보냈습니다",
    exportGraph: "그래프 내보내기",
    noCallersFound: "{name}의 호출자를 찾지 못했습니다", noCalleesFound: "{name}의 호출 대상을 찾지 못했습니다",
    showingCallers: "{name}의 호출자 표시 중 (호출 간선 {count}개, 깊이 {depth})", showingCallees: "{name}의 호출 대상 표시 중 (호출 간선 {count}개, 깊이 {depth})",
  }
} as const;

export type HostMessageKey = keyof typeof hostCopy.en;

/** Formats an owned Host message without ever interpreting source-derived text. */
export function localizeHost(
  language: UiLanguage,
  key: HostMessageKey,
  values: Record<string, string | number> = {}
): string {
  return hostCopy[language][key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
}
