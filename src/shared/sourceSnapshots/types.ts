/** Source ownership and text-free identity shared by parser and graph adapters. */
import type { SourceFile } from "../types";

/** Content identity for an analyzed file, without retaining its source text. */
export type AnalyzedSourceBinding = {
  readonly filePath: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
};

/** One immutable acquisition, hashing each source once for both consumers. */
export type AnalyzedSourceSnapshot = {
  readonly files: readonly SourceFile[];
  readonly bindings: readonly AnalyzedSourceBinding[];
};
