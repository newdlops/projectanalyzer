# Changelog

All notable user-visible changes to Project Analyzer: Code Flow are recorded in
this file. The changelog starts with the first distribution-documented build;
earlier local development builds were not tracked here.

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
