# Changelog

All notable user-visible changes to Project Analyzer: Code Flow are recorded in
this file. The changelog starts with the first distribution-documented build;
earlier local development builds were not tracked here.

## 0.0.1108 - 2026-10-05

### Improved

- Analyze every discovered structural source scenario through sequential, fixed
  batches instead of allowing the model to choose one to three examples. Preserve
  separate inferred and partial routes, early returns and finite loop choices.
- Show analysis progress and retain completed results after cancellation or errors.
  An explicit Continue action processes only the remaining paths. Read saved results
  with Previous/Next, stable global scenario numbers and matching source annotations.
- Keep model prose in private temporary pages and render one bounded page at a time.
  Paging, language changes and source navigation do not invoke the model.
- Support Qwen3.5 text-only local inference with ChatML and reasoning disabled.
  Each batch has a 90-second deadline; single-process, thread and output bounds remain.

### Known limitations

- Scenarios cover the captured control-flow graph. Loops use a finite structural
  abstraction; this does not enumerate every iteration count or prove path feasibility.
  Missing or unsupported source remains visible, and model prose remains unverified.
- GGUF models and llama.cpp are installed separately from the marketplace extension.

## 0.0.1107 - 2026-10-05

### Fixed

- Send the requested explanation language in a separate local system message and
  constrain Korean prose during JSON decoding. Source expressions retain their
  original text and the existing inference resource limits remain in place.
- Validate the response language before displaying, caching or adding source
  annotations. Wrong-language results show a localized retry message and require
  another explicit action; they cannot be labeled as a successful Korean result.

### Known limitations

- Language validation checks prose scripts and preserves source literals. It does
  not establish semantic correctness; model explanations remain unverified.

## 0.0.1106 - 2026-10-05

### Improved

- Derive eligible scenario headings from their validated source conditions so a
  model-generated title cannot name the opposite branch. Preserve the model's
  summary, paragraphs and detailed reasoning, with full conditions in evidence.
- Verify explicit Korean/English settings through Host requests, language-specific
  caches and the production Guide. Actual local 1.5B Kotlin and TypeScript requests
  returned summaries and three scenario paragraphs in each requested language.
- Keep inference prompts, grammar, resource limits and request counts unchanged.
  Language switching reuses existing results and generates only on explicit action.

### Known limitations

- Source-derived headings do not validate the meaning of model-written prose.
  Detailed guard effects and numeric calculations can still be wrong; generated
  explanations retain the unverified-inference label.

## 0.0.1105 - 2026-10-05

### Improved

- Ground explanations in up to three bounded source routes from the existing
  Kotlin/TypeScript and other language adapters, stopping at the first return.
  Preserve incomplete paths and syntax confidence without running source code.
- Share parser-backed value operations and existing complete primitive input
  checks. Normalize explicit primitive required Boolean guards so local models
  receive the matching input value instead of inverting `!flag` themselves.
- Bind eligible scenario conditions, source terminals and citations to fixed
  frames in local JSON grammar and Host validation. LLMs write the prose; they
  cannot swap these fields between routes. Reuse existing analysis without
  extra model calls, a background process or larger inference budgets.
- Distinguish omitted source excerpts from static-analysis limits so complete
  Kotlin source does not show a misleading omitted-code notice.

### Known limitations

- Prose and detailed reasoning can still be incorrect. The real 1.5B QA returned
  correct Kotlin outcome paragraphs and fixed-fee TypeScript paragraphs, but
  some detailed guard effects and `Math.max` calculations were wrong. Source
  frames are syntax evidence, not execution or feasibility proof.

## 0.0.1104 - 2026-10-05

### Improved

- Open Function Guide with a short purpose and one explicit explanation action.
  Move full summaries, reading questions and static scenarios into closed Analysis
  details; keep graph zoom, outline, Inspector and legend in closed Tools.
- Read generated scenarios as connected paragraphs, with cited steps inside
  closed Source evidence. Local output requires a bounded explanation field;
  older responses remain readable. Native source hovers also include the paragraph.
- Show Guide first on narrow screens and pause its scenario consumer when Analysis
  details closes. Preserve Guide mode, separate scroll positions and evidence
  disclosures across relayouts and locale changes, with visible focus targets
  during generation and expired-context recovery.

### Known limitations

- Small local models can produce incorrect reasoning despite valid sentence-form
  output and source references. Inference remains unverified. The four previously
  recorded TypeScript test failures remain unchanged.

## 0.0.1103 - 2026-10-05

### Added

- LLM scenario step numbers and compact explanations beside source lines, with
  native hovers for conditions, reasoning, value changes, outcomes and assumptions.
  Clear annotations from the editor toolbar or disable them in settings.

