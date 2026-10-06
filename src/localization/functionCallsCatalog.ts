/** Localized controls and static-evidence explanations for the separate function-call diagram. */
import { getFunctionCallScenariosCatalogSource } from "./functionCallScenariosCatalog";
import { getFunctionCallNarrativesCatalogSource } from "./functionCallNarrativesCatalog";
export function getFunctionCallsCatalogSource(): string {
  return /* js */ `
    ${getFunctionCallScenariosCatalogSource()}
    ${getFunctionCallNarrativesCatalogSource()}
    Object.assign(projectAnalyzerUiCopy.en, {
      "function-modes":"Diagram mode", "function-mode-statements":"Statement flow", "function-mode-calls":"Function calls",
      "calls-title":"Function calls", "calls-hint":"One node per identified project function. Builtins and installed libraries are excluded. Select a function to explore its calls, conditions and loops.",
      "calls-root":"Starting function", "calls-count":"{nodes} project functions · {edges} callsites",
      "calls-multiple-conditions":"Select to compare conditions",
      "calls-nullish":"null / undefined", "calls-notNullish":"not null / undefined",
      "calls-loading":"Reading calls in {name}…", "calls-failed":"Calls could not be read. Retry this function.",
      "calls-unavailable":"This function has no available project source.", "calls-stale":"This snapshot expired. Visualize the function again.",
      "calls-idle":"Switch to Function calls to load the starting function.", "calls-empty":"No calls to identified project functions. Builtins, installed libraries and unresolved targets are excluded.",
      "calls-partial":"Some source relationships could not be analyzed completely.", "calls-limited":"Diagram limit reached. Open a function's statement flow to explore further.",
      "calls-omitted":"At least {count} callsites omitted by the analysis limit.", "calls-expand":"Expand calls", "calls-loaded":"Calls expanded", "calls-retry":"Retry calls",
      "calls-open":"Open statement flow", "calls-site":"Open callsite", "calls-unknown":"Unresolved target",
      "calls-direct":"No additional source guard", "calls-context-unknown":"Call conditions not fully known",
      "calls-loop":"Inside loop", "calls-cycle":"Recursive / cyclic calls", "calls-deferred":"Deferred dispatch",
      "calls-relation-call":"Call", "calls-relation-render":"Render", "calls-relation-event":"Event handler",
      "calls-incoming":"Called from", "calls-outgoing":"Calls from this function", "calls-sites":"{count} callsites",
      "calls-list":"Call list", "calls-graph":"Function call graph. Select a function or connection; pan inside the canvas.",
      "calls-legend":"Solid: resolved target · Dashed: inferred / deferred · Loop labels describe source repetition",
      "calls-selected-edge":"Selected connection", "calls-depth":"Expansion depth limit reached (6).", "calls-true":"true", "calls-false":"false",
      "calls-exception":"exception", "calls-finally":"finally", "calls-no-connections":"No connections in the current diagram."
    });
    Object.assign(projectAnalyzerUiCopy.ko, {
      "function-modes":"다이어그램 모드", "function-mode-statements":"구문 흐름", "function-mode-calls":"함수 호출",
      "calls-title":"함수 호출", "calls-hint":"프로젝트에서 정의를 확인한 함수만 표시합니다. 내장 함수와 설치된 라이브러리는 제외합니다. 함수를 선택해 하위 호출과 조건·반복을 확인하세요.",
      "calls-root":"시작 함수", "calls-count":"프로젝트 함수 {nodes}개 · 호출 지점 {edges}개",
      "calls-multiple-conditions":"선택하여 조건 비교",
      "calls-nullish":"null / undefined", "calls-notNullish":"null / undefined 아님",
      "calls-loading":"{name}의 호출을 읽고 있습니다…", "calls-failed":"호출을 읽지 못했습니다. 이 함수를 다시 시도하세요.",
      "calls-unavailable":"이 함수에서 읽을 수 있는 프로젝트 소스가 없습니다.", "calls-stale":"분석 스냅샷이 만료됐습니다. 함수를 다시 시각화하세요.",
      "calls-idle":"함수 호출 모드를 선택하면 시작 함수의 호출을 불러옵니다.", "calls-empty":"정의가 확인된 프로젝트 함수로의 하위 호출이 없습니다. 내장 함수·설치된 라이브러리·대상 미확인 호출은 제외됩니다.",
      "calls-partial":"일부 소스 관계를 완전히 분석하지 못했습니다.", "calls-limited":"다이어그램 한도에 도달했습니다. 함수의 구문 흐름을 열어 더 살펴보세요.",
      "calls-omitted":"분석 한도로 호출 지점 {count}개 이상을 생략했습니다.", "calls-expand":"하위 호출 펼치기", "calls-loaded":"하위 호출 펼쳐짐", "calls-retry":"호출 다시 읽기",
      "calls-open":"구문 흐름 보기", "calls-site":"호출 위치 열기", "calls-unknown":"호출 대상 미확인",
      "calls-direct":"추가 소스 조건 없음", "calls-context-unknown":"호출 조건 일부 미확인",
      "calls-loop":"반복 안에서 호출", "calls-cycle":"재귀 / 순환 호출", "calls-deferred":"나중에 실행되는 호출",
      "calls-relation-call":"호출", "calls-relation-render":"렌더", "calls-relation-event":"이벤트 처리",
      "calls-incoming":"이 함수를 부르는 곳", "calls-outgoing":"이 함수가 부르는 곳", "calls-sites":"호출 지점 {count}개",
      "calls-list":"호출 목록", "calls-graph":"함수 호출 그래프. 함수나 연결선을 선택하세요. 캔버스 안에서 이동할 수 있습니다.",
      "calls-legend":"실선: 확인된 대상 · 점선: 추정 / 지연 호출 · 반복 표시는 소스의 루프를 뜻합니다",
      "calls-selected-edge":"선택한 호출 관계", "calls-depth":"호출 깊이 한도(6)에 도달했습니다.", "calls-true":"참", "calls-false":"거짓",
      "calls-exception":"예외", "calls-finally":"마지막 처리", "calls-no-connections":"현재 다이어그램에 연결이 없습니다."
    });
  `;
}
