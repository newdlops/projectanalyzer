/** Korean/English copy for parent-controlled, explicitly assumed call scenarios. */
export function getFunctionCallScenariosCatalogSource(): string {
  return /* js */ `
    Object.assign(projectAnalyzerUiCopy.en, {
      "calls-view-order":"Call order", "calls-view-relations":"Call relationships", "calls-order-view":"Call view",
      "calls-order-title":"Parent call scenario", "calls-order-parent":"Read calls controlled by", "calls-order-inputs":"Check parent inputs",
      "calls-order-hint":"Follow a parent's decisions and loops to draft the order of project calls. Builtins and installed libraries are excluded.",
      "calls-order-loading":"Reading the parent's control flow…", "calls-order-unavailable":"The control flow is unavailable. Reload this function or inspect its call relationships.",
      "calls-order-example":"Example route", "calls-order-example-name":"Example {number} · calls: {count}", "calls-order-custom":"Custom scenario", "calls-order-new":"Start with no assumptions",
      "calls-order-assumed":"These conditions are assumptions; input values are unverified. Edit each decision to draft a route. Examples cover a bounded subset of paths.",
      "calls-order-conditions":"Scenario conditions", "calls-order-choice":"Branch outcome", "calls-order-loop-choice":"Assumed loop count", "calls-order-visit":"Decision {count}",
      "calls-order-jump-calls":"Go to calls", "calls-order-jump-conditions":"Go to conditions",
      "calls-order-choose":"Choose an outcome", "calls-order-iterations":"Iterations: {count}", "calls-order-no-conditions":"No branch choices before the calls on this route.",
      "calls-order-sequence":"Calls in order · {count}", "calls-order-call-action":"Call {count}: {call}. Show relationship.", "calls-order-source":"Source",
      "calls-order-iteration":"Iteration {count}", "calls-order-loop-start":"Iteration {count} of {total}", "calls-order-loop-end":"Leave loop · visits in this draft: {count}",
      "calls-order-awaiting":"Choose the next condition to continue this route.", "calls-order-limited":"The continuation is not fully known.",
      "calls-order-end-return":"Return from parent", "calls-order-end-throw":"Throw from parent", "calls-order-end-exit":"Parent ends",
      "calls-order-partial":"Some control or call-order evidence is incomplete. Unordered calls are available in Call relationships. This draft is not an execution result.",
      "calls-order-continue":"Continue with the next iteration", "calls-order-break":"Break out of the loop", "calls-order-deferred":"Separate dispatch · excluded from immediate call order", "calls-order-unknown":"Control evidence incomplete",
      "calls-order-next":"Continue", "calls-order-exit":"Exit", "calls-order-return":"Return", "calls-order-throw":"Throw", "calls-order-case":"Case", "calls-order-iterate":"Enter loop", "calls-order-repeat":"Repeat",
      "calls-order-draft":"Scenario draft", "calls-order-name":"Scenario name", "calls-order-draft-text":"Conditions and expected calls", "calls-order-copy":"Copy draft", "calls-order-copied":"Draft copied.", "calls-order-copy-fallback":"Select the draft and copy it with your keyboard."
    });
    Object.assign(projectAnalyzerUiCopy.ko, {
      "calls-view-order":"호출 순서", "calls-view-relations":"호출 관계", "calls-order-view":"호출 보기 방식",
      "calls-order-title":"상위 함수 호출 시나리오", "calls-order-parent":"호출을 제어하는 상위 함수", "calls-order-inputs":"상위 함수 입력값 확인",
      "calls-order-hint":"상위 함수의 조건과 반복을 따라 프로젝트 함수의 호출 순서를 구성하세요. 내장 함수와 설치된 라이브러리는 제외합니다.",
      "calls-order-loading":"상위 함수의 제어 흐름을 읽고 있습니다…", "calls-order-unavailable":"제어 흐름을 읽을 수 없습니다. 함수를 다시 불러오거나 호출 관계를 확인하세요.",
      "calls-order-example":"경로 예시", "calls-order-example-name":"예시 {number} · 호출 {count}회", "calls-order-custom":"직접 구성한 시나리오", "calls-order-new":"조건 없이 새로 구성",
      "calls-order-assumed":"선택한 조건을 가정한 초안이며 입력값은 아직 검증하지 않았습니다. 조건을 바꿔 경로를 구성하세요. 예시는 일부 경로만 보여줍니다.",
      "calls-order-conditions":"시나리오 조건", "calls-order-choice":"분기 결과", "calls-order-loop-choice":"가정한 반복 횟수", "calls-order-visit":"{count}번째 판단",
      "calls-order-jump-calls":"호출 순서로 이동", "calls-order-jump-conditions":"조건으로 이동",
      "calls-order-choose":"결과를 선택하세요", "calls-order-iterations":"{count}회 반복", "calls-order-no-conditions":"이 경로의 호출 앞에는 선택할 분기가 없습니다.",
      "calls-order-sequence":"호출 순서 · {count}회", "calls-order-call-action":"{count}번째 호출: {call}. 호출 관계 보기.", "calls-order-source":"소스",
      "calls-order-iteration":"{count}번째 반복", "calls-order-loop-start":"{total}회 중 {count}번째 반복", "calls-order-loop-end":"반복에서 나옴 · 이 초안에서 {count}회 진입",
      "calls-order-awaiting":"다음 조건을 선택하면 이후 호출이 이어집니다.", "calls-order-limited":"이후 제어 흐름을 완전히 확인하지 못했습니다.",
      "calls-order-end-return":"상위 함수에서 반환", "calls-order-end-throw":"상위 함수에서 예외 발생", "calls-order-end-exit":"상위 함수 종료",
      "calls-order-partial":"일부 제어·호출 순서의 근거가 부족합니다. 순서를 확인하지 못한 호출은 호출 관계에서 볼 수 있습니다. 이 초안은 실행 결과가 아닙니다.",
      "calls-order-continue":"다음 반복으로 이동", "calls-order-break":"반복 중단", "calls-order-deferred":"별도 실행 · 즉시 호출 순서에서 제외", "calls-order-unknown":"제어 흐름 일부 미확인",
      "calls-order-next":"이어서 진행", "calls-order-exit":"종료", "calls-order-return":"반환", "calls-order-throw":"예외 발생", "calls-order-case":"선택 분기", "calls-order-iterate":"반복 진입", "calls-order-repeat":"다시 반복",
      "calls-order-draft":"시나리오 초안", "calls-order-name":"시나리오 이름", "calls-order-draft-text":"조건과 예상 호출", "calls-order-copy":"초안 복사", "calls-order-copied":"초안을 복사했습니다.", "calls-order-copy-fallback":"초안 내용을 선택한 뒤 키보드로 복사하세요."
    });
  `;
}