### Improved

- Request detailed operation, reason and effect fields with original source line
  numbers and worked explanation guidance. Local generation supports up to three
  scenarios and five steps, with a bounded 2,400-token output budget.
- Keep one source annotation result, validate its complete document hash and
  clear stale marks on edits, close, graph replacement or disposal. Git revision
  documents cannot invalidate the working file's marks.
- Restore the selected flow, source context, language and step from cache without
  model work. Shared source locations cannot substitute another narrative.

### Known limitations

- Explanation guidance changes prompts, not model weights. Inference remains
  unverified; small models can misread conditions despite valid JSON/citations.
  The four previously recorded TypeScript test failures remain unchanged.

## 0.0.1102 - 2026-10-05

### Added

- **LLM behavior scenarios** reads a function and bounded nearby code to describe
  its purpose, conditions, ordered work, expected result and assumptions. Kotlin
  and parameterless functions are supported; every step has a source action.
- Run a local instruction-tuned GGUF model with llama.cpp only on explicit
  generation. The process exits after completion/cancellation, and model changes
  share one queue. Connected VS Code chat models remain an optional setting.

### Improved

- Cache narratives by source context and language, including nearby helpers and
  constants. Cancel work on graph replacement/disposal; reload expired contexts
  explicitly and reselect failed connected models without automatic inference.
- Validate bounded JSON and snippet references, render prose as literal text,
  preserve reading state across language changes, and label inference separately
  from the existing checked static scenarios.
- Omit unreferenced empty type-only JavaScript output to keep the package within
  its existing file budget while retaining runtime exports and side effects.

### Known limitations

- LLM explanations can be inaccurate even when their source references validate.
  Models are installed separately and are excluded from the VSIX. The four
  previously recorded TypeScript test failures remain unchanged.

## 0.0.1101 - 2026-10-04

### Added

- Kotlin `.kt` / `.kts` function analysis with an official grammar parser loaded
  on first use. Read source conditions, calls, returns and symbolic scenarios;
  unsupported runtime arithmetic and dispatch remain explicit.
- A source-backed Function Summary joins documentation, inputs, conditions,
  effects, outcomes and codebase context. Scenario details distinguish checked
  conditions from assumed paths and preserve each loop visit and field change.
- **Generate scenarios quickly** uses caller arguments and supported internal
  calculations to find checked branch boundaries with a small local model.
  Repeated requests reuse bounded source-owned results. Optional neural search
  remains available as a separate action.

### Improved

- Function Guide and Values & paths acquire scenario calculations on interaction,
  reuse shared results, and release retained previews and playback timers when
  the active function changes.
- Pure synchronous TypeScript/JavaScript helper summaries retain defaults,
  unused argument evaluation and lexical call ownership. Reassigned or shadowed
  functions, effects, recursion and unsupported calculations remain unconfirmed.
- Fast requests check at most 192 input tuples and support cancellation; source
  indexes, cached replies and responsive Korean/English controls stay bounded.

### Known limitations

- Four existing TypeScript test failures remain: two declared-type input
  representative expectations, advanced private Scenario evaluation and a
  source-reveal architecture expectation. The full suite passes 860/864; focused
  feature tests, Rust tests and package validation pass. See
  [the verification record](docs/SCENARIO_INPUT_QUALITY.md).

## 0.0.1100 - 2026-09-11

### Improved

- Read call scenarios with purple decisions, orange loop visits, blue calls and
  green returns. Icons, labels and a connected timeline preserve meaning without
  relying on color. Throws and incomplete paths have distinct feedback.
- See each decision after its predicate calls and before the selected calls.
  Use **Edit** on a decision to focus the matching control, including repeated
  visits. False outcomes remain ordinary branches rather than errors.
- Match call relationship edges and labels to conditions, loops and separate
  dispatch. Keep uncertainty dashes and selection legible without dimming functions.
  Native theme colors, wrapping and keyboard controls work in both call views.

## 0.0.1099 - 2026-09-10

### Added

- **Call order** inside Function calls builds scenarios from a selected parent:
  inspect its interface, choose branch outcomes and loop visits, and read numbered
  project calls with original arguments and source evidence. **Call relationships**
  keeps the function-node diagram available beside it.
- Preserve nested argument evaluation order, independent decisions on each loop
  visit, early returns, break/continue and finally cleanup for TypeScript/JavaScript
  and Python. Incomplete order and separate dispatch remain explicit.
- Start from bounded route examples or an empty draft, name and copy the scenario,
  and open the parent's existing input analysis. Assumptions stay distinct from
  verified values; drafts, manually edited inputs and diagram cameras retain state
  across view changes. Narrow screens include jumps between conditions and calls.

