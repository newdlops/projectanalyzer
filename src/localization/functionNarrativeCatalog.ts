/** Owned UI copy for source-reading LLM narratives; model-generated prose remains literal source-adjacent content. */
export function getFunctionNarrativeCatalogSource(): string {
  const en = {
    "narrative-heading": "Plain-language explanation", "narrative-action": "Generate explanation", "narrative-complete": "Explanation generated",
    "narrative-evidence": "Source evidence",
    "narrative-completion-status": "Generated {count} behavior scenarios.",
    "narrative-help": "The model reads this function and nearby code on request. Local mode releases model memory when finished.",
    "narrative-idle": "Read conditions, work and results as connected sentences.", "narrative-pending": "Reading the function and nearby code…", "narrative-cancel": "Cancel",
    "narrative-ready": "LLM inference · execution unverified", "narrative-unavailable": "No usable model is available. Check the local runner/model in Project Analyzer settings, or connect a VS Code Chat model.",
    "narrative-cancelled": "Generation cancelled. You can try again.", "narrative-denied": "Model access was declined. Allow access through VS Code to retry.",
    "narrative-timeout": "The model did not finish within 45 seconds. Try again.", "narrative-invalid-response": "The model response could not be validated. Try again.",
    "narrative-context-too-large": "This model's context window cannot fit the supplied snippets. Choose a model with a larger context window.",
    "narrative-failed": "The model request failed. Check the connection and try again.", "narrative-stale": "The function context expired. Reload this function, then generate again.", "narrative-refresh": "Reload function",
    "narrative-when": "Conditions", "narrative-outcome": "Expected outcome", "narrative-assumptions": "Assumptions", "narrative-limitations": "Missing information",
    "narrative-reason": "Reason", "narrative-effect": "Value and flow changes",
    "narrative-limited": "Only excerpts were supplied. Omitted code may change the behavior.", "narrative-source": "Source · {scenario}.{step} · L{start}–{end}",
    "narrative-source-help": "Open a cited line to read its LLM annotation in VS Code. Source edits clear the annotations.",
    "narrative-cached": "Reused this snapshot's result", "narrative-language": "Generated in {language}", "narrative-language-ko": "Korean", "narrative-language-en": "English"
  };
  const ko: Record<keyof typeof en, string> = {
    "narrative-heading": "문장형 설명", "narrative-action": "설명 생성", "narrative-complete": "설명 생성됨",
    "narrative-evidence": "소스 근거",
    "narrative-completion-status": "동작 시나리오 {count}개를 만들었습니다.",
    "narrative-help": "요청할 때만 함수와 주변 코드를 모델이 읽습니다. 로컬 모드는 생성 후 모델 메모리를 해제합니다.",
    "narrative-idle": "조건부터 동작과 결과까지 이어지는 문장으로 읽습니다.", "narrative-pending": "함수와 주변 코드를 읽는 중…", "narrative-cancel": "취소",
    "narrative-ready": "LLM 추론 · 실제 실행 미검증", "narrative-unavailable": "사용 가능한 모델이 없습니다. Project Analyzer 설정에서 로컬 실행 도구·모델을 확인하거나 VS Code Chat 모델을 연결하세요.",
    "narrative-cancelled": "생성을 취소했습니다. 다시 시도할 수 있습니다.", "narrative-denied": "모델 접근이 거부되었습니다. VS Code에서 접근을 허용한 뒤 다시 시도하세요.",
    "narrative-timeout": "모델이 45초 안에 응답을 완료하지 못했습니다. 다시 시도하세요.", "narrative-invalid-response": "모델 응답의 형식이나 소스 위치를 확인하지 못했습니다. 다시 시도하세요.",
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
