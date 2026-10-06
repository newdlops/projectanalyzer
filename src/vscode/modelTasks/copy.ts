/** Native task labels follow the extension language; diagnostic enums never expose source or model prose. */
import type { ModelTaskRecord } from "../../shared/modelTasks";
export function modelTaskPhaseText(phase: ModelTaskRecord["phase"], language: "ko" | "en"): string {
  const ko = { queued: "대기", preparing: "모델 준비", running: "실행", cancelling: "중단·정리 중", completed: "완료", failed: "실패", cancelled: "취소", timeout: "시간 초과" };
  const en = { queued: "Queued", preparing: "Preparing", running: "Running", cancelling: "Stopping", completed: "Completed", failed: "Failed", cancelled: "Cancelled", timeout: "Timed out" };
  return (language === "ko" ? ko : en)[phase];
}
export function modelTaskFailureText(code: string | undefined, language: "ko" | "en"): string {
  const ko: Record<string, string> = { "invalid-response": "응답 검증 실패", "language-mismatch": "설명 언어 불일치", "download-failed": "모델 준비 실패",
    "queue-full": "대기열 가득 참", unavailable: "실행 도구·모델 미확인", denied: "모델 접근 거부", "context-too-large": "입력 한도 초과", failed: "모델 실행 실패", timeout: "실행 시간 초과", cancelled: "취소" };
  const en: Record<string, string> = { "invalid-response": "Response validation failed", "language-mismatch": "Response language mismatch", "download-failed": "Model preparation failed",
    "queue-full": "Queue full", unavailable: "Runner/model unavailable", denied: "Model access declined", "context-too-large": "Input limit exceeded", failed: "Model execution failed", timeout: "Execution timed out", cancelled: "Cancelled" };
  return code ? (language === "ko" ? ko : en)[code] ?? (language === "ko" ? "실패" : "Failed") : "";
}

/** A categorical hint lets users choose a concrete recovery without seeing private runner output. */
export function modelTaskDiagnosticText(code: string | undefined, language: "ko" | "en"): string {
  if (!code) return "";
  const ko: Record<string, string> = { "memory-allocation": "메모리 할당 실패 · 다른 모델 작업을 종료한 뒤 재시도", "input-window": "모델 입력 한도 초과",
    "model-load": "모델 파일 로드 실패", "runner-arguments": "실행 도구의 옵션 미지원", "response-grammar": "응답 문법 준비 실패",
    "runner-not-found": "실행 도구를 찾지 못함", "model-not-found": "모델 파일을 찾지 못함", "output-limit": "응답 크기 한도 초과", "spawn-failed": "프로세스 시작 실패" };
  const en: Record<string, string> = { "memory-allocation": "Memory allocation failed; stop other model work, then retry", "input-window": "Model input window exceeded",
    "model-load": "Model file could not load", "runner-arguments": "Runner option unsupported", "response-grammar": "Response grammar preparation failed",
    "runner-not-found": "Runner not found", "model-not-found": "Model file not found", "output-limit": "Response size limit exceeded", "spawn-failed": "Process could not start" };
  return (language === "ko" ? ko : en)[code] ?? code;
}