## 0.0.1098 - 2026-09-10

### Improved

- **Function calls** now focuses on identified project functions. Builtins, unresolved
  targets and installed dependencies such as Python `site-packages` no longer clutter
  the diagram or consume its node/callsite limits. The scope also applies to expansion.
- Keep complete conditions and loops, including expressions such as `len(items) > 4`.
  Python binding checks prevent library aliases and collection methods from borrowing
  unrelated project identities while preserving locally defined functions named `len`.
- Clarify project-function counts and the empty state in Korean and English.

## 0.0.1097 - 2026-09-10

### Added

- **Function calls** is a separate diagram mode beside **Statement flow**. Each
  function has one node; connections retain distinct callsites, source conditions,
  enclosing loops and target confidence. Self-recursion and cycles are labeled.
- Expand a selected function's calls, compare repeated callsite conditions, open
  source evidence or enter its statement flow. Switching modes preserves selection,
  zoom, pan and the mounted statement workspace.
- TypeScript/JavaScript and Python calls include early-exit prerequisites and
  expression guards. Unknown targets and analysis limits remain explicit. A
  keyboard-accessible call list complements the pannable diagram.

## 0.0.1096 - 2026-09-10

### Improved

- Local neural inference now shares text features across parameters and searches
  related string arguments together, including source-derived token combinations.
- Python input domains follow comparison literals through assignments and pure
  helpers, include numeric bytecode constants and preserve declared integer inputs.
- Adaptive training learns newly reached inner conditions while keeping successful
  outer inputs fixed. Numeric normalization preserves exact integer and fractional
  equality inputs. All recommended boundary pairs are independently checked.
- TypeScript/JavaScript scenario explanations retain completed return values when
  matching a checked input path to its displayed conditions.

## 0.0.1095 - 2026-09-10

### Fixed

- The first **Use recommended values** click now runs local inference, applies a
  checked case and prepares its path, explanation and playback. Cancellation, failed analysis and
  edits made during training preserve the current inputs.
- Python input analysis now follows bounded regex parsing, same-file pure
  validation helpers, loops and value changes. Learned candidates include accepted,
  rejected, duplicate and multiline inputs, with separate checks for later visits.
- Python Values and Scenario playback share the Host's bounded interpreter.
  Unsupported external behavior remains explicitly unknown.

## 0.0.1094 - 2026-09-09

### Improved

- Local neural inference now varies string content/length and primitive array sizes
  instead of freezing empty inputs. Connected source tokens, caller alternatives,
  text features and learned discrete ranking produce checked boundary pairs.
- Retain numeric array element inference, explain empty guards with nonempty partners,
  and find later conditions after preceding guards. Recommendations show actual
  operands, escaped invisible characters and distinguishable long-text changes.
- Fill recommended values now prioritizes complete checked cases and useful nonempty
  partners. Its accessible name matches the visible button, and narrow scenario rows
  separate the title from the source label.

## 0.0.1093 - 2026-09-08

### Changed

- Replaced the connected chat-model action with an own, function-specific neural
  network trained locally on the CPU. A residual dense/tanh network learns input
  to calculated comparison values using backpropagation and Adam; learned input
  gradients guide boundary search. No account, model selection or source upload.
- Neural scenarios show checked boundary pairs, the changed input, calculated
  comparison operands, training/held-out counts and normalized prediction error.
  Suggestions preserve current edits and playback until explicitly applied.
- Numeric TS/JS inference stays bounded and cancellable. Unsupported external or
  framework state remains unknown; poor held-out approximation yields no proposal.
  Added reproducible learning, gradient, boundary and diagnostic corpus checks.

## 0.0.1092 - 2026-09-08

### Fixed

- Scenario compound assignments retain the immediate left value, evaluate the
  right side, and apply the actual operator. Input dependencies follow derived
  object/array members, shorthand fields and unary expressions.
- Supported object writes update direct/nested aliases, live expression references
  and caller arguments without rewriting earlier value snapshots. Mutations inside
  return values and conditions appear at the source block that performed them.
- Value progression preserves every bounded loop occurrence in evaluation order:
  `1 → 4 → 7` remains visible instead of collapsing into one final block value.
- Primitive loose equality preserves coercion and nullish boundaries. Value text
  preserves nested `undefined`, `NaN`, infinities and negative zero.
- Unresolved calls, unsupported effects, partial containers and cyclic writes stop
  confirmation instead of displaying stale or incomplete data as a complete value.
- Logical-return continuations now preserve the selected short-circuit result.

### Known limitations

- This is bounded TS/JS static interpretation under selected inputs, not runtime
  execution or exhaustive path proof. External/framework effects and unsupported
  language semantics remain explicit gaps. See [scope and QA](docs/VALUE_INFERENCE.md).
