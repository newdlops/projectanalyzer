/** Public factory and pinned manifest; internal transfer/lease code is not a cross-module API. */
export { createManagedLocalModelCache } from "./modelCache";
export const DEFAULT_FUNCTION_NARRATIVE_MODEL = Object.freeze({
  id: "qwen3.5-4b-q4_k_m-00fe7986ff5f",
  name: "Qwen3.5-4B Q4_K_M",
  fileName: "Qwen3.5-4B-Q4_K_M.gguf",
  url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf?download=true",
  bytes: 2740937888,
  sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4"
});
