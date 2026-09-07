/** Korean/English copy for source reading and the focused Inspector panels. */
export function getFunctionReadingCatalogSource(): string {
  return /* js */ `
    Object.assign(projectAnalyzerUiCopy.en, {
      "reading-outline": "Outline", "reading-title": "Read the function",
      "reading-description": "Follow source order. Select a step to find it on the graph.",
      "reading-show": "Show source outline", "reading-hide": "Hide source outline",
      "reading-filter-label": "Filter source steps", "reading-filter-all": "All",
      "reading-filter-decisions": "Branches", "reading-filter-calls": "Calls", "reading-filter-exits": "Exits",
      "reading-no-match": "No steps in this category. Choose All to continue reading.",
      "reading-previous": "← Prev", "reading-next": "Next →",
      "reading-previous-title": "Previous source step", "reading-next-title": "Next source step",
      "reading-position": "{current} / {count} steps", "reading-shown": "{count} steps",
      "reading-omitted": " · {count} more on graph", "reading-step": "Read step {ordinal}: {kind} · {label}",
      "reading-inspector-tabs": "Function details", "reading-details": "Details",
      "reading-tab-code": "Understand code", "reading-tab-values": "Values & paths", "reading-tab-info": "Function info",
      "reading-tab-code-hint": "What this step does, and where it can go next.",
      "reading-tab-values-hint": "Change inputs and compare possible source paths.",
      "reading-tab-info-hint": "Inspect the signature and connected functions.",
      "reading-legend": "Graph key",
      "reading-static-order": "Source order · possible paths, not runtime order",
      "reading-unavailable": "Function analysis is unavailable",
      "reading-retry": "Retry analysis", "reading-retry-hint": "Try again. If the source changed, select the function in the editor and visualize it again.",
      "reading-loading-hint": "Preparing the function's source steps and connections."
    });
    Object.assign(projectAnalyzerUiCopy.ko, {
      "reading-outline": "코드 목차", "reading-title": "함수 따라 읽기",
      "reading-description": "소스 순서대로 읽어 보세요. 단계를 선택하면 그래프에서 찾아줍니다.",
      "reading-show": "코드 목차 펼치기", "reading-hide": "코드 목차 접기",
      "reading-filter-label": "코드 단계 필터", "reading-filter-all": "전체",
      "reading-filter-decisions": "분기", "reading-filter-calls": "호출", "reading-filter-exits": "종료",
      "reading-no-match": "이 분류에 해당하는 단계가 없습니다. 전체를 선택해 이어서 읽으세요.",
      "reading-previous": "← 이전", "reading-next": "다음 →",
      "reading-previous-title": "이전 소스 단계", "reading-next-title": "다음 소스 단계",
      "reading-position": "{current} / {count} 단계", "reading-shown": "{count}개 단계",
      "reading-omitted": " · 그래프에 {count}개 더 있음", "reading-step": "{ordinal}번째 단계 읽기: {kind} · {label}",
      "reading-inspector-tabs": "함수 상세 정보", "reading-details": "상세 보기",
      "reading-tab-code": "코드 이해", "reading-tab-values": "값과 경로", "reading-tab-info": "함수 정보",
      "reading-tab-code-hint": "이 단계가 하는 일과 다음 경로를 확인하세요.",
      "reading-tab-values-hint": "입력값을 바꾸고 가능한 소스 경로를 비교하세요.",
      "reading-tab-info-hint": "함수의 선언과 연결된 함수를 확인하세요.",
      "reading-legend": "기호 안내",
      "reading-static-order": "소스 순서 · 실제 실행 순서와 다를 수 있습니다",
      "reading-unavailable": "함수 분석을 완료하지 못했습니다",
      "reading-retry": "다시 분석", "reading-retry-hint": "다시 시도해 보세요. 소스가 바뀌었다면 편집기에서 함수를 선택해 다시 시각화하세요.",
      "reading-loading-hint": "함수의 코드 단계와 연결 관계를 준비하고 있습니다."
    });
  `;
}
