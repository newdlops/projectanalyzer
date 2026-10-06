/** Native call-reading labels; model prose retains its separately displayed generation language. */
export function getFunctionCallNarrativesCatalogSource(): string {
  return /* js */ `
    Object.assign(projectAnalyzerUiCopy.en,{
      "calls-reading-callee-flow":"View callee flow",
      "calls-reading-title":"Call flow reading","calls-reading-overview":"Explain call structure","calls-reading-scenario":"Explain this source route","calls-reading-call":"Explain this callsite",
      "calls-reading-help":"Uses static relationships and caller/callee source. Descriptions are model inferences; code is not executed.",
      "calls-reading-idle":"Generate on demand. Selecting a route or call never starts a model.","calls-reading-unavailable":"Expand this function's calls to prepare source context; a language model must be configured.",
      "calls-reading-progress":"Explaining calls · {completed}/{total}","calls-reading-preparing":"Preparing the model and reading call source…","calls-reading-summarizing":"Calls explained · Connecting the whole flow…","calls-reading-ready":"Explained {completed}/{total} source callsites / visits",
      "calls-reading-complete":"Explanation ready","calls-reading-continue":"Continue call explanation","calls-reading-refresh":"Reload call source",
      "calls-reading-inference":"LLM inference · execution unverified · {model} · Generation: {language}","calls-reading-limited":"Source/route coverage is incomplete. Unknown dependencies and results remain unverified.",
      "calls-reading-select":"Call to read","calls-reading-site-select":"Callsite to explain","calls-reading-role":"Purpose","calls-reading-inputs":"Argument transfer","calls-reading-output":"Return and use","calls-reading-effects":"State and effects","calls-reading-reason":"Why this call",
      "calls-reading-callee":"Open callee source","calls-reading-page":"Calls page {page}/{count}","calls-reading-previous":"Previous calls","calls-reading-next":"Next calls","calls-reading-page-loading":"Reading saved call explanations…",
      "calls-reading-confidence-exact":"Exact source relation","calls-reading-confidence-resolved":"Resolved source target","calls-reading-confidence-inferred":"Inferred source target","calls-reading-confidence-unresolved":"Unresolved source target"
    });
    Object.assign(projectAnalyzerUiCopy.ko,{
      "calls-reading-callee-flow":"대상 함수 흐름 보기",
      "calls-reading-title":"호출 흐름 읽기","calls-reading-overview":"호출 구조 설명","calls-reading-scenario":"이 소스 경로 설명","calls-reading-call":"이 호출부 설명",
      "calls-reading-help":"정적 관계와 호출부·대상 함수 원문으로 설명합니다. 모델의 추론이며 소스 코드는 실행하지 않습니다.",
      "calls-reading-idle":"버튼을 눌러 생성합니다. 경로나 호출을 선택하는 것만으로 모델을 실행하지 않습니다.","calls-reading-unavailable":"이 함수의 하위 호출을 펼쳐 소스를 준비하세요. 언어 모델 설정도 필요합니다.",
      "calls-reading-progress":"호출 해설 중 · {completed}/{total}","calls-reading-preparing":"모델을 준비하고 호출 소스를 읽고 있습니다…","calls-reading-summarizing":"호출 해설 완료 · 전체 흐름을 연결하고 있습니다…","calls-reading-ready":"소스 호출부·방문 {completed}/{total}개 해설 완료",
      "calls-reading-complete":"해설 생성됨","calls-reading-continue":"호출 해설 이어서 생성","calls-reading-refresh":"호출 소스 다시 읽기",
      "calls-reading-inference":"LLM 추론 · 실제 실행 미검증 · {model} · 생성 언어: {language}","calls-reading-limited":"소스·경로를 완전히 확인하지 못했습니다. 외부 의존성과 결과는 미검증 상태입니다.",
      "calls-reading-select":"읽을 호출","calls-reading-site-select":"설명할 호출부","calls-reading-role":"호출 역할","calls-reading-inputs":"인자 전달","calls-reading-output":"반환과 사용","calls-reading-effects":"상태와 부수 효과","calls-reading-reason":"이 호출에 도달하는 이유",
      "calls-reading-callee":"대상 함수 소스 열기","calls-reading-page":"호출 해설 {page}/{count}페이지","calls-reading-previous":"이전 호출","calls-reading-next":"다음 호출","calls-reading-page-loading":"저장된 호출 해설을 읽고 있습니다…",
      "calls-reading-confidence-exact":"정확한 소스 관계","calls-reading-confidence-resolved":"대상 정의 확인","calls-reading-confidence-inferred":"호출 대상 추정","calls-reading-confidence-unresolved":"호출 대상 미확인"
    });
  `;
}
