/** Immutable Kotlin syntax facts are the public boundary; ANTLR contexts stay internal. */
export type KotlinSyntaxNode = {
  readonly name: string;
  /** Half-open UTF-16 offsets into the original editor source. */
  readonly from: number;
  readonly to: number;
  readonly children: readonly KotlinSyntaxNode[];
};

/** One source-backed parse issue or explicit resource guard. */
export type KotlinSyntaxDiagnostic = {
  readonly code: "syntax-error" | "parser-failure" | "token-limit" | "nesting-limit";
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly from: number;
  readonly to: number;
};

/** Shared content snapshot used by graph, cursor, Function Logic, and Tutor adapters. */
export type KotlinSource = {
  readonly text: string;
  readonly root: KotlinSyntaxNode;
  readonly lineStarts: readonly number[];
  readonly diagnostics: readonly KotlinSyntaxDiagnostic[];
  readonly fingerprint: string;
  readonly grammarRevision: string;
};

/** Explicit function input facts retain original type/default expressions. */
export type KotlinParameterSyntax = {
  readonly name: string;
  readonly typeText?: string;
  readonly defaultText?: string;
  readonly vararg?: boolean;
  readonly node: KotlinSyntaxNode;
};

/** Executable named Kotlin function; nested lambda bodies remain deferred syntax. */
export type KotlinCallableSyntax = {
  readonly node: KotlinSyntaxNode;
  readonly body: KotlinSyntaxNode;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: "function" | "method";
  readonly selectionFrom: number;
  readonly selectionTo: number;
  readonly expressionBody: boolean;
  readonly parameterCount: number;
  readonly parameters: readonly KotlinParameterSyntax[];
  readonly receiverType?: string;
  /** Explicit annotation only; expression-body result types are never inferred here. */
  readonly returnTypeText?: string;
  readonly suspend: boolean;
  readonly lexicalTypeOwner: string;
};

/** Named declarations additionally include abstract/bodyless interface functions. */
export type KotlinFunctionDeclarationSyntax = Omit<KotlinCallableSyntax, "body"> & {
  readonly body?: KotlinSyntaxNode;
  /** Half-open declaration visibility range; distinct blocks can share a graph parent. */
  readonly lexicalScope?: { readonly from: number; readonly to: number };
};

/** A syntactic invocation, without assumptions about overloads or runtime dispatch. */
export type KotlinCallSyntax = {
  readonly node: KotlinSyntaxNode;
  readonly calleeName: string;
  readonly calleeText: string;
  readonly argumentCount: number;
};

/** Lexical class/interface/object ownership retained without parser parent pointers. */
export type KotlinOwnerSyntax = {
  readonly node: KotlinSyntaxNode;
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: "class" | "interface" | "enum";
  readonly selectionFrom: number;
  readonly selectionTo: number;
};
