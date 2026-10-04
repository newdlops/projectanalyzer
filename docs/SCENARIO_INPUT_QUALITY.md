# Scenario input quality

Updated for 0.0.1101, October 4, 2026. Optional neural implementation and QA:
[Local neural scenario inference](NEURAL_SCENARIOS.md).

## Reader workflow

Open a function, choose **Values & paths** in the Inspector, and select a scenario.
The detail explains why its inputs matter and how many source branch outcomes
were checked. Boundary cases appear before the retained caller/default baseline.
**Apply Inputs** changes the current input editor; selecting a row only previews it.

**Generate scenarios quickly** uses a small local linear model. It starts from
complete caller tuples, keeps unrelated fields, fits calculated condition changes,
and checks each proposed boundary with the source interpreter. Creation and row
inspection do not train a network. Repeated requests reuse a source-owned cache.

**Search with neural network** optionally trains a function-specific network locally on
the CPU. Review the checked pair, changed input, calculated condition values and
held-out error, then apply the case explicitly. There is no external model or account.

The intent is explanatory value: a threshold, a conflicting flag combination,
an early return, an exception, or a caller-specific invariant. A new arbitrary
positive number that follows already checked behavior adds no useful case.

For example, reaching `score >= 10 && tier === "pro" && enabled` requires those
inputs together, while also passing any earlier guard. The planner retains the
other interface fields, considers 9/10/11, and checks the complete tuple against
the source-owned control flow. An external policy call stops static confirmation;
the neural teacher does not manufacture a return value for that policy.

## Public modules and boundaries

| Module | Public surface and responsibility |
| --- | --- |
| `src/analyzer/functionTutor/inputEvaluation/` | `compileFunctionTutorInputDeclaration`, `evaluateFunctionTutorInputs`, input assignment and evaluation types. Bounded pure helper summaries and interpretation of supported parser-owned IR. |
| `src/analyzer/fastScenarios/` | `inferFastScenarios` and problem/result/report types. Bounded local relation fitting, checked witnesses and snapshot-owned caching. |
| `src/application/codeFlow/functionTutor/` | Existing model builder plus `evaluateScenarioSeed` / `selectScenarioSeeds`. Candidate construction and coverage-based selection remain internal. |
| `src/application/scenarioInputs/` | `createLocalScenarioProvider` (fast default), `createLocalNeuralScenarioProvider`, `createNeuralScenarioProblem`, `parseScenarioInputSuggestions`, `ScenarioInputProvider`, finite `ScenarioInputError`. Typed problem adaptation and independently validated proposals. |
| `src/analyzer/neuralScenarios/` | `inferNeuralScenarios` and problem/result/report types. Own dense network, backpropagation/Adam, typed codec and gradient search; internal weights stay request-local. |
| `src/protocol/scenarioInputs.ts` | Bounded request correlation and finite response states. No source text supplied by the Webview. |
| `src/webview/codeFlow/scenarioInputsBrowserSource.ts` | Explicit request controls and correlated replies. The shared Scenario Workspace owns input application and retained state. |

Pure synchronous internal helpers are summarized from exact source-owned call
locations. Their assignments, defaults and bounded branches feed calculated
condition values. Unsupported effects, captured bindings, alias/member writes,
recursion and exception dispatch remain partial. Unused arguments and local
calculations still must be supported; an unused effect cannot silently disappear.
Cross-file helpers require an `exact` graph call edge. The public source program
retains its call boundary, while the Host input checker owns compiled summaries.
Summaries require stable lexical bindings: reassigned functions, property writes
and shadowed call names do not resolve to an earlier declaration. Each helper has
at most 64 blocks, 128 traversal states and 16 return paths; the actual call chain
is limited to four helpers regardless of catalog order.

Fast inference checks at most 192 tuples, 32 condition observations and four
opposing-outcome pairs. It yields every 32 evaluations and supports cancellation.
No fitted estimate counts as coverage until the source predicate is reached.
Nonlinear, joint categorical and unsupported calculations may need optional
neural search or stay unconfirmed. Kotlin retains symbolic source scenarios;
neither input inference mode claims JVM numeric semantics.

Cache keys include complete caller/planner tuples, domains and the evaluation
budget. Each immutable source declaration owns at most four entries; keys and
results are each limited to 96 KiB. Replies use defensive copies, and a cache hit
reports zero new evaluations. The program checker reuses snapshot-owned indexes.
Run `npm run benchmark:scenarios` to measure source preparation, cold inference,
cache reuse and one optional neural comparison on the diagnostic fixture corpus.
These timings do not measure VS Code renderer CPU or workspace-wide performance.

The source-to-CFG adapter maps compound predicates using original AST expression
ranges and condition metadata. Display labels are not reparsed as executable code.
This also prevents an inner condition from replacing its overlapping outer guard.

## Static selection and evidence

- Candidate domains contain at most 64 values per parameter. A pool of at most
  384 complete tuples is considered before choosing at most 12 static cases.
