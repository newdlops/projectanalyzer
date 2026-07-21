# Project Analyzer: Code Flow

Project Analyzer is a VS Code Code Flow Reader for understanding unfamiliar
codebases quickly.

It starts from one concrete entrypoint or function, follows only the bounded code
paths relevant to that question, and keeps every visual step connected to source
evidence. Static analysis and the project graph remain internal evidence engines;
the product does not begin with a dashboard, curriculum, file inventory, or a
raw, unbounded whole-repository graph. A bounded Module Flow is available when
the question is how project responsibilities connect.

## Install

Project Analyzer currently ships as a platform-specific VSIX because its local
analyzer includes a native executable. Use a package that matches the operating
system and CPU architecture running the VS Code Extension Host.

1. Open the **Extensions** view in VS Code.
2. Choose **Views and More Actions...** -> **Install from VSIX...**.
3. Select the matching `function-analysis-<version>-<target>.vsix` file.
4. Reload the window when VS Code asks.

Command-line installation is also supported:

```sh
code --install-extension function-analysis-<version>-<target>.vsix
```

Builds before the current Marketplace identity used `local.project-analyzer` or
`newdlops.project-analyzer`. If either legacy build is still installed, uninstall
it before installing the current VSIX; otherwise multiple manifests contribute
the same editor context-menu command:

```sh
code --uninstall-extension local.project-analyzer
code --uninstall-extension newdlops.project-analyzer
```

The extension requires VS Code 1.92 or newer and runs in the desktop Extension
Host; it is not currently a browser/Web extension.

## First Flow in 60 Seconds

1. Open the codebase folder and let the initial local analysis finish.
2. Place the cursor inside a supported function and right-click
   **Visualize Current Function**.
3. Read from the entry block through decisions, effects, mutations, and exits.
4. Click a call, custom JSX render, or named event-binding block to attach the
   related function on the same canvas; click it again to collapse that branch.
5. Use the visible **See how modules connect** card and **Open Module Flow**
   button when the question moves from one function to project responsibility
   boundaries.

Supported source-first function visualization currently covers:

| Language family | Function Logic coverage |
| --- | --- |
| TypeScript / JavaScript / JSX / TSX | Statements, branches, loops, effects, JSX render choices, listener registrations, detached event handlers, static embedded-code programs, receiver chains, and component drill targets |
| Python | Statements, `with`, comprehensions, generator arguments, receiver chains, mutations, and exits |
| Java | Methods, constructors, branches, loops, switches, structured regions, mutations, and exits |
| F# / OCaml | Named functions and `|>` stages with final-argument insertion |
| Elixir | Named functions and `|>` stages with first-argument insertion |

## The Reading Frame

Every flow reinforces the same reusable way to read code:

```text
Boundary -> Responsibility -> Decision -> Effect -> Verify
```

- **Boundary** — What starts this behavior?
- **Responsibility** — Where does ownership move next?
- **Decision** — Where can the result or path change?
- **Effect** — What state or external system may be read or changed?
- **Verify** — Which definition, callsite, and confidence evidence supports the
  connection?

The UI preserves uncertainty. `exact`, `resolved`, `inferred`, and `unresolved`
relationships remain distinct, and a static call path is never presented as an
observed runtime sequence.

## Start a Flow

After local workspace analysis, the sidebar offers two starting points:

1. **Entrypoints** — search HTTP routes and GraphQL operations, then open a
   bounded downstream flow.
2. **Functions** — search concrete callables by name, qualified name, or source
   path, then inspect the statements, decisions, loops, effects, mutations, and
   exits inside the selected function.

