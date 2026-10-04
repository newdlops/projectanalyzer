/** ANTLR-only boundary: bounded lexing, explicit diagnostics, and immutable UTF-16 normalization. */
import { CharStreams, CommonTokenStream, ErrorListener, ParserRuleContext, TerminalNode, Token } from "antlr4";
import type { Recognizer } from "antlr4";
import KotlinLexer from "./generated/KotlinLexer";
import KotlinParser from "./generated/KotlinParser";
import type { KotlinSyntaxDiagnostic, KotlinSyntaxNode } from "../kotlinSyntaxTypes";

const MAX_TOKENS = 100_000;
const MAX_NESTING = 128;
const MAX_DIAGNOSTICS = 100;

/** Budget failures stop tokenization before recursive parser rules execute. */
class KotlinBudgetError extends Error {
  public constructor(public readonly code: "token-limit" | "nesting-limit", public readonly offset: number) {
    super(code === "token-limit" ? "Kotlin token limit (100,000) exceeded." : "Kotlin token nesting limit (128) exceeded.");
  }
}

/** Checks actual lexer tokens, so comments and quoted braces do not consume nesting depth. */
class BoundedKotlinLexer extends KotlinLexer {
  private tokenCount = 0;
  private nesting = 0;

  /** Reads at most the token budget and stops before unsafe parser nesting. */
  public override nextToken(): Token {
    const token = super.nextToken();
    if (token.type === Token.EOF) return token;
    this.tokenCount += 1;
    if (this.tokenCount > MAX_TOKENS) throw new KotlinBudgetError("token-limit", token.start);
    if ([KotlinLexer.LPAREN, KotlinLexer.LSQUARE, KotlinLexer.LCURL,
      KotlinLexer.LineStrExprStart, KotlinLexer.MultiLineStrExprStart].includes(token.type)) {
      this.nesting += 1;
      if (this.nesting > MAX_NESTING) throw new KotlinBudgetError("nesting-limit", token.start);
    } else if ([KotlinLexer.RPAREN, KotlinLexer.RSQUARE, KotlinLexer.RCURL].includes(token.type)) {
      this.nesting = Math.max(0, this.nesting - 1);
    }
    return token;
  }
}

/** Captures ANTLR lexer/parser diagnostics and suppresses console error side effects. */
class KotlinErrorListener<TSymbol extends Token | number> extends ErrorListener<TSymbol> {
  public constructor(
    private readonly diagnostics: KotlinSyntaxDiagnostic[],
    private readonly offsets: readonly number[],
    private readonly textLength: number
  ) { super(); }

  /** Translates offending code-point offsets into editor UTF-16 evidence. */
  public override syntaxError(recognizer: Recognizer<TSymbol>, offending: TSymbol, _line: number,
    _column: number, message: string): void {
    if (this.diagnostics.length >= MAX_DIAGNOSTICS) return;
    const offset = typeof offending === "object" && offending ? offending.start
      : recognizer instanceof KotlinLexer ? recognizer._tokenStartCharIndex : 0;
    const from = toUtf16(this.offsets, offset, this.textLength);
    const end = typeof offending === "object" && offending ? offending.stop + 1 : offset + 1;
    this.diagnostics.push(Object.freeze({ code: "syntax-error", severity: "error", message,
      from, to: Math.max(from, toUtf16(this.offsets, end, this.textLength)) }));
  }
}

/** Runs the pinned generated grammar and discards every ANTLR context after normalization. */
export function parseKotlinSyntax(text: string, script: boolean): {
  root: KotlinSyntaxNode; diagnostics: readonly KotlinSyntaxDiagnostic[];
} {
  const diagnostics: KotlinSyntaxDiagnostic[] = [];
  const offsets = codePointOffsets(text);
  const emptyRoot = Object.freeze({ name: script ? "script" : "kotlinFile", from: 0,
    to: text.length, children: Object.freeze([]) });
  try {
    const lexer = new BoundedKotlinLexer(CharStreams.fromString(text));
    lexer.removeErrorListeners();
    lexer.addErrorListener(new KotlinErrorListener<number>(diagnostics, offsets, text.length));
    const tokens = new CommonTokenStream(lexer);
    // Complete bounded lexing first; a nesting/token violation must never enter
    // the generated parser's internal recursive grammar calls.
    tokens.fill();
    guardGenericTokenNesting(tokens.tokens);
    const parser = new KotlinParser(tokens);
    parser.removeErrorListeners();
    parser.addErrorListener(new KotlinErrorListener<Token>(diagnostics, offsets, text.length));
    const tree = script ? parser.script() : parser.kotlinFile();
    return { root: normalizeTree(tree, offsets, text.length), diagnostics: Object.freeze(diagnostics) };
  } catch (error) {
    const budget = error instanceof KotlinBudgetError;
    const from = budget ? toUtf16(offsets, error.offset, text.length) : 0;
    diagnostics.push(Object.freeze({ code: budget ? error.code : "parser-failure", severity: "error",
      message: error instanceof Error ? error.message : "Kotlin parser failed.", from,
      to: budget ? Math.min(text.length, from + 1) : text.length }));
    return { root: emptyRoot, diagnostics: Object.freeze(diagnostics) };
  }
}

