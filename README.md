# Project Analyzer: Code Flow

Project Analyzer is a VS Code Code Flow Reader for understanding unfamiliar
codebases quickly.

It starts from one concrete entrypoint or function, follows only the bounded code
paths relevant to that question, and keeps every visual step connected to source
evidence. Static analysis and the project graph remain internal evidence engines;
the product does not begin with a dashboard, curriculum, file inventory, or a
whole-repository graph.

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

TypeScript and JavaScript also have a source-first shortcut: place the cursor
inside a function, method, constructor, arrow function, or callback, then choose
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
- content-sized node boxes that wrap the full visible label and source detail
- sibling lanes for `true`/`false`, loop-body/exit, and switch branches
- labeled edges for `true`, `false`, `iterate`, `repeat`, `return`, and `throw`
- outer channels for loop-back and long exit edges so they do not cross nodes
- rank-gap routing that prevents every unrelated edge segment from crossing a box
- solid exact edges and dashed inferred, exception, and back edges
- exact syntax evidence for conditions, mutations, calls, and exits
- conservative, visibly `inferred` effect candidates
- a selected-node panel with complete detail and outgoing targets
- direct concrete callees matched to their source call blocks
- lazy **Open child function** actions instead of eager recursive expansion
- breadcrumb and parent navigation through already-read function details
- cycle reuse: revisiting a function selects its existing breadcrumb
- bounded 50%–160% graph zoom with a scrollable canvas
- one-click navigation to the exact statement rather than only the declaration
- known HTTP/GraphQL entrypoints that reach the selected function

Opening source is verification, not a claim that the code has been understood.

## Product Scope

The product combines interprocedural feature flow with intraprocedural function
logic:

```text
HTTP/GraphQL/selected function
  -> Handler
  -> Application or domain candidate
  -> Repository or model
  -> External or state boundary

Selected TypeScript/JavaScript function
  -> Condition or loop
  -> Branch-local operation/call/mutation/effect
  -> Return, throw, repeat, or fallthrough exit
```

Variable-level data flow, runtime instrumentation, collaboration, and
whole-project graph views remain outside the first flow-first experience. The
repository's `SPEC.MD` contains the product contract, semantics, UX states, and
milestones.

## Current Analysis Coverage

Workspace analysis recognizes HTTP route-to-handler entrypoints for Django,
FastAPI, Express, and NestJS, plus code-first GraphQL root operations for NestJS
GraphQL and Strawberry. The semantic-flow traversal follows only analyzed
`calls` edges and uses explicit depth, step, cycle, and duplicate guards.

The Rust engine remains a lightweight syntax analyzer rather than a compiler
frontend. Cross-function JavaScript and TypeScript extraction uses textual and
line-oriented heuristics without a lexical scope graph, receiver resolution, or
type checking. After a function is selected, its current TypeScript/JavaScript
document is parsed with the TypeScript compiler AST to build statement-level
logic and exact source ranges. Editor-context selection can add an exact,
snapshot-local callable node when the lightweight project analyzer did not model
an anonymous callback or function-valued property. Expression-level
short-circuiting, optional chaining, ternaries, callee exceptions, callback
invocation order, and runtime values remain explicit limitations.

Python uses a stateful scanner that masks comments and strings and preserves
UTF-16 source locations. Python functions can be searched and followed in the
inter-function flow, but function-internal logic currently reports an explicit
unsupported-language gap rather than inventing blocks.

Same-file lexical or qualified-name matches are reported as `resolved`, while
conservative unique-name fallbacks can be `inferred`. Dynamic dispatch, computed
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
                                      |             `-> Direct Callee Tokens -> Lazy Drill
                                      `-> Layered Graph Layout -> Node Detail
```

Key reusable modules:

- `src/insights/semanticFlow/` — framework entrypoints and bounded downstream
  traversal
- `src/insights/changeImpact/` — bounded reverse-call impact
- `src/insights/architecturalLayers/` — evidence-backed responsibility hints
- `src/application/codeFlow/` — flow catalog and detail projection
- `src/application/codeFlow/functionLogicGraphLayout.ts` — bounded layered graph
  layout and outer-channel edge routing
- `src/application/codeFlow/functionLogicDrillTargets.ts` — bounded direct-callee
  and callsite-to-logic-block projection
- `src/analyzer/functionLogic/` — TypeScript/JavaScript function-local AST and CFG
- `src/extension/currentFunctionVisualization/` — editor command and exact
  cursor-target graph adaptation
- `src/protocol/codeFlow.ts` — typed Host/Webview contract
- `src/protocol/functionLogic.ts` — logic blocks, transfers, drill targets, and
  evidence requests
- `src/protocol/functionVisualizer.ts` — editor-tab navigation session contract
- `src/webview/codeFlow/` — flow-first Activity Bar launcher and shared graph
  renderer
- `src/webview/functionVisualizer/` — editor-tab lifecycle, reading UX, and
  cycle-safe lazy function navigation
- `src/webview/sourceNavigation/` — snapshot-local source tokens

## Flow Bounds

Entrypoint flows are intentionally finite. Configure their reading budget with
`projectAnalyzer.codeFlow.maxDepth` (default `3`) and
`projectAnalyzer.codeFlow.maxSteps` (default `30`). Function-internal projections
use `projectAnalyzer.codeFlow.maxLogicBlocks` (default `120`, maximum `300`).
Direct callee navigation is capped at 24 unique concrete definitions per
function and expands only after a user action. Cycle, visited, and hard-budget
guards remain active, and anything beyond a selected budget appears as an
explicit gap or omitted count instead of disappearing silently.

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
