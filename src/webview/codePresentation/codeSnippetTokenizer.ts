/**
 * Safe, language-neutral code tokenization for graph-card source snippets.
 * The tokenizer preserves every input character and the browser mount helper
 * creates only textContent-backed spans, so analyzer text is never executable.
 */

/** Closed token vocabulary shared by pure tests and theme-aware Webview CSS. */
export type CodeSnippetTokenKind =
  | "plain"
  | "keyword"
  | "literal"
  | "string"
  | "number"
  | "comment"
  | "operator"
  | "type"
  | "function";

/** One exact, contiguous slice of source-like graph text. */
export type CodeSnippetToken = Readonly<{
  kind: CodeSnippetTokenKind;
  text: string;
}>;

// This deliberately broad vocabulary covers the extension's TypeScript-like,
// Python, Java, F#, OCaml, and Elixir analyzers without guessing one language.
const CODE_SNIPPET_KEYWORD_VALUES = [
  "abstract", "and", "as", "assert", "async", "await", "base", "begin",
  "break", "case", "catch", "class", "const", "continue", "def", "default",
  "delegate", "delete", "do", "done", "elif", "else", "end", "enum",
  "except", "export", "extends", "extern", "false", "final", "finally", "fn",
  "for", "foreach", "from", "fun", "function", "global", "if", "implements",
  "import", "in", "inline", "instanceof", "interface", "internal", "is", "lambda",
  "let", "match", "module", "mutable", "namespace", "native", "new", "nonlocal",
  "not", "of", "open", "operator", "or", "override", "package", "pass", "private",
  "protected", "public", "raise", "readonly", "record", "require", "rescue", "return",
  "sealed", "static", "struct", "super", "switch", "synchronized", "then", "this",
  "throw", "throws", "trait", "try", "type", "typeof", "union", "unless", "unsafe",
  "use", "using", "val", "var", "virtual", "when", "where", "while", "with", "yield"
] as const;

const CODE_SNIPPET_LITERAL_VALUES = [
  "False", "None", "Nothing", "Null", "True", "false", "nil", "null", "true",
  "undefined", "Unit"
] as const;

const CODE_SNIPPET_KEYWORDS = new Set<string>(CODE_SNIPPET_KEYWORD_VALUES);
const CODE_SNIPPET_LITERALS = new Set<string>(CODE_SNIPPET_LITERAL_VALUES);
const CODE_SNIPPET_OPERATOR_CHARACTERS = "{}[](),.;:?~!%^&*+-=/<>|@\\";

/**
 * Splits source-like text iteratively while preserving an exact concatenation.
 * The scanner intentionally does not parse or execute the language grammar.
 */
export function tokenizeCodeSnippet(value: string): CodeSnippetToken[] {
  const tokens: CodeSnippetToken[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const character = value[cursor] ?? "";
    const next = value[cursor + 1] ?? "";
    if (/\s/u.test(character)) {
      const end = readCodeSnippetWhile(value, cursor + 1, (candidate) => /\s/u.test(candidate));
      pushCodeSnippetToken(tokens, "plain", value.slice(cursor, end));
      cursor = end;
      continue;
    }
    if (character === "/" && next === "/") {
      const end = readCodeSnippetLineEnd(value, cursor + 2);
      pushCodeSnippetToken(tokens, "comment", value.slice(cursor, end));
      cursor = end;
      continue;
    }
    if ((character === "/" && next === "*")
      || (character === "(" && next === "*")) {
      const closing = character === "/" ? "*/" : "*)";
      const end = readCodeSnippetBlockEnd(value, cursor + 2, closing);
      pushCodeSnippetToken(tokens, "comment", value.slice(cursor, end));
      cursor = end;
      continue;
    }
    if (character === "#" && startsCodeSnippetHashComment(value, cursor)) {
      const end = readCodeSnippetLineEnd(value, cursor + 1);
      pushCodeSnippetToken(tokens, "comment", value.slice(cursor, end));
      cursor = end;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      const end = readCodeSnippetStringEnd(value, cursor, character);
      pushCodeSnippetToken(tokens, "string", value.slice(cursor, end));
      cursor = end;
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const end = readCodeSnippetNumberEnd(value, cursor);
      pushCodeSnippetToken(tokens, "number", value.slice(cursor, end));
      cursor = end;
      continue;
    }
    if (isCodeSnippetIdentifierStart(character)) {
      const end = readCodeSnippetWhile(value, cursor + 1, isCodeSnippetIdentifierPart);
      const identifier = value.slice(cursor, end);
      pushCodeSnippetToken(
        tokens,
        classifyCodeSnippetIdentifier(value, identifier, end),
        identifier
      );
      cursor = end;
      continue;
    }
    if (CODE_SNIPPET_OPERATOR_CHARACTERS.includes(character) || character === "→") {
      const end = readCodeSnippetWhile(value, cursor + 1, (candidate) =>
        CODE_SNIPPET_OPERATOR_CHARACTERS.includes(candidate) || candidate === "→"
      );
      pushCodeSnippetToken(tokens, "operator", value.slice(cursor, end));
      cursor = end;
      continue;
    }
    pushCodeSnippetToken(tokens, "plain", character);
    cursor += 1;
  }
  return tokens;
}

/** Appends one token and coalesces adjacent equal kinds to bound DOM nodes. */
function pushCodeSnippetToken(
  tokens: CodeSnippetToken[],
  kind: CodeSnippetTokenKind,
  text: string
): void {
  if (!text) return;
  const previous = tokens.at(-1);
  if (previous?.kind === kind) {
    tokens[tokens.length - 1] = { kind, text: previous.text + text };
    return;
  }
  tokens.push({ kind, text });
}