/** Bounds matched generic-looking angle pairs before ANTLR performs expensive type lookahead. */
function guardGenericTokenNesting(tokens: readonly Token[]): void {
  const angles: Token[] = [];
  // Each real delimiter group remembers the angle depth outside that group.
  // Unmatched comparison '<' tokens are discarded at expression boundaries,
  // rather than accumulating across independent if conditions/statements.
  const groupBases = [0];
  const opens = new Set([KotlinLexer.LPAREN, KotlinLexer.LSQUARE, KotlinLexer.LCURL,
    KotlinLexer.LineStrExprStart, KotlinLexer.MultiLineStrExprStart]);
  const closes = new Set([KotlinLexer.RPAREN, KotlinLexer.RSQUARE, KotlinLexer.RCURL]);
  const boundaries = new Set([KotlinLexer.CONJ, KotlinLexer.DISJ, KotlinLexer.SEMICOLON,
    KotlinLexer.ASSIGNMENT, KotlinLexer.VAL, KotlinLexer.VAR, KotlinLexer.FUN, KotlinLexer.CLASS,
    KotlinLexer.INTERFACE, KotlinLexer.OBJECT, KotlinLexer.RETURN, KotlinLexer.IF,
    KotlinLexer.WHEN, KotlinLexer.FOR, KotlinLexer.WHILE, KotlinLexer.DO, KotlinLexer.TRY]);
  for (const token of tokens) {
    if (opens.has(token.type)) groupBases.push(angles.length);
    else if (closes.has(token.type)) {
      angles.length = Math.min(angles.length, groupBases.length > 1 ? groupBases.pop()! : 0);
    } else if (token.type === KotlinLexer.LANGLE) angles.push(token);
    else if (token.type === KotlinLexer.RANGLE && angles.length > (groupBases.at(-1) ?? 0)) {
      if (angles.length + groupBases.length - 1 > MAX_NESTING) {
        throw new KotlinBudgetError("nesting-limit", token.start);
      }
      angles.pop();
    } else if (boundaries.has(token.type)) {
      angles.length = groupBases.at(-1) ?? 0;
    }
  }
}

/** Normalizes the grammar tree in iterative postorder, retaining terminals for operator evidence. */
function normalizeTree(root: ParserRuleContext, offsets: readonly number[], textLength: number): KotlinSyntaxNode {
  type Entry = { original: ParserRuleContext | TerminalNode; expanded: boolean };
  const pending: Entry[] = [{ original: root, expanded: false }];
  const normalized = new Map<ParserRuleContext | TerminalNode, KotlinSyntaxNode>();
  const visited = new Set<ParserRuleContext | TerminalNode>();
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) continue;
    const original = entry.original;
    if (!entry.expanded) {
      if (visited.has(original)) continue;
      visited.add(original);
      pending.push({ original, expanded: true });
      if (original instanceof ParserRuleContext) {
        const children = original.children ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          const child = children[index];
          if (child instanceof ParserRuleContext || child instanceof TerminalNode) {
            pending.push({ original: child, expanded: false });
          }
        }
      }
      continue;
    }
    const terminal = original instanceof TerminalNode;
    const token = terminal ? original.symbol : original.start;
    const last = terminal ? original.symbol : original.stop ?? original.start;
    const from = original === root ? 0 : toUtf16(offsets, token?.start ?? 0, textLength);
    const to = original === root ? textLength
      : Math.max(from, toUtf16(offsets, (last?.stop ?? (token?.start ?? 0) - 1) + 1, textLength));
    const children = !terminal ? (original.children ?? []).flatMap((child) => {
      const node = normalized.get(child as ParserRuleContext | TerminalNode);
      return node ? [node] : [];
    }) : [];
    normalized.set(original, Object.freeze({
      name: terminal ? token.type === Token.EOF ? "EOF" : KotlinParser.symbolicNames[token.type] ?? "error"
        : KotlinParser.ruleNames[(original as ParserRuleContext & { readonly ruleIndex: number }).ruleIndex],
      from, to, children: Object.freeze(children)
    }));
  }
  return normalized.get(root)!;
}

/** ANTLR CharStreams use Unicode code points; editor offsets count UTF-16 code units. */
function codePointOffsets(text: string): readonly number[] {
  const offsets = [0];
  let offset = 0;
  for (const character of text) {
    offset += character.length;
    offsets.push(offset);
  }
  return offsets;
}

/** Maps recovered/missing token positions into a valid original-source offset. */
function toUtf16(offsets: readonly number[], rawOffset: number, textLength: number): number {
  if (rawOffset < 0) return 0;
  return offsets[Math.min(rawOffset, offsets.length - 1)] ?? textLength;
}
