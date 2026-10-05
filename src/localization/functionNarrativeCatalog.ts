/** Owned UI copy for source-reading LLM narratives; model-generated prose remains literal source-adjacent content. */
export function getFunctionNarrativeCatalogSource(): string {
  const en = {
    "narrative-heading": "Plain-language explanation", "narrative-action": "Analyze all scenarios", "narrative-complete": "Explanation generated",
    "narrative-continue": "Continue scenario analysis", "narrative-progress": "Analyzed {count} scenarios; processing remaining source paths…",
    "narrative-progress-total": "Analyzed {count} of {total} scenarios…", "narrative-page-loading": "Loading saved scenarios…",
    "narrative-partial-status": "Analyzed {count} scenarios. Continue to analyze remaining paths.",
    "narrative-page-label": "Results {page} of {pages} · scenarios {start}–{end}", "narrative-previous": "Previous scenarios", "narrative-next": "Next scenarios",
    "narrative-source-incomplete": "All discovered scenarios were analyzed, but omitted or unsupported source may contain additional paths.",
    "narrative-evidence": "Source evidence",
    "narrative-completion-status": "Generated {count} behavior scenarios.",
    "narrative-help": "Analyze every source path in sequential batches. Local mode downloads its model on first use and releases model memory when finished. You can cancel and resume; completed scenarios are retained.",
    "narrative-idle": "Read conditions, work and results as connected sentences.", "narrative-pending": "Preparing the model and reading the function…", "narrative-cancel": "Cancel",
    "narrative-ready": "LLM inference · execution unverified", "narrative-unavailable": "Install llama.cpp and set its llama-completion path in Project Analyzer settings, or connect a VS Code Chat model. The default local model downloads automatically.",
    "narrative-download-failed": "Model preparation failed. Check network/proxy settings and disk space, then retry. An interrupted download resumes automatically.",
    "narrative-cancelled": "Generation cancelled. You can try again.", "narrative-denied": "Model access was declined. Allow access through VS Code to retry.",
    "narrative-timeout": "This scenario batch timed out. Completed scenarios are retained; continue to retry the remaining paths.", "narrative-invalid-response": "The model response could not be validated. Try again.",
    "narrative-language-mismatch": "The model did not use the requested language. Generate again to retry.",
    "narrative-context-too-large": "This model's context window cannot fit the supplied snippets. Choose a model with a larger context window.",
    "narrative-failed": "The model request failed. Check the connection and try again.", "narrative-stale": "The function context expired. Reload this function, then generate again.", "narrative-refresh": "Reload function",
    "narrative-when": "Conditions", "narrative-outcome": "Expected outcome", "narrative-assumptions": "Assumptions", "narrative-limitations": "Missing information",
    "narrative-reason": "Reason", "narrative-effect": "Value and flow changes",
    "narrative-limited": "Only excerpts were supplied. Omitted code may change the behavior.", "narrative-source": "Source · {scenario}.{step} · L{start}–{end}",
    "narrative-source-help": "Open a cited line to read its LLM annotation in VS Code. Source edits clear the annotations.",
    "narrative-cached": "Reused this snapshot's result", "narrative-language": "Generated in {language}", "narrative-language-ko": "Korean", "narrative-language-en": "English"
  };
  const ko: Record<keyof typeof en, string> = {
    "narrative-heading": "문장형 설명", "narrative-action": "전체 시나리오 분석", "narrative-complete": "설명 생성됨",
    "narrative-continue": "이어서 시나리오 분석", "narrative-progress": "시나리오 {count}개 분석 · 남은 소스 경로를 처리하고 있습니다…",
    "narrative-progress-total": "전체 {total}개 중 {count}개 분석 중…", "narrative-page-loading": "저장된 시나리오를 불러오는 중…",
    "narrative-partial-status": "시나리오 {count}개를 분석했습니다. 이어서 남은 경로를 분석할 수 있습니다.",
    "narrative-page-label": "결과 {page}/{pages} · 시나리오 {start}–{end}", "narrative-previous": "이전 시나리오", "narrative-next": "다음 시나리오",
    "narrative-source-incomplete": "발견한 시나리오는 모두 분석했지만 생략되거나 지원하지 않는 소스에 추가 경로가 있을 수 있습니다.",
    "narrative-evidence": "소스 근거",
    "narrative-completion-status": "동작 시나리오 {count}개를 만들었습니다.",
    "narrative-help": "함수의 모든 소스 경로를 순차 분석합니다. 로컬 모델은 첫 사용 때 자동 다운로드하고 생성 후 메모리를 해제합니다. 취소 후 이어서 진행할 수 있고 완료된 시나리오는 보존합니다.",
    "narrative-idle": "조건부터 동작과 결과까지 이어지는 문장으로 읽습니다.", "narrative-pending": "모델을 준비하고 함수를 읽는 중…", "narrative-cancel": "취소",
    "narrative-ready": "LLM 추론 · 실제 실행 미검증", "narrative-unavailable": "llama.cpp를 설치하고 Project Analyzer 설정에 llama-completion 경로를 지정하거나 VS Code Chat 모델을 연결하세요. 기본 로컬 모델은 자동 다운로드합니다.",
    "narrative-download-failed": "모델 준비에 실패했습니다. 네트워크·프록시 설정과 저장 공간을 확인한 뒤 다시 분석하세요. 중단된 다운로드는 자동으로 이어받습니다.",
    "narrative-cancelled": "생성을 취소했습니다. 다시 시도할 수 있습니다.", "narrative-denied": "모델 접근이 거부되었습니다. VS Code에서 접근을 허용한 뒤 다시 시도하세요.",
    "narrative-timeout": "현재 시나리오 묶음의 응답 시간이 초과됐습니다. 완료된 결과는 보존합니다. 이어서 남은 경로를 다시 분석하세요.", "narrative-invalid-response": "모델 응답의 형식이나 소스 위치를 확인하지 못했습니다. 다시 시도하세요.",
    "narrative-language-mismatch": "모델이 요청한 언어로 설명하지 않았습니다. 설명 생성을 다시 눌러 시도하세요.",
    "narrative-context-too-large": "이 모델의 입력 한도에 코드 스니펫이 들어가지 않습니다. 입력 한도가 더 큰 모델을 선택하세요.",
    "narrative-failed": "모델 요청에 실패했습니다. 연결을 확인한 뒤 다시 시도하세요.", "narrative-stale": "함수 컨텍스트가 만료되었습니다. 함수를 다시 불러온 뒤 생성하세요.", "narrative-refresh": "함수 다시 불러오기",
    "narrative-when": "조건", "narrative-outcome": "예상 결과", "narrative-assumptions": "가정", "narrative-limitations": "미확인 부분",
    "narrative-reason": "판단 근거", "narrative-effect": "값과 흐름의 변화",
    "narrative-limited": "코드 일부만 전달했습니다. 생략한 코드에 따라 동작이 달라질 수 있습니다.", "narrative-source": "소스 · {scenario}.{step} · L{start}–{end}",
    "narrative-source-help": "인용한 줄을 열면 VS Code에서 LLM 해설을 확인할 수 있습니다. 소스를 수정하면 표시가 지워집니다.",
    "narrative-cached": "이 스냅샷의 결과 재사용", "narrative-language": "생성 언어: {language}", "narrative-language-ko": "한국어", "narrative-language-en": "영어"
  };
  return `Object.assign(projectAnalyzerUiCopy.en, ${JSON.stringify(en)}); Object.assign(projectAnalyzerUiCopy.ko, ${JSON.stringify(ko)});`;
}
