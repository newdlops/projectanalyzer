# Scenario input quality

Updated for 0.0.1091, September 8, 2026.

## Reader workflow

Open a function, choose **Values & paths** in the Inspector, and select a scenario.
The detail explains why its inputs matter and how many source branch outcomes
were checked. Boundary cases appear before the retained caller/default baseline.
**Apply Inputs** changes the current input editor; selecting a row only previews it.

**Suggest AI edge cases** asks a connected VS Code language model for additional
cases. Choose the model in VS Code, review the suggested title, reason, inputs and
assumptions, then apply the case explicitly. No model is chosen automatically.
The default analysis remains local and usable without a model.

The intent is explanatory value: a threshold, a conflicting flag combination,
an early return, an exception, or a caller-specific invariant. A new arbitrary
positive number that follows already checked behavior adds no useful case.

For example, reaching `score >= 10 && tier === "pro" && enabled` requires those
inputs together, while also passing any earlier guard. The planner retains the
other interface fields, considers 9/10/11, and checks the complete tuple against
the source-owned control flow. An external policy call stops static confirmation;
an AI-proposed Unicode tag for that policy carries an explicit external assumption.

## Public modules and boundaries

| Module | Public surface and responsibility |
| --- | --- |
| `src/analyzer/functionTutor/inputEvaluation/` | `evaluateFunctionTutorInputs`, input assignment and evaluation types. Bounded pure interpretation of supported parser-owned IR. |
| `src/application/codeFlow/functionTutor/` | Existing model builder plus `evaluateScenarioSeed` / `selectScenarioSeeds`. Candidate construction and coverage-based selection remain internal. |
| `src/application/scenarioInputs/` | `createScenarioInputPrompt`, `parseScenarioInputSuggestions`, `ScenarioInputProvider`, finite `ScenarioInputError`. Context assembly and untrusted data validation. |
| `src/vscode/scenarioInputModelProvider.ts` | `createScenarioInputModelProvider`. Explicit model selection, token sizing, response streaming and cancellation at the VS Code boundary. |
| `src/protocol/scenarioInputs.ts` | Bounded request correlation and finite response states. No source text supplied by the Webview. |
| `src/webview/codeFlow/scenarioInputsBrowserSource.ts` | Explicit request controls and correlated replies. The shared Scenario Workspace owns input application and retained state. |

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
non-TS/JS functions retain their existing analysis and AI context, with an explicit
language gap for this concrete input checker.

## Neural model context and validation

Only an explicit request sends context. Opening a function, mounting controls,
focusing the workspace, changing locale and inspecting rows send no model request.

The prompt includes the selected source range (including column boundaries), up
to 9,000 characters; up to four graph-backed caller neighborhoods of up to 1,800
characters each; parameter type/default/literal/member/shape facts; available
authored documentation and framework facts; guards and existing checked inputs.
Caller neighborhoods include nearby argument construction, even when static
callsite arguments remain unknown. This is context for inference, not constant
propagation or proof that a dynamic caller supplies a particular value.

The structured context is limited to 42,000 characters and 16 parameters. The
adapter also checks the chosen model's token budget. Source, comments and
documentation are untrusted prompt data. Host paths, analyzer identities and
evidence capabilities are omitted from structured fields. Original code may
itself contain authored strings, names or comments; it is sent as code context.

Model results must be JSON data, not executable code: at most 8 cases / 48,000
characters, complete named argument tuples, optional/default omissions only,
strings up to 1,024 characters, 32 entries/items per object/array and input depth 6.
Finite numbers, known primitive types, literal unions, required object fields and
known array element shapes are checked. Unsafe property keys, malformed payloads,
unknown parameter names, duplicates and repeated checked behavior are rejected.
This is bounded shape validation, not complete TypeScript structural subtyping.

Accepted proposals are independently checked, then appended as inferred model
cases. A model explanation cannot assert coverage or manufacture source evidence.
Partially checked external cases can be retained for their stated domain rationale;
the quality of that rationale still needs reader judgment. Neither this filter nor
a neural model guarantees every edge case or that all accepted partial cases are
useful. There is no custom-trained model or runtime fuzzing engine in this release.

Model access, credentials, networking and account consent belong to the selected
provider through the [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model).
The extension does not configure a separate model endpoint or store API keys.

## Request and UI lifecycle

Requests contain only the active graph version, opaque flow identity and bounded
request ID. The Host retains at most eight delivered function contexts, accepts a
single pending request, rejects replays, times out after 120 seconds, and ignores
late responses after cancellation or context replacement. The browser independently
checks correlation before accepting new seeds.

The response can be ready, empty, unavailable, cancelled, denied, timeout,
invalid-response, failed or stale. Up to eight AI cases are retained for a function
context. Loading disables the request action and exposes cancellation. Completion
restores focus if the cancellation button disappears. Error states explain retry
or model setup; existing rows, input edits, selection, snapshot, playback state and
graph DOM remain intact. Locale changes update controls without issuing a request.

## Verification

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
