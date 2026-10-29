# Declared local narrative values

This pure module gives the local grammar and response normalizer the same
declared JSON-kind contract. `createDeclaredValueSchema(language, annotation,
nonNull)` preserves direct scalar spellings and recognizes Kotlin primitive
arrays/`Array<T>` and TypeScript/JavaScript postfix arrays. Kotlin nullable
containers and nullable elements remain separate. Unresolved aliases, unions
and unsupported spellings keep their original unknown domains.

`matchesDeclaredValueSchema(value, schema)` checks complete alternatives,
source-owned constants and every declared array element with an iterative work
list. It never coerces a scalar or literal string into an array, chooses example
contents or manufactures model prose. Portable example validation retains its
existing size/depth/container/unsafe-key bounds. Source and route validators
still determine ownership and reachability; JSON kinds do not prove numeric
ranges, program execution, explanation meaning or latency.

The parser's64-layer type guard and the matcher's4096-work/64-depth guard bound
malformed type/schema input without recursion. These guards exceed the existing
portable JSON budget. A type that cannot be represented remains unknown rather
than being guessed or cutting source text.
