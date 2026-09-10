# Function Calls mode

The Function Visualizer exposes two independent modes. Statement flow retains its
block diagram and scenario workspace. Function calls opens **Call order**, a
parent-controlled scenario draft, and also offers **Call relationships**, with one
node for each identified project callable and connections grouping distinct callsites. Switching
modes hides the other surface and preserves both cameras and selections. Opening
a selected function's statement flow is an explicit navigation action.

## Public boundaries

- `analyzer/functionCalls.createFunctionCallContexts(analysis, options)` joins
  parser callsites to CFG prerequisites and lexical loops. `sourceText` enables
  language-owned expression guards; `maxDepth` bounds traversal. The TypeScript
  adapter covers JS/TS/JSX/TSX short circuits, ternaries and optional dispatch. The
  Python adapter covers `and`, `or` and conditional expressions. No source executes.
  Parser evaluation-order keys place argument calls before their consumers, and
  Python conditional tests before their selected arm. Offset-owned guard identities
  distinguish identical source text at different decisions.
- `application/functionCalls.createFunctionCallsSlice(...)` combines contexts with
  the existing direct-target resolver, projects opaque function identities and
  per-callsite evidence. `createProjectCallableScope(workspaceRoot)` accepts concrete
  workspace callables outside installed dependency/environment directories. Apply
  this scope before issuing target tokens and allocating target/site budgets.
  Source tokens are stable within the panel snapshot, so separately expanded
  callers share the same callee node. Exact/resolved/inferred confidence
  remains distinct. Graph-only evidence carries an explicit context limitation.
  Its private `controlPlan` projection adds a bounded, opaque parent CFG to the
  response: source signature, ordered callsite IDs/expressions, decision identities,
  loop owners and abrupt-completion cleanup continuations.
- `protocol/functionCalls` defines the bounded request/response contract.
  `functionCalls/load` accepts only graph version, issued source token and a safe
  nonnegative integer request sequence. Raw paths and extra request fields fail
  runtime validation.
- `webview/functionCalls.FunctionCallsHostDelivery` authorizes the snapshot/token,
  rejects non-project roots before reading a single source and drops late results after reset, snapshot replacement
  or a newer request. A dirty root snapshot overrides disk; other source reads use
  the existing VS Code boundary.
- `webview/functionCalls` also exports generated browser behavior and styles. Its
  private iterative layout groups connections and detects self/mutual cycles.
  Graph buttons and the native expandable call list offer equivalent selection;
  the detail area exposes full conditions and explicit source/statement actions.
  Private `controlSource` walks one selected parent's plan without executing source;
  `scenarioSource` owns native controls, drafts and clipboard feedback. The retained
  mode controller owns graph state and the existing statement navigation boundary.

## Parent-controlled scenario drafts

Call order starts from the parent interface, then presents decisions beside numbered
project calls with their original argument expressions, prerequisites, loop visit
and source location. Selecting a call opens its relationship; selecting another
parent lazily loads that function's direct plan. The sequence does not recursively
inline callee bodies. **Check parent inputs** opens the existing Values inspector.
For the current statement function this preserves mounted DOM and manual inputs;
another parent uses normal source-token navigation before opening Values.

Each reached decision requires an explicit outcome. Loop counts 0, 1 or 2 are
assumptions; repeated decisions have independent visit keys. The walker stops at an
unselected condition and preserves return/throw, break/continue and finally cleanup.
Nested finally blocks run inside out; an abrupt completion from finally can replace
the pending completion. Iterator factory expressions run once per loop activation;
while predicate calls also occur on the final exit check. Other loop forms remain
visibly limited. Event/render/deferred relationships are separate dispatch evidence,
not immediate call ordinals. Graph-only callsites remain available in relationships.

A bounded breadth-first search offers at most eight examples, considering at most
160 partial choices with a 256-item queue. Examples sample 0/1 loop visits; two
visits are available through editing. Plans cap at 512 blocks and 1,024 transfers;
traces cap at 1,024 steps and 256 displayed rows with explicit visited-state guards.
Unknown blocks, truncated evidence, missing connections and unsupported ordering
keep a visible limitation instead of creating runtime evidence.
An explicit throw inside a surrounding catch/except region stops as incomplete:
the shared CFG does not resolve the thrown value to a handler. It is not reported
as an uncaught function exit; handler lanes can still be inspected as assumptions.