- Numeric comparisons consider the literal and ±1; length comparisons also
  consider empty and singleton values, within an 8-item recommendation limit.
  These are bounded examples, not floating-point adjacency or exhaustive domains.
- Directed search keeps previously satisfied guards while repairing the first
  mismatch. Its target route is only an intention. Only independently reached
  outcomes contribute to displayed branch coverage.
- The search uses an iterative visited-set traversal, at most 64 route edges / 256
  queue entries, 12 refinements, and bounded compound variants. It does not enumerate
  all loop iterations or solve every satisfiable path.
- Selection prioritizes new branch outcomes, distinct return/throw sites, and
  reached source boundaries. One original caller tuple and a readable baseline
  remain available for comparison. Values from different calls are never merged
  and presented as one observed call.
- The checker records a supported concrete prefix, terminal information, and a
  `verified` or `partial` status. Its defaults are 128 steps and 8 visits per block;
  caller options are clamped to 256 steps / 32 visits. Expression evaluation has
  explicit frames, a cycle guard, 512-frame budget and depth limit 32.
- Unsupported expressions, source gaps, calls/effects, shared-object writes,
  unresolved control and exception/finally dispatch stop confirmation. Missing
  data and truncated containers never become invented values.

Coverage counts distinct supported true/false outcomes, not source lines, tests
executed, runtime frequency or all feasible paths. Remaining outcomes are
unconfirmed; this does not prove they are unreachable. Python/Django and other
non-TS/JS functions retain their existing analysis and framework context, with an explicit
language gap for this concrete input checker.

## Neural model context and validation

Only an explicit request starts local training. Opening a function, mounting
controls, focusing the workspace, changing locale and inspecting rows are inert.
Typed interface facts, complete caller/planner tuples and parser-owned IR form
the local training problem. Observations record reached numeric comparison values
after previous assignments. Unreached comparisons have no label. The default
320 training and 80 held-out examples are separate before normalization or fitting.
Learned gradients estimate inputs; bounded static refinement confirms a boundary.
See [network architecture, numeric domain and limitations](NEURAL_SCENARIOS.md).

Model results must be JSON data, not executable code: at most 8 cases / 48,000
characters, complete named argument tuples, optional/default omissions only,
strings up to 1,024 characters, 32 entries/items per object/array and input depth 6.
Finite numbers, known primitive types, literal unions, required object fields and
known array element shapes are checked. Unsafe property keys, malformed payloads,
unknown parameter names, duplicates and repeated checked behavior are rejected.
This is bounded shape validation, not complete TypeScript structural subtyping.

Accepted proposals are independently checked, then appended as inferred model
cases. A model explanation cannot assert coverage or manufacture source evidence.
The local provider only proposes pairs with different checked outcomes at a
reached comparison. The Host checks both tuples again; a fabricated witness cannot
bypass novelty filtering. A previously added neural boundary is not repeated.
Later external effects remain partial. Neither the network nor the static teacher
guarantees all edge cases. Weights and samples remain in memory for one request.

## Request and UI lifecycle

Requests contain only the active graph version, opaque flow identity, bounded
request ID and optional `fast` / `neural` mode. Missing mode selects fast inference.
The Host retains at most eight delivered function contexts, accepts a single pending
request, rejects replays, times out after 5 seconds for fast inference or 120 seconds
for neural search, and ignores
late responses after cancellation or context replacement. The browser independently
checks correlation before accepting new seeds.

The response can be ready, empty, unavailable, cancelled, denied, timeout,
invalid-response, failed or stale. Up to eight generated cases are retained for a function
context. Loading disables both request actions and exposes cancellation. Completion
restores focus if the cancellation button disappears. Error states explain retry
or unsupported input/condition context; existing rows, input edits, selection, snapshot, playback state and
graph DOM remain intact. Locale changes update controls without issuing a request.

## Fast-model verification — October 4, 2026

The diagnostic benchmark uses six small source fixtures and ten fresh declarations
per fixture. Source preparation is measured separately from inference. Across all
60 snapshots, cold inference had a **0.470 ms median / 7.286 ms p95**; cache reuse
had a **0.009 ms median** for supported fixtures. These are local Node measurements,
not an installed VS Code CPU or memory profile, and include one unsupported fixture.

| Fixture | Source preparation median | Cold median | Cold p95 | Cache median | Evaluations | Checked pairs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Calculated equality | 2.126 ms | 0.527 ms | 2.331 ms | 0.009 ms | 19 | 1 |
| Internal pure helper | 1.190 ms | 0.165 ms | 0.222 ms | 0.006 ms | 7 | 1 |
| Nested guard | 0.789 ms | 0.361 ms | 0.825 ms | 0.010 ms | 21 | 2 |
| Object fields | 0.885 ms | 7.256 ms | 8.345 ms | 0.011 ms | 155 | 1 |
| Text length | 0.712 ms | 1.958 ms | 2.359 ms | 0.006 ms | 64 | 1 |
| Unsupported external call | 0.578 ms | 0.050 ms | 0.061 ms | Unavailable | Unavailable | 0 |