/** Advances while a character predicate accepts the next UTF-16 position. */
function readCodeSnippetWhile(
  value: string,
  from: number,
  accepts: (character: string) => boolean
): number {
  let cursor = from;
  while (cursor < value.length && accepts(value[cursor] ?? "")) cursor += 1;
  return cursor;
}

/** Keeps the newline outside a line comment so whitespace remains exact. */
function readCodeSnippetLineEnd(value: string, from: number): number {
  let cursor = from;
  while (cursor < value.length && value[cursor] !== "\n" && value[cursor] !== "\r") {
    cursor += 1;
  }
  return cursor;
}

/** Finds a non-nested block terminator or retains an unterminated remainder. */
function readCodeSnippetBlockEnd(value: string, from: number, closing: string): number {
  const closingIndex = value.indexOf(closing, from);
  return closingIndex < 0 ? value.length : closingIndex + closing.length;
}

/** Reads escaped single, double, backtick, and Python triple-quoted strings. */
function readCodeSnippetStringEnd(value: string, from: number, quote: string): number {
  const tripleQuoted = quote !== "`" && value.slice(from, from + 3) === quote.repeat(3);
  const delimiter = tripleQuoted ? quote.repeat(3) : quote;
  let cursor = from + delimiter.length;
  let escaped = false;
  while (cursor < value.length) {
    if (!escaped && value.startsWith(delimiter, cursor)) {
      return cursor + delimiter.length;
    }
    const character = value[cursor] ?? "";
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    cursor += 1;
  }
  return value.length;
}

/** Reads common decimal, exponent, radix, bigint, and underscore forms. */
function readCodeSnippetNumberEnd(value: string, from: number): number {
  let cursor = from + 1;
  while (cursor < value.length) {
    const character = value[cursor] ?? "";
    const previous = value[cursor - 1] ?? "";
    if (/[0-9A-Fa-f_xXoObBn.]/u.test(character)
      || ((character === "+" || character === "-") && /[eE]/u.test(previous))) {
      cursor += 1;
      continue;
    }
    break;
  }
  return cursor;
}

/** Recognizes Unicode identifiers used by all supported analyzer families. */
function isCodeSnippetIdentifierStart(character: string): boolean {
  return /^[$_\p{L}]$/u.test(character);
}

/** Extends identifiers with Unicode numbers and combining marks. */
function isCodeSnippetIdentifierPart(character: string): boolean {
  return /^[$_\p{L}\p{N}\p{M}]$/u.test(character);
}

/** Classifies a stable identifier from keywords and nearby call syntax. */
function classifyCodeSnippetIdentifier(
  source: string,
  identifier: string,
  end: number
): CodeSnippetTokenKind {
  if (CODE_SNIPPET_LITERALS.has(identifier)) return "literal";
  if (CODE_SNIPPET_KEYWORDS.has(identifier)) return "keyword";
  if (/^\p{Lu}/u.test(identifier)) return "type";
  let cursor = end;
  while (cursor < source.length && /[ \t]/u.test(source[cursor] ?? "")) cursor += 1;
  return source[cursor] === "(" ? "function" : "plain";
}

/** Distinguishes Python/Elixir comments from JSX fragments and JS private access. */
function startsCodeSnippetHashComment(value: string, index: number): boolean {
  const next = value[index + 1] ?? "";
  if (next === "{" || next === "[") return false;
  let cursor = index - 1;
  while (cursor >= 0 && (value[cursor] === " " || value[cursor] === "\t")) cursor -= 1;
  if (cursor < 0 || value[cursor] === "\n" || value[cursor] === "\r") return true;
  return /\s/u.test(value[index - 1] ?? "") && (next === "" || /\s/u.test(next));
}

/** Mounts tokens under one disconnected wrapper using textContent only. */
function mountCodeSnippet(element: HTMLElement, value: unknown): void {
  const content = document.createElement("span");
  content.className = "code-snippet-content";
  for (const token of tokenizeCodeSnippet(value == null ? "" : String(value))) {
    const span = document.createElement("span");
    span.className = "code-snippet-token code-snippet-" + token.kind;
    span.textContent = token.text;
    content.append(span);
  }
  element.classList.add("code-snippet");
  element.replaceChildren(content);
}

/** Returns declarations suitable for a nonce-protected inline Webview script. */
export function getCodeSnippetBrowserSource(): string {
  return [
    `const CODE_SNIPPET_KEYWORDS = new Set(${JSON.stringify(CODE_SNIPPET_KEYWORD_VALUES)});`,
    `const CODE_SNIPPET_LITERALS = new Set(${JSON.stringify(CODE_SNIPPET_LITERAL_VALUES)});`,
    `const CODE_SNIPPET_OPERATOR_CHARACTERS = ${JSON.stringify(CODE_SNIPPET_OPERATOR_CHARACTERS)};`,
    pushCodeSnippetToken,
    readCodeSnippetWhile,
    readCodeSnippetLineEnd,
    readCodeSnippetBlockEnd,
    readCodeSnippetStringEnd,
    readCodeSnippetNumberEnd,
    isCodeSnippetIdentifierStart,
    isCodeSnippetIdentifierPart,
    classifyCodeSnippetIdentifier,
    startsCodeSnippetHashComment,
    tokenizeCodeSnippet,
    mountCodeSnippet
  ].map((value) => typeof value === "string" ? value : value.toString()).join("\n");
}
