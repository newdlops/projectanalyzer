/** Public source acquisition contracts; no editor, filesystem or analyzer dependency. */
export { SourceCaptureError, requireSourceActive } from "./errors";
export type { SourceCaptureErrorCode } from "./errors";
export type {
  SourceDocumentSnapshot, NarrativeSourceReader, NarrativeSourceGraph, SourceCaptureLimits,
  CapturedSourceDeclaration, SourceCaptureGap, NarrativeSourceCapture, NarrativeSourceLease,
  NarrativeSourceAccess, NarrativeSourceEvidence, NarrativeSourceValidation, NarrativeSourceGraphValidation
} from "./types";