- Four previously documented full-suite failures remain; the logical-return
  continuation failure from the five-failure baseline is resolved.

## 0.0.1091 - 2026-09-08

### Added

- Boundary-focused scenario inputs combine interface fields and earlier guards,
  then prioritize newly checked branches, returns and exceptions. Exact thresholds
  and both sides stay eligible before the display limit is applied.
- **Suggest AI edge cases** uses a user-selected VS Code language model with the
  selected function, interface, framework facts and bounded caller context. Complete
  tuples are validated, duplicates and ordinary repeated behavior are rejected, and
  model assumptions remain separate from statically checked paths.
- Suggestion loading, cancellation, retry and unavailable states preserve edited
  inputs and the graph. Applying a suggestion is an explicit action.

### Fixed

- Compound and nested conditions map to their original CFG predicates so checking
  an inner branch cannot silently skip the outer guard.
- Scenario detail actions retain their shared session when applying inputs or
  restoring prior choices; completed AI requests restore keyboard focus.

### Known limitations

- The bounded TS/JS input checker does not establish every feasible path or run
  project code. External behavior and other languages remain partial. AI requires
  a configured VS Code model. See [scope and verification](docs/SCENARIO_INPUT_QUALITY.md).
- The five existing full-suite failures documented in 0.0.1088 remain.

## 0.0.1090 - 2026-09-07

### Fixed

- **Read the function** and overview source actions preserve the reader's zoom.
  Oversized statements reveal their start instead of shrinking the entire graph.
- Selecting a step keeps surrounding nodes, connections and labels at full opacity.
  Selected borders and stronger connections provide emphasis; explicit branch
  exclusions and body focus retain their existing behavior.
- High-contrast themes keep routed connections unfilled and show a clear outline
  around the selected block.

## 0.0.1089 - 2026-09-07

### Added

- **At a glance** connects function documentation, inputs, decisions and outcomes
  to their graph nodes. Selected steps explain their role in plain language.
- Source-backed **React behavior** explains render, state, Effect dependencies
  and cleanup, memo/ref/context and event-handler timing.
- Source-backed **Django behavior** explains request guards, transactions,
  commit callbacks, signals, lazy queries, evaluation, writes and responses.
- Framework disclosures retain their state across language changes and link
  to existing graph nodes and exact source evidence.

### Fixed

- First-load camera reveals the entry node in narrow panes. Language changes
  preserve the function title, and incomplete Tutor data keeps the overview usable.
- Django writes contribute to identified outcome sites; attached functions and
  nested callbacks do not inflate the selected function's summary.

### Known limitations

- Framework explanations describe bounded static API contracts. Actual runtime
  scheduling, URL resolution and SQL are not observed. See
  [supported behavior and verification](docs/FRAMEWORK_BEHAVIOR.md).
- The five existing full-suite failures documented in 0.0.1088 remain. All newly
  added framework/overview tests pass.

## 0.0.1088 - 2026-09-07

### Added

- A source-order **Read the function** outline with branch, call, and exit
  filters. Selecting a step synchronizes graph selection and source evidence;
  Previous/Next and keyboard navigation follow the same reading order.
- Separate **Understand code**, **Values & paths**, and **Function info** tabs
  that retain input values and individual scroll positions.
- A path-oriented Scenario Workspace with recommended inputs, explicit
  **Apply & Play** actions, and named value changes along possible source paths.
- A retry action and recovery guidance when function analysis is unavailable.

### Changed

- Function Guide input handoff opens **Values & paths**. Leaving that tab
  pauses playback and releases its pending scenario calculation.
- Source reading adapts to narrow editor panes, touch targets, long code,
  Korean/English switching, and VS Code light/dark and high-contrast themes.
- Value analysis retains object-field ownership, known dynamic field indexes,
  and Python assignment expressions. Recommended inputs use supported declared
  types and bounded source constraints while retaining unknown values.

### Fixed

- Hidden reading panels no longer appear together, condition targets wrap
  within their table, and selected outline rows remain legible on hover.
- Switching between panels of different heights restores the prior scroll
  position instead of resetting it during browser layout.

### Known limitations

- Some advanced method-call and logical-return scenarios still produce
  unresolved or incorrect static outcomes. The local full test suite has five
  outstanding failures, recorded in `docs/FUNCTION_READING_UI_QA.md`.

## 0.0.1059 - 2026-07-22

### Changed

- Selecting a Function Logic binding now renders its value path as short
  quadratic declaration-to-use-to-sink hops instead of long definition-to-use
  rays that can be confused with control-flow edges.
