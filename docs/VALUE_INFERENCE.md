# Scenario value inference

Updated for 0.0.1092, September 8, 2026.

## Reader behavior

In **Values & paths**, enter the function inputs and select a variable. The
existing Scenario calculation panel shows the source statement and each immediate
before/after value. A loop that adds 3 twice keeps `1 → 4 → 7`; changing the input
to 2 recomputes the history as `2 → 5 → 8`. The same ordered frames feed playback.
Selecting a recommended scenario also shows its named value changes and enables
the existing Apply & Play action after that lazy scenario calculation completes.

Object changes follow shared references. If `alias = input` and a supported
callee changes `input.count` from 2 to 5, the alias row changes at that call.
Earlier rows and the editable input remain unchanged. A primitive read captured
before the call retains 2. Changes inside a return expression or condition are
recorded at the block that evaluates them.

Every row retains its source statement and input dependencies. Missing data and
unsupported behavior appear as an explicit unknown with a localized reason.
Nested `undefined`, `NaN`, `Infinity`, `-Infinity` and `-0` remain distinguishable
in the display; JSON serialization must not erase them or replace them with null.

## Modules and contracts

The public surface remains `src/webview/codeFlow/valuePreview/index.ts` and the
existing generated Scenario evaluator/trace helpers. No new protocol messages or
runtime dependencies are introduced.

| Internal module | Responsibility |
| --- | --- |
| `functionLogicScenarioProgramBrowserSource.ts` | Tagged iterative program/expression/call frames; control decisions; invocation budgets; occurrence snapshots. |
| `functionLogicScenarioProgramValuesBrowserSource.ts` | Complete static value conversion, bounded display text, own-member reads, copy-on-write reference propagation and immediate assignment transitions. |
| `functionLogicScenarioTraceBrowserSource.ts` | Exact root identity projection and occurrence-ordered Values/playback frames, retaining a legacy CFG fallback. |
| `analyzer/functionTutor/scenario/expression.ts` | Parser-owned object/array/shorthand/unary expression IR and explicit unsupported shapes. |

The expression machine tracks current binding environments and live expression
results. A write replaces containers along the affected path and rebuilds only
changed aliases. Callers, callee arguments and already evaluated object operands
therefore retain the same reference identity in current state. Historical records
own their previous maps and objects. Primitive values are copied by value.

Compound assignments capture the left value before evaluating the right side.
For example, with `input.count = 3`, if `update(input)` sets the count to 100 and
returns 2, `input.count += update(input)` ends at 5. The recorded transition is
3 → 5 and the source statement explains the operation. This follows the
[ECMAScript assignment evaluation order](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-assignment-operators-runtime-semantics-evaluation).

The root trace records direct root operations and changes observed through calls.
It does not insert every internal callee operation as a root graph node.
The source adapter also maps loop iteration edges to the true condition outcome;
otherwise a source-backed while loop could never enter its body.

## Confidence and limits

This is concrete, bounded interpretation of supported TS/JS IR under the selected
inputs. It does not execute the project, model every possible runtime, or prove
all paths reachable or unreachable. A fixed input alone does not determine I/O,
scheduling or hidden external state.

- The existing bounds remain: call depth 4, 12 bundled programs, 360 blocks,
  96 KiB payload, 600 expression items, 1,200 work items and three visits per block.
  A reached loop/work limit retains its calculated prefix and exposes truncation.
- At most 64 invocation environments participate in reference propagation.
  Data conversion uses depth 16 / 512 frames / 64 own fields or items; alias
  rewriting uses depth 16 / 1,024 frames with a visited/active cycle guard.
- Complete own-data objects and arrays are supported. Unknown children, truncated
  containers, spreads, accessors, sparse source literals, prototype-sensitive keys,
  and unresolved dynamic member reads remain unknown. Cyclic writes stop
  confirmation. A known dynamic write index retains the existing write support.
- Primitive loose equality includes JavaScript coercion and nullish behavior.
  Object-to-primitive conversion remains a gap. Supported reference comparisons
  retain identity across writes, including already evaluated operands.
- Unsupported source statements emit an unsupported IR operation instead of
  silently disappearing. Unresolved calls, unsupported effects, failed reference
  writes and incomplete callee evaluation conservatively invalidate current state
  and the final exact-result claim. Previous snapshots remain intact.
- Invalidation is deliberately broad: this release does not prove that an unknown
  call leaves a particular scalar or alias untouched. It can therefore show less
  precise results while avoiding stale-value confirmation.
- Existing async/method/constructor/generator support stays limited to Host-proven
  programs and the previously documented boundaries. Internal runtime objects are
  not exposed as ordinary JSON values. Python/Django and React's external lifecycle
  effects retain their existing framework explanations and explicit gaps.

The separate input-quality checker still uses its stricter local confirmation
rules. An AI-proposed edge case does not become proven through a model explanation;
the browser recomputes its values using this interpreter. See
[Scenario input quality](SCENARIO_INPUT_QUALITY.md) for model context and selection.

## Verification

Regression fixtures pass through the real TypeScript AST adapter, application
program bundle, opaque identity projection and emitted browser evaluator. The
tests evaluate generated extension JavaScript only; they do not execute the
fixture's project source. Assertions cover compound assignments, mutation order,
derived containers, shorthand, loose equality, unknown effects, aliases, caller
mutation, live expression identity, snapshot preservation, cyclic writes, loop
limits and special-value display.

Functional and visual QA use the production Webview HTML and real analyzer data.
The in-app Browser reported no available browser, so a fresh standalone Chromium
rendered a local preview. At 1440×900, 768×1024 and 390×844, normal editor and
variable-selection interactions verified loop order, source labels, input changes
and recomputed values. Desktop fixtures also verified alias/caller changes,
unknown-call reasons and nested special values. Screenshots were inspected after
layout and paint settled; the trace and document had no horizontal overflow or
browser errors. Reduced-motion behavior retained the text sequence.

The UI preserves the existing design language under `ui-design-workflow`; a
manual Impeccable polish and Web Interface Guidelines pass checked the changed
trace's hierarchy, wrapping, native keyboard controls, accessible row labels,
selected state and polite live region. There is no new UI control or theme token.
Full screen-reader testing and installed VS Code interaction are not claimed.

Web Interface Guidelines findings on September 8, 2026:

- `src/webview/codeFlow/valuePreview/functionLogicScenarioTraceBrowserSource.ts:19`
  — fixed the trace heading and generic rows using a semantic heading and ordered
  list; code/value text opts out of translation. Existing theme layout is retained.
- `src/webview/codeFlow/valuePreview/functionLogicScenarioTraceStyles.ts:45`
  — the semantic list resets default margin, padding and markers; the existing
  bounded scroll and wrapping remain in place.

The audit used the current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

- Full TypeScript unit suite: **675 tests, 671 passed, four existing failures**.
  The type baseline, nested object representatives, advanced private-call Scenario
  and source-reveal architecture expectations still fail. The previously failing
  logical-return continuation test passes. No baseline assertion was weakened.
- New source-to-browser and formatting regressions: **17 passed** in that suite.
- Final focused run after the named-field detail change: **45/45 passed**, covering
  the value regressions, existing Scenario evaluator and shared Workspace.
- Rust analyzer: **82 passed**. Package tooling: **12 passed**. TypeScript compile
  and release metadata checks passed.
- macOS arm64 VSIX: **424 files, 3.23 MiB archive, 13.59 MiB unpacked**, within
  the existing package budget.