All five supported fixtures reached their distinguishing return. The single neural
comparison on the calculated equality took 294.496 ms / 476 evaluations and reached
the same return. This comparison describes this fixture; it does not establish a
general speed ratio or equivalent search coverage.

- Focused fast inference, pure helper, request delivery and input quality tests:
  **32/32 passed**. The full TypeScript run with four concurrent workers passed
  **860/864**, with the same four failures reproduced on clean HEAD: two declared
  type representative expectations, advanced private Scenario evaluation, and the
  source-reveal architecture expectation. An initial unrestricted run also had one
  Rust CLI integration failure; it passed in isolation and in the bounded full run.
- Rust analyzer tests: **82 passed**. Package tooling tests: **12 passed**.
  TypeScript compile, typecheck and whitespace checks passed.
- macOS arm64 VSIX validation: **508 files, 3.54 MiB archive, 15.20 MiB unpacked**.
  Extracted-runtime smoke checks passed **3/3** using only packaged dependencies:
  Kotlin lazy parsing/disposal, the emitted scenario model, and fast provider helper
  boundaries, cache reuse and cancellation.
- Native Safari rendered the production HTML at **1440×900, 768×1024 and 390×844**.
  Fast generation appended real provider-generated inputs 23 and 22 for a calculated
  helper boundary while retaining the edited input 1234. Optional neural pending
  and cancellation, Korean localization, long return text, responsive controls and
  Kotlin symbolic-only paths were inspected. No page errors or document overflow
  were reported. Locale and size changes retained the scenario catalog cache.

The preview used a local Host message bridge: fast replies came from the production
provider; neural training inside Safari and an installed VS Code interaction were
not exercised. The benchmark exercised optional neural inference in Node. Browser
inspection and unit checks are separate evidence.

## Historical verification — 0.0.1091

The following records the earlier external-model implementation. Current local
training and browser verification are in [NEURAL_SCENARIOS.md](NEURAL_SCENARIOS.md).

Production source adapters, application projection and generated Webview were used
for browser QA. The connected in-app Browser reported no available browser, so a
fresh standalone Chromium instance rendered the local preview. Model replies were
validated fixtures at the Host boundary; actual connected-model inference and
VS Code account consent were **not** exercised. The real VS Code adapter was unit
tested with only its external API boundary replaced.

- Full TypeScript unit suite: **658 tests, 653 passed, 5 existing failures**. The
  five failures match the previously documented baseline: two type representative
  expectations, advanced private-call Scenario evaluation, logical-return
  continuation evaluation, and the source-reveal architecture expectation. See
  [the prior QA record](FUNCTION_READING_UI_QA.md).
- New input-quality, delivery/browser-state and model-adapter tests cover compound
  and deep guards, contradictions, assignments, late exceptions, boundary values,
  caller context bounds, omitted defaults, unsupported control, malformed/model
  shapes, ordinary duplicate behavior, correlation, cancellation and adapter errors.
  The final focused run, including the existing input recommendation regression,
  passed **24/24**, after the source-column bounds and UI fixes.
- Rust analyzer: **82 passed**. Package tooling: **12 passed**. TypeScript compile,
  release metadata, whitespace and Rust formatting checks passed.
- macOS arm64 VSIX packaging passed: **422 files, 3.22 MiB archive, 13.57 MiB
  unpacked**, within the existing package budget.
- Actual Chromium interactions at **1440×900, 768×1024 and 390×844**: no implicit
  request; keyboard request; loading; appended case; retained edited input and graph
  node; selected explanation; explicit apply; locale change; six empty/error states;
  cancellation and ignored late response. No page errors or document overflow.
- Light theme, forced colors and reduced motion; **320×844** long title/reason and
  unbroken assumption text; eight-case disabled limit; request/row keyboard focus;
  selected-row hover. Rendered screenshots were inspected separately from tests.
- Existing reading regression: ordinary 11-block and dense 94-block graphs at all
  three representative sizes retain node/edge/label opacity and user zoom at 100%
  and 125%. Explicit branch exclusion and reset still work.
- Impeccable's manual detector returned no findings for the changed scenario UI.
  The subsequent visual pass fixed selected-row hover/secondary-text contrast,
  long-title wrapping and completion focus. Detector output alone was not used
  as visual verification.

Web Interface Guidelines audit of the changed scenario UI (September 8, 2026):

- `src/webview/codeFlow/scenarioInputsBrowserSource.ts:47` — fixed focus restoration
  when the pending cancel control disappears; finite live status and native actions.
- `src/webview/codeFlow/scenarioWorkspace/functionLogicScenarioWorkspaceBrowserSource.ts:157`
  — fixed focus retention across selected-row replacement and hierarchical headings.
- `src/webview/codeFlow/scenarioWorkspace/functionLogicScenarioWorkspaceStyles.ts:15`
  — fixed selected hover/secondary-text contrast and long heading overflow; theme
  tokens, visible focus and 44px coarse-pointer actions retained.

The audit used the current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).
No full-screen-reader or installed VS Code model-provider interaction is claimed.
