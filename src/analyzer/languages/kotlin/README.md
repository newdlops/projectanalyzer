# Kotlin syntax and graph adapter

The public module is `index.ts`. Consumers use immutable `KotlinSource` / `KotlinSyntaxNode` facts and never import ANTLR contexts or generated parser files. Syntax ranges are half-open UTF-16 offsets into the unmodified editor source. Rule names retain the official grammar's lowerCamelCase names, and terminal nodes retain lexer names such as `IF`, `RETURN`, and `Identifier`.

`parseKotlinSource(text, filePath?)` chooses `kotlinFile` for `.kt` and `script` for `.kts`. It shares snapshots across graph, cursor, Function Logic, and Tutor consumers. `collectKotlinCallables` returns executable named functions; `collectKotlinFunctionDeclarations` additionally includes bodyless interface/abstract functions for graph symbols. Lambdas and anonymous functions remain explicit syntax execution boundaries. `collectKotlinCalls` prunes those boundaries and class/object bodies, preserving each invocation's own source span. `getKotlinBodyStatements` returns direct `statement` nodes from function/block/control bodies.

The parser and `antlr4` runtime load on the first Kotlin parse, using a lazy CommonJS require. Neither generator tools nor a JVM are used at extension startup or runtime. Bounded lexing completes before parsing: at most 100,000 tokens including hidden trivia, and bracket/interpolation token nesting at most 128. A token-based pre-parser guard additionally bounds matched generic-looking angle nesting, including real delimiter depth; expression boundaries discard unmatched comparison angles. Error recovery, parser failures, and resource limits are explicit diagnostics. An aborted resource-guard parse returns an empty file/script root rather than guessed declarations.

The shared LRU retains at most eight snapshots and two MiB of UTF-8 source text. The budget describes retained source text, not a guarantee about AST or total process heap. A new content hash replaces the old snapshot for the same normalized path. Repeated selection refreshes recency. `setKotlinSyntaxCachePreferredPath(path?)` gives the selected editor/root priority over background workspace files without raising either budget. `invalidateKotlinSyntaxCache(path?)` supports changed/deleted paths and workspace replacement; `disposeKotlinSyntaxCache()` releases retained snapshots at shutdown. Declaration indexing uses weak snapshot keys, and the analyzer's workspace index retains only graph nodes and primitive signature/import facts.

`KotlinAnalyzer` implements the existing `LanguageAnalyzer` interface for `.kt` and `.kts`. Symbols include class/interface/object owners and named top-level/member/local/extension functions. Call edges connect a unique compatible lexical candidate, same-file top-level declaration, explicit import (including aliases), or same-package top-level declaration. Overloads with multiple compatible signatures, unknown receivers, extension dispatch, shadowed callable values, and deferred bodies stay unresolved. Edges have `resolved` confidence for a static lexical target; they do not assert exact runtime dispatch or execution.

Local function visibility uses its declaring block's UTF-16 bounds, so completed or sibling blocks do not export a callable name. Nested functions inherit captured value-binding and extension-receiver uncertainty from enclosing functions. Value-binding names conservatively apply to the whole callable body; this can leave an otherwise valid target unresolved outside that binding's narrower block.

## Parser provenance and regeneration

- Upstream: [Kotlin/kotlin-spec](https://github.com/Kotlin/kotlin-spec/tree/0f762a2314a9304e4b3fc386b1aceef1d56c7e4c/grammar/src/main/antlr), revision `0f762a2314a9304e4b3fc386b1aceef1d56c7e4c`.
- Vendored original grammar and license: `internal/grammar/`. The upstream files are preserved byte-for-byte and verified by SHA-256.
- Generator and npm runtime: ANTLR **4.13.2**, both pinned. Generator JAR checksum and grammar hashes are recorded in `internal/grammar/manifest.json`.
- Generated files: `internal/generated/KotlinLexer.ts`, `KotlinParser.ts`. They carry `@ts-nocheck` because generated ANTLR code conflicts with the repository's no-unused/override flags. All hand-written adapters compile with the repository's strict options.
- Runtime third-party licenses are reproduced in the packaged root `THIRD_PARTY_NOTICES.md`.

Download the manifest's exact generator JAR, then run:

```sh
ANTLR_JAR=/path/to/antlr-4.13.2-complete.jar JAVA=/path/to/java npm run generate:kotlin-parser
```

The script verifies the JAR and original grammar hashes, copies the grammar into a temporary directory, generates TypeScript with `-no-listener`, and writes the two checked-in generated source files. Ordinary compile, installation, packaging, and extension execution do not download or regenerate grammar.

Two adaptations are applied only to the temporary copy and recorded in the manifest:

1. Translate the grammar's explicitly target-dependent RCURL Java mode-stack action into TypeScript `this._modeStack.length` / `this.popMode()`.
2. Restore the upstream UnicodeData First/Last bounds already present as singleton alternatives: CJK `3400..4DB5`, CJK `4E00..9FCC`, and Hangul `AC00..D7A3`. The original omission rejects ordinary Korean identifiers. This correction does not update the grammar's Unicode version or claim support for all newer Kotlin syntax.

Fixtures cover declarations, parser errors, `.kts`, callable pruning, overload ambiguity, UTF-16 Korean/emoji/CRLF ranges, escaped names/comments, lazy loading, and token/nesting/cache budgets. Unsupported syntax remains a diagnostic; the grammar is not a Kotlin compiler or type checker.
