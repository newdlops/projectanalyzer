/**
 * Shared domain types that are independent from VS Code, Webview, and parser
 * implementations. These types are the stable vocabulary used across modules.
 */

/** Zero-based source range matching VS Code position semantics. */
export type SourceRange = {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
};

/** Supported graph node categories for files, symbols, and external entities. */
export type SymbolKind =
  | "workspace"
  | "folder"
  | "file"
  | "module"
  | "namespace"
  | "class"
  | "interface"
  | "enum"
  | "function"
  | "method"
  | "constructor"
  | "property"
  | "variable"
  | "external";

/** Supported relationship categories extracted by static analysis. */
export type EdgeKind =
  | "contains"
  | "imports"
  | "exports"
  | "calls"
  | "references"
  | "extends"
  | "implements"
  | "overrides"
  | "instantiates"
  | "uses";

/** Confidence level that keeps exact static results separate from inference. */
export type EdgeConfidence = "exact" | "resolved" | "inferred" | "unresolved";

/** Stable node record stored in the project graph. */
export type SymbolNode = {
  id: string;
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  range: SourceRange;
  selectionRange: SourceRange;
  language: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
};

/** Directed edge record stored in the project graph. */
export type GraphEdge = {
  id: string;
  kind: EdgeKind;
  sourceId: string;
  targetId: string;
  filePath: string;
  range?: SourceRange;
  confidence: EdgeConfidence;
  metadata?: Record<string, unknown>;
};

/** Analysis diagnostic captured without failing the whole workspace run. */
export type AnalysisDiagnostic = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  filePath?: string;
  range?: SourceRange;
  details?: Record<string, unknown>;
};

/** File-count summary for one detected implementation language. */
export type LanguageSummary = {
  language: string;
  fileCount: number;
  percentage: number;
};

/** Static framework or tool detection captured from project manifests. */
export type DetectedFramework = {
  name: string;
  ecosystem: string;
  category: "frontend" | "backend" | "fullstack" | "test" | "build" | "desktop" | "mobile" | "unknown";
  confidence: "high" | "medium" | "low";
  rootPath?: string;
  evidence: string[];
};

/** Normalized graph payload shared by analyzer, storage, and Webview protocol. */
export type ProjectGraph = {
  workspaceRoot: string;
  version: string;
  generatedAt: string;
  nodes: SymbolNode[];
  edges: GraphEdge[];
  diagnostics: AnalysisDiagnostic[];
  metadata: {
    languages: string[];
    languageSummary?: LanguageSummary[];
    frameworks?: DetectedFramework[];
    fileCount: number;
    symbolCount: number;
    edgeCount: number;
  };
};

/** Source file snapshot passed into language analyzers. */
export type SourceFile = {
  path: string;
  languageId: string;
  content: string;
  sizeBytes: number;
  contentHash: string;
};
