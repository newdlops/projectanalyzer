# Function Calls mode

The Function Visualizer exposes two independent modes. Statement flow retains its
block diagram and scenario workspace. Function calls shows one node for each
known callable, with directed connections grouping its distinct callsites. Switching
modes hides the other surface and preserves both cameras and selections. Opening
a selected function's statement flow is an explicit navigation action.

## Public boundaries

- `analyzer/functionCalls.createFunctionCallContexts(analysis, options)` joins
  parser callsites to CFG prerequisites and lexical loops. `sourceText` enables
  language-owned expression guards; `maxDepth` bounds traversal. The TypeScript
  adapter covers JS/TS/JSX/TSX short circuits, ternaries and optional dispatch. The
  Python adapter covers `and`, `or` and conditional expressions. No source executes.
- `application/functionCalls.createFunctionCallsSlice(...)` combines contexts with
  the existing direct-target resolver, projects opaque function identities and
  per-callsite evidence, and retains unresolved spellings scoped to their caller.
  Source tokens are stable within the panel snapshot, so separately expanded
  callers share the same callee node. Exact/resolved/inferred/unresolved confidence
  remains distinct. Graph-only evidence carries an explicit context limitation.
- `protocol/functionCalls` defines the bounded request/response contract.
  `functionCalls/load` accepts only graph version, issued source token and a safe
  nonnegative integer request sequence. Raw paths and extra request fields fail
  runtime validation.
- `webview/functionCalls.FunctionCallsHostDelivery` authorizes the snapshot/token,
  reads a single source and drops late results after reset, snapshot replacement
  or a newer request. A dirty root snapshot overrides disk; other source reads use
  the existing VS Code boundary.
- `webview/functionCalls` also exports generated browser behavior and styles. Its
  private iterative layout groups connections and detects self/mutual cycles.
  Graph buttons and the native expandable call list offer equivalent selection;
  the detail area exposes full conditions and explicit source/statement actions.

## Semantics and limits

A branch prerequisite must dominate the call and exactly one outgoing branch must
reach it in the forward CFG. Return/throw exits therefore preserve the condition
required to continue, while joined branches are excluded. Calls evaluating a
predicate do not assume that predicate's result. Loop backedges are omitted from
this prerequisite pass to avoid confusing separate iterations; lexical loop owners
provide the repetition description instead.

Source expression guards supplement conditions that remain inside larger statement
blocks. A returned closure does not imply its body was invoked. Event/render
relations retain their existing analysis meaning, and deferred dispatch is shown
separately. Connections describe possible source relationships, not execution order,
observed values, iteration counts or termination. Dynamic dispatch, external effects,
runtime exceptions, framework scheduling and unsupported language expressions can
remain unknown. The mode does not build a whole-program execution proof.

Initial loading reads only the root. Expansion is explicit and serialized: at most
32 visible function/unknown nodes, 128 callsites and depth 6 per panel session. Each
Host slice uses at most 512 blocks, 96 syntax callsites and 32 nodes. Traversals use
queues/sets and bounds. Omitted relationships are counted and incomplete contexts
are labeled. More than one call to a function is kept as separate evidence under
one connection; the summary directs users to compare their conditions instead of
pretending the first site's guard applies to all sites.

The diagram uses VS Code theme tokens and a scrollable canvas. Initial centering
keeps the root visible in narrow windows. Full labels remain in the detail area and
call list; selecting nodes never blurs unrelated functions. Loading, source failure,
retry, stale snapshot, leaf function and expansion limits have explicit states.

## Verification

Fixture snapshots cover TS/Python early returns, loop bodies, predicate calls,
rejoined branches, ternaries and short circuits. Additional tests cover nested TS
argument guards, optional dispatch, unique shared targets, self/mutual cycles,
duplicate calls, unknown targets and bounds. Host tests cover dirty source,
source evidence, unavailable/failed reads, authority checks, replay and late results.
Browser QA separately exercises the generated production HTML, mode retention,
keyboard selection, expansion, source actions, dense/long content and narrow views.