- The iterative hop planner stops at the nearest value-related node on each
  control-flow path. Separate branches remain separate, joins retain incoming
  hops from each branch, loops are cycle-guarded, and pruned control paths fall
  back to their analyzer-provided reaching definition.

## 0.0.1058 - 2026-07-21

### Performance

- Large native-analyzer stdout is now logged once with aggregate byte/chunk
  counts instead of producing one DEBUG line per 64 KiB callback. Stderr keeps
  an 8 KiB preview with exact omitted-byte accounting.
- The compatibility Graph Panel now receives a Host-projected payload capped by
  the configured render budget and an absolute 2,000-node guard. Projection
  metadata exposes omitted nodes/edges, and focused nodes seed a bounded local
  neighborhood.
- Repeated focus or open actions no longer resend an unchanged graph/mode
  payload when the requested node is already available in the Webview.

## 0.0.1057 - 2026-07-21

### Added

- Function Logic now expands explicit nested keys from TypeScript/JavaScript
  object literals and Python dictionaries into individual `FIELD` changes.
  Spread/unpack sources, `Object.assign`, Python `dict.update`, and Java
  map-style literal keys remain visibly inferred when runtime types or key sets
  cannot be proven.
- Scenario calculation now applies exact own-data property assignments,
  compound updates, increments, dynamic known indexes, and deletes to JSON
  inputs. Each calculation row names the changed field and shows its leaf-level
  before/after value.

### Security

- Scenario object writes use bounded copy-on-write paths, reject accessors and
  non-plain prototypes, and block `__proto__`, `prototype`, and `constructor`
  segments without executing source or getters.

## 0.0.1055 - 2026-07-21

### Changed

- Function Logic statement labels and value-change expressions now preserve
  source-authored line breaks and indentation instead of flattening code into a
  single visual line. Content-based layout accounts for every explicit line.
- Function Visualizer nodes, selected-block code, and same-canvas Module Flow
  statement cards now share lightweight VS Code theme syntax highlighting for
  supported language families. Rendering uses only inert `textContent` spans;
  analyzer source is neither interpreted as HTML nor executed.

## 0.0.1054 - 2026-07-21

### Added

- Selecting a module in **Module Flow** now filters the bounded canvas to that
  module's directed ancestors and descendants. Unrelated and sibling branches
  are removed from layout instead of remaining as visual noise.
- Clicking empty canvas space or pressing `Escape` clears module focus, lazy
  expansions, and correlated pending requests, then restores the exact initial
  module scene. The focused module remains visibly marked while inspecting one
  of its attached functions or statement blocks.

## 0.0.1053 - 2026-07-21

### Changed

- Selecting a module in **Module Flow** now keeps entry/boundary function cards
  and their attached statement graphs only for that module. Selecting another
  module releases the previous module's component branch instead of accumulating
  unrelated function graphs on the shared canvas.
- Child-module expansions remain as navigation context, while superseded
  boundary-function and Function Logic requests are invalidated so late Host
  responses cannot reattach components from the previously selected module.

## 0.0.1052 - 2026-07-21

### Added

- Selecting an attached entry/boundary function in **Module Flow** now continues
  into its statement-level control-flow graph on the same canvas. A visible
  function-to-entry edge keeps the project-to-function reading path continuous.
- Function-local cards retain branch labels, confidence, value changes/accesses,
  related-function evidence, and exact-statement source actions in the Module
  Flow detail rail.

### Changed

- Newly attached function blocks and control edges use a short bounded staggered
  animation while preserving the clicked function card's viewport position;
  reduced-motion preferences still disable animation.
- Function Logic requests are correlated and capped at 48 blocks/96 edges. The
  complete canvas remains capped at 500 nodes/1,000 edges, and a child function
  graph cannot evict the boundary-function branch that owns its anchor.
- Function-card clicks no longer replace Module Flow with a separate Function
  Visualizer tab. Opening the function definition remains an explicit detail action.

## 0.0.1051 - 2026-07-21

### Changed

- Function Visualizer title and graph metrics now share a compact header row,
  with smaller source and static-analysis context beneath them.
- A single root breadcrumb and the normal idle status no longer reserve vertical
  space. Navigation reappears for real parent/child history, while analysis,
  attachment, and error statuses remain visible.
- Empty upstream-entrypoint sections are now reliably hidden; populated origins
  use one inline `Reached from` strip instead of a separate heading block.

## 0.0.1050 - 2026-07-20

### Fixed

- **Scenario values** now occupies a visible, non-shrinking Inspector row. Large
  selected-block evidence can no longer compress the editor to a two-pixel strip.
- Scenario controls are placed at the top of the Inspector, before variable-height
  block evidence, so they are immediately visible when a Function Logic graph opens.