TypeScript, JavaScript, Python, Java, F#, OCaml, and Elixir have a source-first
shortcut: place the cursor inside a supported callable (a named pipe-forward
function for F#/OCaml/Elixir), then choose
**Visualize Current Function** from the editor context menu. The command activates
the extension, analyzes the current document snapshot including unsaved edits,
and opens that callable in a dedicated **Function Visualizer** editor tab.
Nested callables use the innermost function containing the cursor, so the
Activity Bar does not need to be open first.

Entrypoint flows show a compact inter-function ribbon with:

- Boundary, Path, Decision, Effect, and Unknown stages
- source-backed callable definitions
- confidence and concrete/external/unresolved resolution
- nested call branches
- known upstream entrypoints for a selected function
- explicit ambiguity, depth, and step-limit gaps

Every concrete function step has an **Inspect logic** action. It opens the same
dedicated Function Visualizer tab with a bounded control-flow graph:

- a graph-first, bounded-height workspace that uses the available editor width
  and up to 76% of the editor height
- a compact root header where the function title and graph metrics share one row;
  idle status and single-root navigation consume no height, while active analysis,
  errors, real breadcrumb history, and non-empty upstream origins remain visible
- an infinite-style `translate + scale` canvas with background/middle-button
  drag and two-axis trackpad pan beyond every side of the graph
- `−` / live percentage / `+` zoom from 1% to 300%, cursor-centered
  Ctrl/Cmd-wheel zoom, and explicit **Center** and whole-graph **Fit** actions
- viewport-focused `+`/`-`/`0`/`C`/`F` shortcuts plus resize-stable world-center
  and child-attachment callsite preservation
- a right-side **Inspector** drawer that consumes its own layout column instead
  of covering the graph, and moves to a separate row below it at narrow widths
- the current signature, Start/Choose/Do/Finish guide, selected-block evidence,
  value tools, and callees inside the fixed-height, independently scrollable Inspector
- statement nodes arranged in top-to-bottom execution ranks
- content-sized node boxes that preserve complete source labels, values, and
  child-function names by wrapping instead of adding ellipses
- source-authored line breaks plus lightweight VS Code theme syntax colors for
  keywords, literals, strings, numbers, comments, operators, types, and calls;
  snippets remain inert `textContent` and are never parsed as HTML or executed
- subtle depth tints that distinguish nested blocks without replacing semantic kind colors
- inline `VAR`, `FIELD`, and `RECEIVER` rows showing which value changes at each block
- inline `PARAM`, `LOCAL`, and `CONST` rows showing lexical definitions, writes,
  and whether a read is internally `CONSUME`d or reaches a lexical `SINK`
- a per-binding value selector that overlays possible definition-to-use arrows,
  including branch-merge and loop-carried definitions without hiding control edges;
  dotted consume paths and double/striped sink cues remain distinguishable without color
- an always-present Debug Variables-style `Name` / `Scenario input` table for
  entering session-only JSON/scalar parameter values or local/constant definition
  overrides; it stays at the top of the Inspector, and a long variable list scrolls
  inside the table instead of collapsing it; if analysis misses a binding, add a
  `CUSTOM` variable by name and value
- a bounded **Scenario calculation** directly below that table, showing selected and
  transitively derived values through `DEFINED`, `CALCULATED`, `UPDATED`, `CONSUME`,
  and `SINK` steps, including `before → after` results
- clickable scenario-value names that select the shared value-flow lens and
  highlight the matching label, definition/use graph nodes, and arrows
- automatic Inspector opening for every new function graph, including graphs with
  no analyzer-reported bindings, while an explicit close choice remains preserved
  through relayouts of that root graph
- Function Logic UI text linked to the VS Code UI font settings and source/value
  text linked to the configured VS Code editor font settings
- exact assignment/update/delete evidence and visibly dashed inferred receiver mutations
- loop-binding changes such as `item ← each items` on the loop decision itself
- eager Python list/set/dictionary comprehensions expanded into nested iterable,
  filter, item-emission, repeat, and final assignment blocks
- Python generator comprehensions passed directly as call arguments expanded as
  deferred, inferred loops leading into the receiving call
- Python receiver-call chains split into inner-to-outer execution steps such as
  `source()` -> `filter()` -> `map()` while preserving the complete call evidence;
  every stage keeps its own drill target so an available child-function flow can
  be appended to the same graph
- F#, OCaml, and Elixir `|>` pipelines split into a complete input followed by
  source-ordered stages; F#/OCaml retain final-argument insertion while Elixir
  retains first-argument insertion, and named local stages remain drillable
- sibling lanes for `true`/`false`, loop-body/exit, and switch branches
- dynamic compound body frames that initially show only each outermost `if`, loop,
  switch, try, or context-manager body; selecting a nested `BODY` owner promotes
  its body to the sole outer frame, with parent/breadcrumb/outermost navigation,
  while the following continuation remains outside the calculated rectangle
- labeled edges for `true`, `false`, `iterate`, `repeat`, `return`, and `throw`
- keyboard-accessible `true`, `false`, and `case` choices that dim the alternatives
  and keep the selected branch's shared merge and later continuation highlighted
- outer channels for loop-back and long exit edges so they do not cross nodes
- post-loop statements placed below the complete loop-back ring, never beside its body
- rank-gap routing that prevents every unrelated edge segment from crossing a box
- solid exact edges and dashed inferred, exception, and back edges
- exact syntax evidence for conditions, mutations, calls, and exits
- conservative, visibly `inferred` effect candidates
- node selection that opens the adjacent Inspector drawer with complete detail and
  outgoing targets while reducing, never covering, the graph viewport
- keyboard-accessible Inspector toggle/close controls, `Escape` dismissal, and drawer state
  preserved while attached functions relayout the graph
- direct concrete callees matched to their source call blocks
- parser-backed callsite recovery for calls nested in conditions, loops, and
  switch/match expressions
- visibly inferred unique-name fallback when a lightweight graph misses a multiline body
- click-to-attach child function blocks to the original graph canvas
- named JSX handlers plus `addEventListener`, EventEmitter-style, subscription,
  and `onmessage = handler` registrations shown as event boundaries
- callsite-anchored viewport restoration and reduced-motion-aware child entry animation
- `callsite → child flow → resume → caller branch` attachment on one compound canvas
- `event binding → handler flow` attachment as a separate dashed dispatch branch,
  with the registration's normal continuation preserved and no handler-to-caller return edge
- distinct call/return styling plus per-edge node ports and rank-gap tracks that prevent overlapping routes
- parent-aware child lanes and branch collapse for nested functions
- lazy one-function-at-a-time analysis instead of eager recursive loading
- breadcrumb and parent navigation through already-read function details
- visible cycle guards that reuse an attached ancestor or an existing breadcrumb
- pan and zoom presentation updates that do not rerun graph analysis or layout
- one-click navigation to the exact statement rather than only the declaration
- known HTTP/GraphQL entrypoints that reach the selected function

Opening source is verification, not a claim that the code has been understood.

## Open Module Flow

Choose the **See how modules connect** card in the Code Flow sidebar, or run
**Open Project Module Flow** from the Command Palette or sidebar title. The
in-view action includes a descriptive tooltip, keyboard focus state, and visible
opening progress. The extension resolves the current workspace graph and opens a
dedicated **Module Flow** editor tab. This view shows possible static
responsibility relationships, not an observed runtime trace.

The initial scene is bounded to 80 modules and 160 edges and reports exact
omitted counts. It provides:

- **Execution**, **Dependency**, and **All boundaries** relationship lenses
- content-sized module boxes with complete wrapped labels and details
- SCC cycle groups and top-to-bottom component layout
- orthogonal, obstacle-safe edge routes that do not cross unrelated boxes
- curved line bridges plus local direction triangles where perpendicular edges cross
- click-to-attach boundary functions to the same canvas while preserving the
  clicked module's scroll anchor
- only the currently clicked module keeps its attached entry/boundary functions
  and statement graphs; selecting another module releases the previous component
  branch while retaining child-module cards as navigation context
- selecting a module lays out only its directed ancestors and descendants from
  the current bounded graph; unrelated nodes and sibling branches are hidden
- click empty canvas space or press `Escape` to clear focus, discard lazy
  branches, and restore the initial 80-module/160-edge scene
- click an attached entry/boundary function to continue from that card into its
  bounded statement-level control-flow graph on the same Module Flow canvas;
  click it again to collapse only that function branch
- attached statement cards use the same source-line preservation and safe,
  theme-aware syntax highlighting as the dedicated Function Visualizer
- a complete-canvas budget of 500 nodes and 1,000 edges; attaching beyond it
  releases the oldest expansion branches instead of retaining unbounded DOM/layout state
- short staggered entry animation for only newly attached function blocks and
  edges, with animation disabled when reduced motion is preferred
- focal zoom with `−`/percentage/`+`, whole-graph **Fit**, `+`/`-`/`0`/`F`
  graph shortcuts, and Ctrl/Cmd-wheel zoom around the cursor
- background drag panning, centered small graphs, and resize-stable reading position
- frame-coalesced viewport updates plus keyed card/edge reuse, so zoom, selection,
  loading, and panning do not rerun SCC layout or remount the graph
- hidden editor tabs release their Webview DOM and restore from the existing Host
  projection when revealed, without rerunning workspace analysis
- bounded module/edge detail, representative evidence, and source actions
- exact function-definition and statement source actions remain in the adjacent
  detail rail without replacing the Module Flow graph

The complete module index stays in the Extension Host. The browser receives only
the current bounded scene, a selected detail, or one lazy expansion layer. Saved
workspace files are read directly instead of being retained as VS Code text
documents, and the Rust source manifest is streamed with backpressure rather than
duplicating the complete workspace input in one buffer.

## Product Scope

The product combines interprocedural feature flow with intraprocedural function
logic:

```text
HTTP/GraphQL/selected function
  -> Handler
  -> Application or domain candidate
  -> Repository or model
  -> External or state boundary

Selected TypeScript/JavaScript/Python/Java/F#/OCaml/Elixir function
  -> Condition or loop
  -> Branch-local operation/call/mutation/effect
  -> Return, throw, repeat, or fallthrough exit

Workspace Module Flow
  -> Project responsibility boundary
  -> Static execution/dependency relation
  -> Boundary function
  -> Same-canvas statement control flow
```

Runtime value evaluation, heap/alias taint propagation, runtime instrumentation,
collaboration, and a raw unbounded whole-project graph remain outside the
flow-first experience. The bounded lexical def-use view and Module Flow are part
of the current product. The repository's `SPEC.MD` contains the product contract,
semantics, UX states, and milestones.

## Current Analysis Coverage

Workspace analysis recognizes HTTP route-to-handler entrypoints for Django,
FastAPI, Express, and NestJS, plus code-first GraphQL root operations for NestJS
GraphQL and Strawberry. The semantic-flow traversal follows only analyzed
`calls` edges and uses explicit depth, step, cycle, and duplicate guards.

Module Flow derives non-overlapping responsibility boundaries from workspace
manifests, nested packages, framework roots, and conservative source-area
fallbacks. It aggregates cross-module calls, imports, exports, and framework
relations while preserving external boundaries, confidence buckets, evidence,
and exact omission counts. These are possible static relationships; even the
Execution lens does not claim observed order, frequency, or timing.

The Rust engine remains a lightweight syntax analyzer rather than a compiler
frontend. Cross-function JavaScript and TypeScript extraction uses textual and
line-oriented heuristics without a lexical scope graph, receiver resolution, or
type checking. Python project symbols continue to use the Rust scanner when it
is available and have a Lezer-backed in-process fallback. Because the Rust path
currently produces only file nodes for Java and the pipe-forward functional
languages, the Extension Host supplements Java symbols plus F#/OCaml/Elixir
named functions and conservative pipeline-call evidence from the current workspace.

After a function is selected, TypeScript and JavaScript use the TypeScript
compiler AST, Python and Java use Lezer syntax trees, and F#/OCaml/Elixir use a
bounded pipe-forward syntax adapter. All adapters produce the same block,
transfer, callsite, source-range, and coverage-gap contract. The imperative-language
adapters also emit source-complete, de-duplicated value-change evidence for
variable/property writes and conservative in-place receiver calls. Python models
`if`/`elif`/`else`, loops including loop `else`,
eager list/set/dictionary comprehensions with nested `for` and `if` clauses,
deferred generator-argument loops, receiver-call chains in evaluation order, `match`/`case`,
`try`/`except`/`finally`, `with`, mutations, calls, and exits. Java models
branches, all common loop forms, `switch`,
`try`/`catch`/`finally`, try-with-resources, synchronized/labeled regions,
mutations, calls, constructors, and exits. Editor-context selection can add an
exact snapshot-local callable node when the project analyzer did not model a
supported lambda or other cursor-selected callable.

TypeScript/JavaScript, Python, and Java also project unambiguous lexical bindings
onto that control-flow graph. Function parameters begin at `Enter`, local and
constant declarations begin at their source block, and later reads/writes retain
the binding identity. A read used by a calculation, condition, or call receiver is
`CONSUME`; an explicit return/throw/yield, call argument, JSX delivery, aggregate
field, or external property/element assignment is a lexical `SINK`. `SINK` means
direct tracking stops at that source boundary—not that the destination is unsafe
or that runtime execution was observed. Selecting one `PARAM`, `LOCAL`, or `CONST`
chip draws only that binding's possible definition-to-use arrows so the control
graph stays readable. Reassignments kill earlier definitions on the same path;
branch merges may therefore show more than one reaching definition, and loops may
show a loop-carried relation. The projection uses bounded iterative CFG walks and
follows the currently selected `true`/`false`/`case` scenario by dimming value
arrows whose endpoints are outside that choice.

The Scenario value editor is always available at the top of the Inspector. Its rows
retain their intrinsic height, and the variable list uses a bounded inner scroll so
selected-block evidence cannot collapse or push the editor out of view.
Analyzer-backed parameters, locals, and constants appear automatically; when a
binding is missing, the user can add a `CUSTOM` variable name and initial value
without modifying source.
If a later relayout reports one unambiguous binding with the same name, that session
value is promoted to the analyzer-backed row. The editor parses entered JSON or
scalar literals in the Webview and feeds a bounded, side-effect-free evaluator. It
calculates source-backed lexical initializers, assignments, compound assignments,
increments/decrements, arithmetic,
comparisons, complex boolean expressions, own-data member reads, and JavaScript/Java
`?:` expressions including nested ternaries. The selected binding's calculation also
shows downstream assignments whose provenance includes that binding.

Scenario states propagate over the visible CFG with an iterative worklist. A selected
`true`/`false`/`case` choice removes its dimmed nodes and edges from the calculation;
without a choice, differing values at a reachable merge become `<unknown: multiple
reachable values>` instead of choosing a path. Calls, constructors, getters, inferred
receiver mutations, dynamic heap writes, and iteration counts are never executed.
Stored code programs, generated `Function` bodies, and timer strings are also excluded
from immediate Scenario propagation; a direct static `eval`/`vm` program participates
only because its consuming source statement is an immediate code boundary.
Unsupported operations remain explicit `<unknown: …>` states. Inputs stay in the
browser session, are not sent to the Extension Host, do not modify source, and do not
automatically change a branch choice.

`const` declarations and Java `final` locals are exact constants. A single-write
uppercase Python local is shown as an inferred constant because that is a naming
convention, not a language guarantee. Concise JSX `.map(item => <Item />)` callback
parameters are tied to the inferred render-loop block; event callback bodies remain
separate event-handler flows. Ambiguous shadowed names are omitted instead of being
joined by spelling alone. This is lexical static flow only: it does not evaluate
runtime values or infer aliases, object fields, closures, or interprocedural data flow.

F#/OCaml/Elixir model `|>` as exact sequential evaluation, preserving complete
input and stage text plus each language's argument-insertion direction. Named
local stages can attach their Function Logic on the same canvas. Function
composition, computation expressions/macros, Haskell composition, and monadic
bind are not relabeled as pipe chains; higher-order callback execution remains a
visible runtime limitation.

JSX and TSX returns expand into a source-ordered render flow alongside normal
statement control flow. JSX initializers, direct assignments, consumed values,
and returns place the same render flow immediately before their lexical consumer.
An array such as `[<Badge />, <ReadyState />, <EmptyState />]` is represented as a
first-class component-value collection: every element keeps its own render/drill
target, and direct indexed/local transport to a later return retains a `COMPONENT`
definition-to-use flow. Intrinsic elements, custom components, prop/child call
expressions, ternary and logical render choices, and event bindings receive
separate graph nodes. Nested JSX ternaries retain an independent condition and
branch region at every level. Uppercase or member-style tags such as `<Badge />` and
`<UI.Panel />` expose exact render relations that can attach the component's
Function Logic without pretending JSX is an immediate JavaScript call. Concise
`.map(item => <Item />)` output is shown as an inferred repeated render path.
Inline event callback bodies remain outside the render path and independently
selectable. Stable references such as `onClick={handleClick}` expose an `event`
drill target; attaching it creates a no-return dispatch branch instead of
placing the handler body in the render continuation. `memo`/`forwardRef`
components retain their binding names.

The component-value role is source-backed static evidence, not a claim that React
or another framework invokes the component implementation when the array or local
is evaluated. Dynamic collection mutation, component values returned by calls,
property aliases, and reconciliation/scheduling remain runtime boundaries.

TypeScript and JavaScript listener calls such as
`target.addEventListener("click", handleClick)`, `emitter.on("data", handleData)`,
`stream.subscribe(handleValue)`, and event-property assignments such as
`socket.onmessage = handleMessage` receive the same event-boundary treatment.
Generic `on`/`once`/`subscribe` and event-property spellings remain visibly
`inferred` because static syntax alone does not prove the receiver's runtime type.

Python `with` and `async with` keep only the context-manager header in their
structural node. Each indented body statement remains a separate flow node and
continues to the first statement after context exit.

TypeScript and JavaScript expand root ternary expressions plus `&&`, `||`, and
`??` into source-backed Function Logic branches. Ternaries nested in either the
`then` or `else` arm retain their own condition, branch labels, visual depth,
and merge paths. Control conditions preserve truthy/falsy short-circuit order,
while initializers, direct `=` assignments, returns, switch values, and concise
arrow bodies merge the selected value back into their containing operation.
Optional chaining and branch expressions embedded inside a larger call argument
remain inside that containing statement so the graph does not claim an unsafe
evaluation order.

Static TypeScript/JavaScript code text has its own Function Logic boundary. Direct
`eval("…")`, `new Function("…")`, `setTimeout("…")`/`setInterval("…")`, and Node
`vm.runIn*`/`compileFunction` consumers accept only a statically complete string literal,
no-substitution template, explicit `js`/`ts` code tag, or bounded literal-only `+`
concatenation. A stored literal is recognized conservatively only when parsing proves
function/control/multi-statement code shape; ordinary text such as `"hello"` is not
reclassified as code.

The decoded text is parsed but never executed. Its top-level program and every contained
function declaration, function-valued binding, method, accessor, arrow, and nested
function receive separate `TEXT`/`FN` scopes. Definition edges explicitly say that a body
is not invoked. Immediate eval/vm text resumes the host statement after its embedded exit;
timer text is deferred with no immediate return; stored and `Function` text remain
definition-only until a real invocation can be proven. Interpolated templates, identifier
arguments, runtime-built strings, and parser recovery stay visible analysis gaps.

Select a `true`, `false`, or `case` edge label—or the matching choice in the
selected-node panel—to preview that static scenario. Nested selections compose,
and the highlighted flow continues through shared merge blocks and every later
reachable statement. Select the same choice again to clear it, or use **Reset
choices** to restore every possible path. This is a source-backed hypothetical
path, not a claim about a captured runtime execution.

Standalone Python generator expressions remain a visible lazy-analysis gap because their
bodies run when advanced rather than when created. A generator passed directly
to a call is shown structurally, but whether and how far the callee consumes it
remains inferred. Nested comprehensions used directly as another comprehension's
emitted value also remain inside that emission block.
Python monkey patching, decorators, descriptors, and dynamic dispatch are not observed;
Java virtual dispatch, reflection, framework interception, threads, and overload
typing beyond conservative arity checks are also not observed.

Lexical-owner and unambiguous qualified-name matches can be `resolved`, while
conservative same-file or unique-name fallbacks remain `inferred`. Dynamic dispatch, computed
properties, runtime registration, ambiguous imports, and unsupported syntax may
remain unresolved or be missed. The Flow Reader must keep these limitations
visible instead of filling gaps with guesses.

## Architecture

```text
Analyzer -> Project Graph -> Semantic Flow -> CodeFlow Projection
                                                |
                              Flow Catalog -> Flow Reader -> Source

Current Source -> Function Logic Analyzer -> Logic Projection -> Function Visualizer
                                      |             |               |- Breadcrumbs
                                      |             |               `- Statement evidence
                                      |             `-> Direct Callee Tokens -> Lazy Inline Branch
                                      `-> Layered Graph Layout -> Node Detail

Workspace Graph -> Project Module Index -> Bounded Module Flow -> Module Visualizer
                         |                        |              |- Detail / Evidence
                         |                        |              `- Same-canvas Function Logic
                         `-> Host-only index      `-> Lazy module/function branches
```

Key reusable modules:

- `src/insights/semanticFlow/` — framework entrypoints and bounded downstream
  traversal
- `src/insights/changeImpact/` — bounded reverse-call impact
- `src/insights/architecturalLayers/` — evidence-backed responsibility hints
- `src/insights/projectModules/` — manifest/framework/source-area responsibility
  boundaries and cross-module relation aggregation
- `src/application/codeFlow/` — flow catalog and detail projection
- `src/application/moduleFlow/` — bounded module projection, iterative SCC layout,
  variable box sizing, obstacle-safe orthogonal routing, and deterministic
  crossing bridges with local direction cues
- `src/application/codeFlow/functionLogicGraphLayout.ts` — bounded layered graph
  layout and outer-channel edge routing
- `src/application/codeFlow/functionLogicDrillTargets.ts` — bounded direct-callee
  and callsite-to-logic-block projection
- `src/analyzer/core/lezerSource.ts` — shared parser snapshot, UTF-16 range, and
  iterative syntax-tree helpers
- `src/analyzer/functionLogic/core/` — language-neutral block budgets, Lezer
  orchestration, and iterative structured CFG construction
- `src/analyzer/functionLogic/` — public language dispatcher and the
  TypeScript/JavaScript compiler-AST adapter
- `src/analyzer/functionLogic/dataFlow/` — language-owned lexical binding facts
  and bounded iterative reaching-definition projection
- `src/analyzer/functionLogic/events/` — TypeScript/JavaScript JSX, listener API,
  and event-property registration boundaries
- `src/analyzer/functionLogic/embeddedCode/` — literal-only code discovery,
  iterative program/callable-scope planning, host CFG integration, and virtual
  evidence remapping
- `src/analyzer/functionLogic/languages/` — Python/Java Lezer adapters and the
  F#/OCaml/Elixir pipe-forward Function Logic adapter
- `src/analyzer/languages/python/`, `src/analyzer/languages/java/`, and
  `src/analyzer/languages/functional/` — shared callable, pipeline, and
  conservative call-graph syntax boundaries
- `src/analyzer/rust/supplementalLanguageGraph.ts` — selected-language graph
  merge used to add Java and functional-language evidence without replacing
  primary Rust results
- `src/extension/currentFunctionVisualization/` — editor command and exact
  cursor-target graph adaptation
- `src/extension/workspaceAnalysis/` — exact-fingerprint workspace graph
  acquisition with no latest/stale cache fallback
- `src/extension/moduleVisualization/` — Module Flow command composition
- `src/protocol/codeFlow.ts` — typed Host/Webview contract
- `src/protocol/moduleFlow.ts` — bounded list/detail/expand/source requests,
  opaque identities, and stale-response guards
- `src/protocol/functionLogic.ts` — logic blocks, transfers, drill targets, and
  evidence requests
- `src/protocol/functionVisualizer.ts` — editor-tab navigation session contract
- `src/webview/codeFlow/` — flow-first Activity Bar launcher and shared graph
  renderer
- `src/webview/codePresentation/` — reusable, non-executing source-snippet
  tokenizer, textContent renderer, and VS Code theme token styles
- `src/webview/codeFlow/viewport/` — pure Function Logic transform geometry and
  browser-only free-pan, focal zoom, Center, and Fit controls
- `src/webview/codeFlow/valuePreview/` — session-only literal Scenario editor and
  bounded definition/consume/sink progression
- `src/webview/functionVisualizer/` — editor-tab lifecycle, reading UX, and
  cycle-safe lazy function navigation
- `src/webview/moduleVisualizer/` — dedicated Module Flow tab, detail/evidence,
  lazy same-canvas module/function expansion, directional lineage focus, initial
  scene restoration, and bounded Function Logic delivery
- `src/webview/sourceNavigation/` — snapshot-local source tokens

## Flow Bounds

Entrypoint flows are intentionally finite. Configure their reading budget with
`projectAnalyzer.codeFlow.maxDepth` (default `3`) and
`projectAnalyzer.codeFlow.maxSteps` (default `30`). Function-internal projections
use `projectAnalyzer.codeFlow.maxLogicBlocks` (default `120`, maximum `300`).
Lexical value flow retains at most 80 unambiguous bindings, 700 access facts, and
900 definition-to-use relations per function; any bounded omission is surfaced as
an analysis gap. Graph nodes render at most eight access rows while the binding
selector still exposes every retained binding. The scenario-value editor shows at
most 120 retained bindings and accepts up to 240 literal characters per binding;
its selected trace renders at most 80 access steps. Those browser-session
annotations are never evaluated, persisted to source, sent to the Extension Host,
or used to choose a branch. Clicking a `Name` label only selects the existing
static definition-to-use overlay.

Embedded-code discovery accepts at most 24,000 decoded characters and 64 literal-only
concatenation pieces per candidate, retains at most 16 regions, and shares the configured
Function Logic block budget. Multiple functions are queued iteratively; omitted regions,
callable scopes, parser diagnostics, and dynamic text consumers are reported as gaps.

Function Logic viewport movement is presentation-only. Pan uses a numerically
guarded screen transform rather than analyzer coordinates, zoom is bounded to
1%–300%, and **Fit** never enlarges a small graph above 100%.

Direct callee navigation is capped at 24 unique concrete definitions per
function and expands only after a user action. The editor tab attaches at most 32
child functions across six nested levels to one compound graph canvas; clicking an
expanded call box collapses its whole descendant branch. A loaded child is placed
between its callsite and an explicit resume gateway, so the caller's original
`true`/`false`/`next` path continues only after the child flow. Cycle, visited, and
hard-budget guards remain active, and anything beyond a selected budget appears
as an explicit gap or omitted count instead of disappearing silently. Those
graph-size budgets do not truncate text inside a retained block: statement,
branch, value-change, child-function, and resume labels remain complete and make
their boxes grow vertically as they wrap.

Module Flow uses independent hard budgets: 80 modules/160 edges for the initial
scene, 40 relations/5 evidence rows for detail, and 48 nodes/96 edges for one
module or function-logic expansion delta. The merged browser scene is capped at
500 nodes/1,000 edges and evicts oldest expansion branches first; a function-logic
branch cannot evict the parent branch that owns its anchor card. The full module
index remains Host-side. Module, edge, function,
source, and evidence identities are snapshot-local opaque tokens, and mismatched
graph versions or late request IDs are rejected instead of being merged into the
current tab. Changing the selected module also invalidates pending component
requests owned by the previous module. The browser computes selected-module
lineage iteratively over the already bounded scene with explicit visited and
depth guards; it never requests an unbounded graph merely to focus the layout.

## Privacy and Local Data

The current release analyzes workspace source locally in the VS Code Extension
Host and its bundled native analyzer. It does not send workspace source to a
remote analysis service. Structured UI diagnostics are written only to the local
**Project Analyzer** output channel.

When analysis caching is enabled, bounded graph data is stored in VS Code's
extension storage. The default cache budget is 256 MiB. Use **Clear Analysis
Cache** in the Code Flow sidebar to remove the persisted analysis cache, or set
`projectAnalyzer.cache.enabled` to `false` to disable persistence. Graph export
occurs only after an explicit user action.

## Troubleshooting

- **No context-menu command:** confirm the file uses a supported language and the
  cursor is inside a supported callable. F#/OCaml/Elixir currently require a
  named function containing a `|>` flow.
- **No modules or functions:** wait for workspace analysis, then inspect the
  `projectAnalyzer.include`, `projectAnalyzer.exclude`, and
  `projectAnalyzer.maxFileSizeKb` settings.
- **High analysis cost:** narrow the include globs, disable
  `projectAnalyzer.autoAnalyze`, or lower the rendering and flow budgets before
  reopening the view.
- **Incomplete edges:** open the selected evidence. Dashed `inferred` and
  `unresolved` connections are deliberate static-analysis limits, not observed
  runtime facts.
- **Unexpected stale results:** choose **Clear Analysis Cache**, reproduce once,
  and inspect **View -> Output -> Project Analyzer**.

When reporting a problem, include the extension version, VS Code version,
platform/architecture, source language, minimal reproduction, and relevant local
output lines. Remove proprietary source before sharing diagnostics.

## Development

```sh
npm install
npm run engine:build
npm run compile
```

Open the repository in VS Code and run `Run Project Analyzer Extension` from the
Run and Debug view. The extension contributes a Project Analyzer Activity Bar
container named Code Flow with the flow-first sidebar.

## Tests

```sh
npm test
```

For faster checks while working on the extension host and Webview:

```sh
npm run check
npm run compile
node --test out/test/unit/*.test.js
```

## Rust Engine

```sh
npm run engine:test
npm run engine:build
```

The Rust analyzer lives in `engine/analyzer` and emits versioned Project Graph
JSON. Source code remains local by default.

## Packaging

```sh
npm run package:vsix
```

Packaging builds one target-specific native engine, excludes Cargo build
artifacts, and checks the VSIX size budget.

Marketplace releases use the publisher identity `newdlops.function-analysis`.
Pushing a matching `v<major>.<minor>.<patch>` tag runs the guarded six-platform
release workflow. Maintainer credentials, OIDC setup, version checks, supported
targets, and retry behavior are documented in [Releasing Project Analyzer](docs/RELEASING.md).

## License

Project Analyzer is available under the [MIT License](LICENSE).