The controls and generated draft always state that decisions are assumed and input
values remain unverified. Different assumptions may be mutually infeasible for a
concrete input or external state; these drafts are not a constraint solver, measured
execution, or exhaustive scenario coverage. Numeric argument values and cross-call
value propagation are not invented. Existing Values analysis is the next inspection
step and does not automatically apply a draft's assumptions.

Draft names, choices and disclosure state are retained per parent through view,
mode and locale changes, and cleared for a new snapshot. Copy feedback distinguishes
success from clipboard denial, which selects the text for manual copying. Narrow
layouts stack complete controls with explicit jumps between conditions and calls.

The reading layer uses shared semantic cues: purple decisions, orange repetition,
blue calls, green return/end, red throws and yellow pending/incomplete evidence.
It derives accents and surfaces from VS Code tokens and keeps body text in the
theme foreground. Explicit labels, diamond/repeat/return symbols and call ordinals
carry the same meaning in forced colors. A false outcome is never an error state.
Decision beats appear in the trace after predicate calls, use the same visit key
as their control, and expose **Edit** to focus that exact control. The plain-text
draft includes these decisions in order. Each decision counts toward the existing
256-row trace bound; the source/evaluation and call ordinal semantics stay intact.

The private `presentationSource` module shares cues and relationship classification
between both views. Relationship colors describe call/condition/repetition/separate
dispatch, with cycle and loop text retained. Selected edges keep their role color,
and inferred/deferred evidence keeps its dashed line. Color never upgrades evidence
confidence or indicates that the draft ran or its input values were verified.

## Semantics and limits

This mode focuses on business code through project source ownership, not a semantic
classification of every function. Builtins, unresolved targets, source outside the
workspace, `site-packages`, `dist-packages`, virtual environments, `__pypackages__`
and `node_modules` do not become nodes. The same rule applies to graph-only edges
and every expanded neighborhood. Excluded sites do not consume diagram budgets or
count as budget omissions. Their original expressions remain in guards and loops.

`analyzer/functionCalls.createPythonCallTargetFilter(source, workspaceRoot, maxDepth)`
indexes lexical definitions, imports/aliases and dynamic bindings using a bounded
iterative parser walk. Name-only guesses need a visible definition or matching
module path, preventing `items.append()` and library aliases from borrowing an
unrelated project function's identity. Locally defined `len` and proven `self`
methods remain available. The shared statement-mode drill resolver keeps its
existing behavior; these filters are opt-in projection callbacks.

Ownership is lexical and does not resolve symlinks or load imported modules.
Unresolved dynamic receivers, re-exports and unsupported binding patterns can omit
project calls; the hint and empty state explicitly say *identified* project functions.
Source statement analysis remains available for those calls.

A branch prerequisite must dominate the call and exactly one outgoing branch must
reach it in the forward CFG. Return/throw exits therefore preserve the condition
required to continue, while joined branches are excluded. Calls evaluating a
predicate do not assume that predicate's result. Loop backedges are omitted from
this prerequisite pass to avoid confusing separate iterations; lexical loop owners
provide the repetition description instead.

Source expression guards supplement conditions that remain inside larger statement
blocks. A returned closure does not imply its body was invoked. Event/render
relations retain their existing analysis meaning, and deferred dispatch is shown
separately. Relationship connections describe possible source relationships, not execution order,
observed values, iteration counts or termination. Dynamic dispatch, external effects,
runtime exceptions, framework scheduling and unsupported language expressions can
remain unknown. The mode does not build a whole-program execution proof.

Initial loading reads only the root. Expansion is explicit and serialized: at most
32 visible project functions, 128 callsites and depth 6 per panel session. Each
Host slice uses at most 512 blocks, 96 project syntax callsites and 32 nodes. Traversals use
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
duplicate calls, portable project scope, dependency/builtin exclusion, library alias
collisions, locally shadowed builtin names and budgets after filtering. Host tests cover dirty source,
source evidence, unavailable/failed reads, authority checks, replay and late results.
Browser QA separately exercises the generated production HTML, mode retention,
keyboard selection, expansion, source actions, dense/long content and narrow views.
Parent scenario fixtures additionally cover TS/Python nested argument ordering,
independent loop visits, break/continue, iterator versus while evaluation, nested
finally cleanup and completion replacement, optional dispatch and traversal limits.
Browser checks exercise per-parent drafts, condition editing, successful/denied copy,
retained manual inputs, child Values navigation, lazy-load failures/retry and stale
plan rejection at 1440×900, 768×1024 and 390×844.