- Long tracked-variable lists scroll inside the Debug Variables-style table while
  the add-variable controls and the rest of the Inspector keep their usable height.

## 0.0.1048 - 2026-07-20

### Fixed

- **Scenario Variables** no longer disappears when an analyzer reports zero lexical
  bindings. Every new Function Logic graph opens an Inspector containing the same
  editable `Name` / `Scenario input` surface.
- A missing binding can now be added as a session-only `CUSTOM` variable with an
  initial value. Changing that value immediately recalculates source-backed
  assignments and keeps the selected Scenario row highlighted.
- When a later relayout reports one unambiguous analyzer binding with the same name,
  the manually entered value moves to that tracked binding instead of being lost.

### Evaluation boundaries

- User-added names are lexical identifiers limited to 80 characters and 32 rows;
  values remain limited to 240 characters. They stay inside the current Webview
  session and never execute source, send Host messages, or modify workspace files.

## 0.0.1047 - 2026-07-20

### Changed

- Nested Function Logic body frames are now projected dynamically. The initial
  graph shows only the outermost frame in each body hierarchy instead of stacking
  every nested dashed box over the same nodes and routes.
- Every body-forming owner has a `BODY` affordance. Selecting an internal owner
  promotes exactly its body to the visible outer frame; ancestor breadcrumbs,
  `Parent body`, and `Outermost` restore broader context without relayout.
- Body focus is retained across child-function attachment relayouts for the same
  root graph, and safely falls back to the outer projection when its owner leaves
  the scene.
- Distribution metadata now consistently uses the Marketplace extension identity
  `newdlops.function-analysis`; artifact names follow
  `function-analysis-<version>-<target>.vsix` across local and CI packaging.

### Reliability

- Body ancestry and focus paths use iterative parent walks with visited guards.
  Malformed parent cycles are cut deterministically so they cannot hide every
  frame or cause recursive traversal.

## 0.0.1046 - 2026-07-20

### Added

- TypeScript/JavaScript Function Logic now parses statically complete code text
  passed to direct `eval`, `Function`, string timers, and Node `vm` execution APIs.
  Explicit `js`/`ts` code tags and strongly code-shaped stored literals are also
  represented without executing their contents.
- One literal may contain multiple function declarations, arrows, methods,
  accessors, or nested functions. Each definition receives an independent
  callable body CFG, including its branches, nested ternaries, JSX, calls,
  parameters, locals, constants, value changes, consumes, and sinks.
- New `TEXT` and `FN` nodes plus `defines` and `deferred` edges distinguish an
  embedded program boundary, a callable definition, and a separately scheduled
  timer body from immediate host control flow.

### Changed

- Immediate static code text is inserted before its consuming host statement and
  resumes afterward. Stored programs and `Function` bodies are marked not invoked;
  timer strings are marked deferred with no immediate return edge.
- Scenario calculation follows immediate embedded code only. It never enters a
  stored/function-definition or timer branch merely because that source is visible.
- Embedded callsites retain their exact virtual owner even though source navigation
  maps every internal node back to the containing host literal.

### Analysis boundaries

- Embedded text is parsed as syntax only; it is never evaluated, imported, required,
  type-checked, or persisted. Ordinary strings, interpolated templates, identifiers,
  and runtime-built concatenations are not treated as executable programs.
- Discovery is bounded to 24,000 decoded characters, 64 literal-only concatenation
  pieces, 16 embedded regions, and the shared Function Logic block budget. Parser
  recovery, dynamic code consumers, and bounded omissions remain explicit gaps.

## 0.0.1045 - 2026-07-20

### Added

- **Scenario calculation** now parses session-only JSON/scalar inputs and calculates
  source-backed lexical initializers, assignments, compound assignments, increments,
  arithmetic, comparisons, complex booleans, own-data member reads, and nested
  JavaScript/Java ternaries. Calculated rows show the expression and `before → after`.
- Derived assignments retain input provenance, so selecting a parameter also reveals
  downstream local/constant calculations that depend on it.

### Changed

- Scenario values propagate over the visible control-flow graph with a bounded
  iterative worklist. Selected `true`/`false`/`case` edges are followed exactly;
  differing unselected branch values merge to an explicit `multiple reachable values`
  unknown state.
- Local and constant Scenario inputs act as definition-point overrides. The Inspector
  labels the column `Scenario input` and reports parse/calculation failures inline.

### Evaluation boundaries

- Scenario evaluation is a side-effect-free static preview, not source execution or a
  debugger. Calls, constructors, getters, inferred receiver mutations, heap writes, and
  iteration counts remain explicit unknown states. Inputs never leave the Webview,
  modify source, persist to storage, or automatically select a branch.
