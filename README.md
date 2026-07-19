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
3. Select the matching `project-analyzer-<version>-<target>.vsix` file.
4. Reload the window when VS Code asks.

Command-line installation is also supported:

```sh
code --install-extension project-analyzer-<version>-<target>.vsix
```

The extension requires VS Code 1.92 or newer and runs in the desktop Extension
Host; it is not currently a browser/Web extension.

## First Flow in 60 Seconds

1. Open the codebase folder and let the initial local analysis finish.
2. Place the cursor inside a supported function and right-click
   **Visualize Current Function**.
3. Read from the entry block through decisions, effects, mutations, and exits.
4. Click a call block to attach the child function on the same canvas; click the
   expanded call again to collapse that branch.
5. Use the visible **See how modules connect** card and **Open Module Flow**
   button when the question moves from one function to project responsibility
   boundaries.

Supported source-first function visualization currently covers:

| Language family | Function Logic coverage |
| --- | --- |
| TypeScript / JavaScript / JSX / TSX | Statements, branches, loops, effects, receiver chains, and component callsites |
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

- a four-pass reading frame: Start, Choose, Do, Finish
- the current function signature
- statement nodes arranged in top-to-bottom execution ranks
- content-sized node boxes that preserve complete source labels, values, and
  child-function names by wrapping instead of adding ellipses
- subtle depth tints that distinguish nested blocks without replacing semantic kind colors
- inline `VAR`, `FIELD`, and `RECEIVER` rows showing which value changes at each block
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
- compound body frames that enclose each `if`, loop, switch, try, and context-manager
  owner with only its nested statements, excluding the following continuation
- labeled edges for `true`, `false`, `iterate`, `repeat`, `return`, and `throw`
- outer channels for loop-back and long exit edges so they do not cross nodes
- post-loop statements placed below the complete loop-back ring, never beside its body
- rank-gap routing that prevents every unrelated edge segment from crossing a box
- solid exact edges and dashed inferred, exception, and back edges
- exact syntax evidence for conditions, mutations, calls, and exits
- conservative, visibly `inferred` effect candidates
- a selected-node panel with complete detail and outgoing targets
- direct concrete callees matched to their source call blocks
- parser-backed callsite recovery for calls nested in conditions, loops, and
  switch/match expressions
- visibly inferred unique-name fallback when a lightweight graph misses a multiline body
- click-to-attach child function blocks to the original graph canvas
- callsite-anchored scroll restoration and reduced-motion-aware child entry animation
- `callsite → child flow → resume → caller branch` attachment on one compound canvas
- distinct call/return styling plus per-edge node ports and rank-gap tracks that prevent overlapping routes
- parent-aware child lanes and branch collapse for nested functions
- lazy one-function-at-a-time analysis instead of eager recursive loading
- breadcrumb and parent navigation through already-read function details
- visible cycle guards that reuse an attached ancestor or an existing breadcrumb
- bounded 50%–160% graph zoom with a scrollable canvas
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
- click-to-attach boundary functions to the same canvas while preserving the
  clicked module's scroll anchor
- a complete-canvas budget of 500 nodes and 1,000 edges; attaching beyond it
  releases the oldest expansion branches instead of retaining unbounded DOM/layout state
- reduced-motion-aware entry animation for only the newly attached nodes and edges
- focal zoom with `−`/percentage/`+`, whole-graph **Fit**, `+`/`-`/`0`/`F`
  graph shortcuts, and Ctrl/Cmd-wheel zoom around the cursor
- background drag panning, centered small graphs, and resize-stable reading position
- frame-coalesced viewport updates plus keyed card/edge reuse, so zoom, selection,
  loading, and panning do not rerun SCC layout or remount the graph
- hidden editor tabs release their Webview DOM and restore from the existing Host
  projection when revealed, without rerunning workspace analysis
- bounded module/edge detail, representative evidence, and source actions
- one-action handoff from a concrete function to its statement-level Function Visualizer

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
  -> Function Visualizer
```

Cross-statement def-use slicing, runtime instrumentation, collaboration, and a
raw unbounded whole-project graph remain outside the flow-first experience. The
bounded Module Flow is part of the current product. The repository's `SPEC.MD`
contains the product contract, semantics, UX states, and milestones.

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

F#/OCaml/Elixir model `|>` as exact sequential evaluation, preserving complete
input and stage text plus each language's argument-insertion direction. Named
local stages can attach their Function Logic on the same canvas. Function
composition, computation expressions/macros, Haskell composition, and monadic
bind are not relabeled as pipe chains; higher-order callback execution remains a
visible runtime limitation.

JSX and TSX functions retain normal statement flow and also expose uppercase or
member-style component tags such as `<Badge />` and `<UI.Panel />` as exact
component callsites. Lowercase intrinsic elements stay presentation syntax,
inline event callbacks remain independently selectable functions, and
`memo`/`forwardRef` wrapped components retain their binding names for analysis.

Python `with` and `async with` keep only the context-manager header in their
structural node. Each indented body statement remains a separate flow node and
continues to the first statement after context exit.

Expression-level short-circuiting remains inside its containing block. Standalone
Python generator expressions remain a visible lazy-analysis gap because their
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
                         |                        |              `- Function Visualizer handoff
                         `-> Host-only index      `-> Lazy same-canvas boundary functions
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
  variable box sizing, and obstacle-safe orthogonal routing
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
- `src/webview/functionVisualizer/` — editor-tab lifecycle, reading UX, and
  cycle-safe lazy function navigation
- `src/webview/moduleVisualizer/` — dedicated Module Flow tab, detail/evidence,
  lazy same-canvas expansion, and Function Visualizer handoff
- `src/webview/sourceNavigation/` — snapshot-local source tokens

## Flow Bounds

Entrypoint flows are intentionally finite. Configure their reading budget with
`projectAnalyzer.codeFlow.maxDepth` (default `3`) and
`projectAnalyzer.codeFlow.maxSteps` (default `30`). Function-internal projections
use `projectAnalyzer.codeFlow.maxLogicBlocks` (default `120`, maximum `300`).
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
expansion delta. The merged browser scene is capped at 500 nodes/1,000 edges and
evicts oldest expansion branches first. The full module index remains Host-side. Module, edge, function,
source, and evidence identities are snapshot-local opaque tokens, and mismatched
graph versions or late request IDs are rejected instead of being merged into the
current tab.

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
