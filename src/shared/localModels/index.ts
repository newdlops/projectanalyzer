/** Framework-free contract for an explicitly requested, verified local model cache. */
export type LocalModelDescriptor = Readonly<{
  id: string;
  name: string;
  fileName: string;
  url: string;
  bytes: number;
  sha256: string;
}>;
export type LocalModelProgress = {
  phase: "waiting" | "downloading" | "verifying";
  completedBytes: number;
  totalBytes: number;
};
export type LocalModelFailure = "cancelled" | "download" | "integrity" | "storage" | "busy";
/** Error categories are safe to localize without exposing private paths or network diagnostics. */
export class LocalModelError extends Error {
  public constructor(public readonly code: LocalModelFailure) { super(code); this.name = "LocalModelError"; }
}
export interface ManagedLocalModelCache {
  readonly model: LocalModelDescriptor;
  /** Inert until called; returns only a size/checksum-verified complete file. */
  ensure(signal: AbortSignal, progress: (value: LocalModelProgress) => void): Promise<string>;
  /** Revokes pending transfers and filesystem work on extension disposal. */
  dispose(): void;
}