- Expressions are limited to 420 characters and 180 tokens; CFG propagation stops at
  1,200 work items. Cycles and unsupported syntax cannot trigger unbounded evaluation.

## 0.0.1044 - 2026-07-20

### Added

- Function Logic now distinguishes an internal value `CONSUME` from a lexical
  `SINK` at returns/throws/yields, call arguments, JSX delivery, aggregate
  storage, and external property/element assignments. Graph rows, selected
  nodes, overlays, legends, and accessible text retain that distinction.
- **Scenario progression** follows the selected preview token through bounded
  `DEFINED`, `CONSUME`, `SINK`, and `UPDATED` steps. Branch choices dim excluded
  steps, and writes turn later display into `<unknown after write>`.

### Changed

- A new function graph with lexical values opens its adjacent Inspector by
  default so Scenario values remain visible. An explicit close choice is still
  preserved while the same root graph is relaid out.
- Scenario input remains session-scoped and now refreshes the graph annotations
  and progression together, including possible reaching definitions at merges.

### Analysis boundaries

- `SINK` means direct lexical tracking ends at source syntax; it is not a
  security finding and does not claim that a callee, render, or runtime transfer
  executed. Scenario text is never parsed, evaluated, persisted, sent to the
  Extension Host, or used to select a branch.
- A source write invalidates the entered token instead of evaluating the right
  side. Heap aliases, property flows, closures, and interprocedural values remain
  unknown.

## 0.0.1043 - 2026-07-20

### Added

- Function Logic now provides **Center** and **Fit** beside its live zoom
  percentage. `C` and `F` activate the same actions while the graph viewport is
  focused.
- The graph supports background or middle-button drag, two-axis trackpad pan,
  and cursor-centered Ctrl/Command-wheel zoom.

### Changed

- Function Logic uses one `translate + scale` viewport transform instead of
  native scroll bounds, allowing the canvas to move freely past every side like
  an infinite workspace. The dotted grid follows the same pan and zoom state.
- Zoom now spans 1%–300%, preserves the viewport focal point, and keeps the
  selected callsite fixed when child-function attachment rebuilds the layout.
  Inspector/editor resizing preserves the visible world center.

### Interaction boundaries

- Free pan is numerically guarded at ±10,000,000 screen pixels to prevent
  non-finite browser transforms; this guard does not expose an ordinary visible
  canvas edge. **Fit** never enlarges a graph beyond 100%.

## 0.0.1042 - 2026-07-20

### Added

- TypeScript/JavaScript Function Logic now treats JSX elements as first-class
  static component values. JSX arrays are expanded into their individual render
  and drill targets, while direct collection-to-local-to-return transport keeps
  a visible `COMPONENT` definition-to-use flow.
- Scenario-value `Name` labels are buttons that select the same value-flow lens
  as the binding chips, highlighting the label, related graph nodes, and
  definition-to-use arrows together.

### Changed

- The graph and adjacent Inspector now use a bounded fixed-height workspace. The
  Inspector occupies its own column or narrow-screen row and scrolls internally,
  so long evidence never covers or vertically displaces the graph canvas.

### Analysis boundaries

- A first-class JSX component value represents source-backed element creation
  and its custom-component render relation; it does not claim that framework
  scheduling executes the component implementation at that JavaScript point.
  Direct JSX syntax and transparent local/indexed transport are retained, while
  dynamic mutations, call results, property aliases, and runtime reconciliation
  remain unknown.
- Clicking a scenario-value label changes only the static value-flow highlight.
  Preview text still does not execute code or select a control-flow branch.

## 0.0.1041 - 2026-07-20

### Added

- The Function Inspector now includes a Debug Variables-style `Name` / `Preview
  value` editor for parameters, locals, and constants. Entered text appears next
  to the corresponding graph and selected-block value rows and survives relayouts
  of the same root graph.

### Changed

- Function Logic UI text now scales from the VS Code UI font settings, while
  source-shaped labels and preview inputs scale from the VS Code editor font
  settings.
- Opening the Inspector now allocates a separate right-side layout column and
  shrinks the graph viewport instead of covering it. At narrow widths the drawer
  occupies a separate row below the graph.

### Analysis boundaries

- Preview values are session-only literal annotations capped at 240 characters
  and 120 visible bindings. They are not parsed or executed, do not modify source,
  do not select a control-flow branch, and are not sent to the Extension Host.

## 0.0.1040 - 2026-07-20

### Changed

- Function Visualizer now gives the graph the full editor width and a viewport
  up to 76% of the editor height. Signature, reading guide, value selector,
  direct callees, and selected-block evidence now live in a non-modal right-side
  Inspector drawer.
- Selecting a graph node opens the drawer without taking graph focus. The drawer
  supports explicit toggle/close actions, `Escape`, narrow-screen backdrop,
  accessible expanded/hidden state, and remains open across child-function relayouts.

## 0.0.1039 - 2026-07-20

### Added

- Function Logic now identifies parameters, local variables, and constants in
  TypeScript/JavaScript, Python, and Java, annotates each graph block with
  `DEFINE`, `READ`, `WRITE`, or `READ/WRITE`, and lets users select one binding
  to trace possible definition-to-use arrows across branches and loops.
- Concise JSX `.map` callback parameters participate in the inferred render-loop
  flow, while attached child functions keep their value identities isolated.

### Analysis boundaries

- Value flow is bounded lexical static analysis, not runtime value propagation.
  Ambiguous shadowed names, aliases, fields, closures, and interprocedural data
  flow are not guessed; Python uppercase constants remain visibly inferred.

## 0.0.1038 - 2026-07-20

### Added

- Function Logic `true`, `false`, and `case` edge labels and selected-block
  transfers are now keyboard-accessible path choices. Nested choices compose,
  inactive alternatives dim, and the selected scenario remains highlighted
  through shared merges and later reachable statements.

### Analysis boundaries

- A selected path is a bounded, cycle-safe projection of static source flow,
  not a captured runtime execution. Selecting the same outcome again or using
  **Reset choices** restores the corresponding alternatives.

## 0.0.1037 - 2026-07-20

### Added

- TypeScript/JavaScript Function Logic now expands ternaries nested in either
  arm of a selected root ternary, preserving each decision's `then`/`else`
  ownership, visual depth, source evidence, and final value merge. Nested JSX
  render ternaries retain the same per-level ownership.

### Analysis boundaries

- Branch expressions embedded inside larger call arguments or non-branch
  operations remain in their containing statement to avoid inventing an unsafe
  evaluation order.

## 0.0.1036 - 2026-07-20

### Added

- TypeScript/JavaScript Function Logic branches for outer ternary expressions
  and `&&`, `||`, and `??` short-circuit evaluation in conditions,
  initializers, direct `=` assignments, returns, switch values, and concise
  arrow bodies.

### Analysis boundaries

- Optional chaining and branch expressions nested inside larger call arguments
  remain in their containing statement rather than claiming an unsafe order.

### Fixed

- Module Flow now draws curved line bridges and local direction triangles where
  perpendicular edges cross, with a larger arrowhead at each edge destination.

## 0.0.1035 - 2026-07-20

### Added

- An MIT License covering the extension source and bundled Rust analyzer.
- Detached event-handler branches for named JSX handlers,
  `addEventListener`, EventEmitter-style listeners, subscriptions, and event
  property assignments. Handler flows do not return into registration flow.

### Fixed

- Added publisher-migration cleanup guidance and a manifest regression guard
  for duplicate **Visualize Current Function** command/menu contributions.

## 0.0.1034 - 2026-07-20

### Added

- A 256×256 Marketplace icon derived from the Code Flow Activity Bar mark, plus
  dark gallery-banner metadata and search keywords.
- A prominent **See how modules connect** sidebar card with a labeled Module
  Flow action, native tooltip, keyboard focus treatment, and opening status.
- F#, OCaml, and Elixir `|>` pipeline visualization with language-correct
  argument insertion, exact stage ranges, and same-canvas child-function drill.
- JSX/TSX render-flow nodes for intrinsic and custom elements, prop evaluation,
  conditional output, event bindings, and inferred concise `.map` repetition.
- A first-run installation path, supported-language summary, local-data policy,
  troubleshooting guidance, support template, and maintainer release checklist.
- Guarded GitHub Actions deployment for six native VSIX targets under the
  `newdlops` Marketplace publisher, with Entra OIDC and temporary PAT auth paths.

### Changed

- Functional pipeline languages now participate in workspace analysis, editor
  context selection, Function Logic visualization, and project graph expansion.
- Release packaging now treats the icon, README, changelog, and support document
  as required distribution artifacts.
- Release tags must match the manifest, lockfile, and changelog before packages
  can be published to Marketplace or attached to a GitHub release.

### Analysis boundaries

- Haskell composition, monadic bind, computation expressions, macros, and
  higher-order callback execution are not presented as exact pipe-forward flow.
- JSX component scheduling and event dispatch remain framework/runtime
  boundaries; concise `.map` render callbacks are explicitly inferred.
- Static graph confidence remains visible as `exact`, `resolved`, `inferred`, or
  `unresolved`; the visualizer does not claim to show an observed runtime trace.
