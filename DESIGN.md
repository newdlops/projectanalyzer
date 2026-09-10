# Function reading workspace

## Call reading colors — September 2026

Refine the existing call workspace for developers reading a parent's scenario.
Keep native forms, source expressions, retained drafts and the separate relationship
diagram. Give each transition a visible place in the sequence: predicate call →
decision and assumed outcome → dependent calls. A decision in the trace links back
to its matching control, including the correct repeated visit.

Use VS Code chart colors as local reading roles: purple decisions, orange loop
visits, blue project calls, green returns, red throws, and yellow unknown/pending
states. A false condition is an ordinary branch, never an error. Keep body/code
text in the theme foreground; use light tinted surfaces, colored shapes and thin
borders for meaning. Diamond, repeat arrow, call ordinal and return arrow reinforce
the labels. A compact key explains the colors. Match relationship edges and their
labels to conditional, repeated or separate dispatch evidence; selection must stay
distinct without dimming other functions or erasing uncertainty dashes.

Use a vertical connector through the ordered trace, with full-width decision and
loop beats separating calls. Preserve the established flat 4/8/12/16px rhythm and
code font. Keep long arguments and conditions readable, stack at 768px/390px, and
retain the condition/call jump actions. Do not add decoration or automatic motion.

Acceptance: condition/loop/call/end roles are recognizable in the initial and edited
route; a true/false change moves the correct calls; predicate calls precede decision
beats; repeated decisions keep separate controls. Verify mouse and keyboard return
to a decision, graph selection/camera retention, drafts and input handoff, empty,
loading/error/limited/throw states, long labels and both languages. Inspect 1440×900,
768×1024 and 390×844 in dark/light/forced colors; check text contrast and non-color
cues including common color-vision deficiency emulation.

## Parent-controlled call scenarios — September 2026

The Function calls mode starts with **Call order / 호출 순서**. Developers choose
one parent function, inspect its signature, and follow a numbered sequence of its
business calls with original argument expressions. **Call relationships / 호출 관계**
retains the existing node-per-function diagram, expansion, camera and selection.
These are two views inside the same call mode, not another statement-flow mode.

- Hierarchy: parent selector/signature → compact scenario controls → reached
  conditions beside an ordered call trace → editable/copyable scenario draft.
  A direct action opens the parent's existing Values inspector for input checking.
- Follow CFG transitions, including early return/throw, break/continue and loop
  exits. Calls inside argument expressions precede their consumer. Inline
  short-circuit/conditional choices remain explicit. Deferred handlers do not
  become immediate numbered calls; graph-only evidence has no invented order.
- Start with bounded example routes so the initial view is useful; offer an empty
  draft for explicit choices. Labels say these are assumed conditions, with input
  values unverified. Example routes are not exhaustive or execution observations.
- Loop choices mean zero, one or two *assumed* iterations. Keep conditions on
  different visits independent, preserve loop boundaries, and mark bounded or
  unknown continuations. Never reuse a first-iteration outcome as a runtime fact.
- Keep per-parent drafts across selection/view/mode switches and locale changes.
  Reset on a new snapshot. Preserve edited statement inputs; opening Values does
  not apply fabricated values or start neural training automatically.
- Reuse existing VS Code theme tokens, UI/editor fonts, flat borders and 4/8/12/16px
  rhythm. Use a compact 280px condition column and flexible trace at desktop sizes;
  stack at 768px and 390px, with no document-level horizontal overflow. Code wraps;
  long traces/conditions scroll in bounded desktop regions. No decorative motion.
- Native labeled selects/buttons support keyboard operation and visible focus;
  reached conditions and call ordinals provide non-color cues. Handle pending,
  failed/retry, no business calls, unknown order, branch awaiting choice, incomplete
  analysis, copy failure/success, long expressions and maximum-density cases.

Acceptance: TS/Python nested argument order, mutually exclusive branches, joined
branches, early exits, loop skip/two visits, continue/break, inline guards, deferred
calls, distinct same-text decisions, source authority, budgets and stale responses.
Verify the production Webview at 390×844, 768×1024 and 1440×900; exercise presets,
editing conditions, changing parent, draft copy, source navigation, Values entry,
mode/camera retention and keyboard focus. Keep builtin/package exclusion intact.

## Function call mode — September 2026

Developers can switch between **Statement flow / 구문 흐름** and **Function calls /
함수 호출** in the dedicated Function Visualizer. The second mode is a separate
surface with its own graph, selection, zoom and expansion state. Keep the statement
surface mounted when switching so edited scenario values and graph state survive.

- Show one node per identified project function and directed edges per callsite. Source guards
  and enclosing loops label the connections. Distinguish loop-contained calls from
  recursive/cyclic call relationships; never infer iteration counts from a cycle.
- Start at the current root's direct calls. Select a function to inspect incoming
  and outgoing callsites, expand one more level, or open its statement flow. Expansion
  is lazy, bounded and cycle-safe. Repeated targets reuse their existing node.
- Focus this mode on business code: exclude builtins, unresolved targets, installed
  packages and source outside the workspace before allocating graph limits. Preserve
  their expressions in conditions and loops. Explain the scope in the mode hint and
  empty state. Retain deferred/event/render relations and inferred confidence with
  explicit line style. A source condition is a static prerequisite, not a runtime result.
- Hierarchy: shared function heading → two mode controls → concise mode explanation
  and graph controls → graph with selected function/call detail → accessible call
  list. The same list supplies full conditions when graph labels are abbreviated.
- Reuse VS Code colors, native buttons, code font, 4/8/12/16px spacing and flat
  borders. Use source-code labels as text, not markup. Selection uses border and
  text as well as color; unrelated nodes stay legible. No decorative animation.
- At 390px place details below the canvas; at 768px/1440px preserve a useful canvas
  with an adjacent detail region when space permits. The canvas may pan internally;
  the document, toolbar and detail must wrap without horizontal overflow. Keep
  keyboard node/list controls, visible focus, minimum 44px touch targets, polite
  load/status feedback, and reduced-motion support.
- Pending, retryable failure, empty project-call leaf, depth/node/edge limit,
  long names, parallel edges, self-calls, cycles and stale replies are explicit.
  Changing locale preserves state. Switching modes does not start neural training.

Acceptance covers TS and Python conditional/loop call fixtures, early-return guards,
calls inside predicates, shared callees, recursion, dependency exclusion/deferred calls,
bounded expansion, source actions and strict message validation. Independently
exercise real rendered 390×844/768×1024/1440×900 views, keyboard selection, mode
state retention, loading/error/empty/dense states, expansion and statement drill-in.

## Scenario input quality — September 2026

Scenario inputs should explain a distinct behavior: a source boundary, an early
return or exception, a compound guard, or a concrete caller's complete argument
tuple. Collect candidates before selecting a bounded set by newly demonstrated
control outcomes. A candidate's intended target is not evidence of reaching it.
Keep partial evaluation and external-state assumptions visible.

Within the existing Values scenario workspace, show why each input is useful and
which source path was checked. The explicit **Find inputs with neural network**
action trains a function-specific network locally from typed caller/planner tuples
and calculated comparison values. Show training and held-out counts, prediction
error, and the input/condition changes of a statically checked boundary pair.
Validate shapes and preserve inferred origin. Never execute application source or
silently replace edited inputs. The detailed contract is in
[Local neural scenario inference](docs/NEURAL_SCENARIOS.md).

**Use recommended values** starts the same local inference on its first click,
then fills a complete checked case and selects its explanation. During training
the button offers cancellation. Preserve edits made after the request began;
the returned cases remain available for explicit application. An unavailable or
failed analysis must leave the current input intact, with a visible explanation.
Python acceptance includes regex-shaped text, same-file pure validation, duplicate
handling on the second visit, multiline priority and concrete before/after values.

Parameter inference must preserve complete tuples, allocate text features to every
parameter and keep already satisfied outer guards while learning deeper conditions.
Candidate evidence includes Python assignments/helpers, integer constants and
source-connected string pieces. Learned joint ranking and up to three adaptive
training stages use a shared teacher budget; independently checked outcomes still
decide acceptance. Include multi-string signatures, large integers, integer loops,
three nested derived equalities and exact fractional guards in regression coverage.

Acceptance: boundary equality and both sides, late/deep/compound guards, caller
tuple correlation, duplicate rejection, malformed/model-absent/cancelled/error
states, stale-response rejection, and clear partial results. Preserve current
zoom, graph selection, edited inputs and locale focus. Verify the real generated
Webview at 390×844, 768×1024 and 1440×900, including dense recommendations.

## Understanding and framework behavior

The opening question is now “What comes in, what changes the path, and what
comes out?” A compact `At a glance` region precedes graph controls. It uses
authored documentation and actual parameter/decision/outcome facts, with three
explicit reading actions. Selecting a source step adds a short plain-language
explanation before its detailed evidence. Keep complete source code available.

React and Django behavior appears in a dedicated disclosure in the same
overview. State the function's evidenced role, then show framework-owned timing
and the matching source. React render, event callbacks, and post-commit Effects
are distinct. Django view dispatch, lazy query construction, query evaluation,
writes, and response creation are distinct. These are documented framework
contracts connected to static syntax, never an observed execution trace.

- Preserve existing editor colors, fonts, 4/8/12/16px spacing, flat borders and
  native controls. No new UI framework, font, palette, or decorative animation.
- The overview begins compact; details expand on demand without changing
  graph choices, values, or starting work. On narrow screens its reading actions
  wrap vertically. Support 320px, long names, dense functions and both languages.
- Each framework fact has a timing label, explanation, evidence confidence and
  an explicit source action. Link to a graph block only through source ranges.
  Imports, aliases, shadowing, nested callbacks, unknown receivers, parse errors
  and analysis limits must be represented conservatively.
- Ordinary functions retain the same reading overview without a false framework
  classification. An unreadable source or unsupported pattern must not break the
  existing function analysis. Framework calculations never execute application code.
- Keep filters, keyboard focus, disclosure state and entered values through
  locale changes. Primary actions have visible focus, disabled/empty explanations,
  wrapping labels and 44px touch targets. No automatic camera movement.

Acceptance: React fixtures cover import aliases/shadowing, state, effect dependency
and cleanup timing, event reference versus render-time invocation, and plain JSX
without React evidence. Django fixtures cover request/response, aliased decorators,
lazy versus evaluated QuerySets, writes, atomic scopes and receiver registration;
unrelated lookalike methods must not acquire exact Django semantics. Verify opaque
evidence projection, keyboard/locale interactions, empty/dense states and actual
390×844, 768×1024 and 1440×900 browser rendering independently from unit tests.

## Design contract — September 2026

Developers opening an unfamiliar function should find its starting point, key
decisions, calls, and exits before learning graph controls. The primary action
is selecting a readable source step and seeing that same step on the graph and
in its evidence panel. This is a substantial information-hierarchy improvement
to the existing VS Code product UI, using its existing native DOM components.

- **Hierarchy:** function name and source location → compact graph controls →
  source-order outline beside the canvas → selected-code evidence. Values and
  scenarios, and function-level information, each have their own labeled tab in
  the Inspector. Function Guide remains a separate, mutually exclusive reading
  disclosure. No calculations begin merely by opening a reading tab.
- **Outline:** a bounded list of the actual displayed blocks, with ordinal,
  semantic kind, source label, nesting, and textual confidence. Local filters
  for decisions, calls, and exits change only the list. Selecting a row reveals
  the existing graph block; Previous/Next follow the displayed source outline,
  not a claimed execution path. Branch choices remain explicit graph actions.
  Reading keeps the current zoom and aligns an oversized block to its source
  header. Graph context stays opaque; selected borders and stronger connecting
  strokes provide emphasis. Fading is reserved for explicit focus/path exclusions.
- **Density and typography:** compact editor density, UI font for navigation
  and explanation, editor monospace for source. Titles stay subordinate to
  source content. Use 4/8/12/16px spacing, existing 3–7px control radii, 1px theme
  borders, and flat surfaces without decorative elevation or new fonts.
- **Color:** VS Code foreground/background, list selection, focus, and existing
  semantic graph tokens. Kind and confidence are also written in text; no
  meaning relies on color. Selected navigation uses a visible border and full
  contrast text in both light and dark themes.
- **Responsive:** support 320px minimum width. On desktop the outline occupies
  a compact left column, leaving the graph primary. Below 1040px it becomes a
  collapsible reading list above the canvas; below 840px the Inspector stacks
  below it. All supporting regions scroll independently, long source wraps,
  and page-level horizontal overflow is unacceptable.
- **Interaction:** visible keyboard focus, native buttons, labeled tablists
  with Arrow/Home/End navigation, a single current outline item, retained
  per-session tab/filter state, and a readable no-match state. Opening a tab
  preserves values, branch choices, graph layout, and source authority. Direct
  graph selection returns the Inspector to selected-code evidence. Guide input
  handoff opens the Values tab. Idle, pending, error, empty, disabled, selected,
  focused, long-text, and dense states must remain usable.
- **Motion:** selection is immediate; camera changes occur only for explicit
  outline navigation. No new autoplay or animated decoration. Existing reduced
  motion and forced-colors behavior applies.
- **Avoid:** one endless panel of every tool, duplicated static ledgers, legends
  competing with the reading task, invented source summaries or metrics, and
  presenting source order as runtime order.

## Acceptance checks

1. A first-time reader can start at the entry, jump to a decision or exit, and
   inspect exact source without editing inputs or sending an implicit Host request.
2. Outline, graph selection, and evidence remain synchronized; filters and tab
   changes do not mutate graph meaning or start scenario/playback work.
3. Values, Guide handoff, branch choices, source actions, and child attachment
   still work through the existing controllers and opaque protocol identities.
4. Korean/English refresh retains selection, focus, tab, filter, and values.
5. Verify real generated Webview HTML at 390×844, 768×1024, and 1440×900;
   exercise keyboard, a dense function, long labels, light/dark themes, and
   empty/filtered states independently of compile/unit checks.
6. Opening the outline and navigating by row, Previous/Next or keyboard preserve
   graph contrast and reader zoom, including blocks taller/wider than the viewport.
   Explicit branch exclusion and reset still work independently of reading.

# Function Logic Value-Flow Playback

## User and task

Developers reading an unfamiliar function need to see how one selected lexical
value reaches later reads, updates, and sinks without mistaking static analysis
for observed runtime execution. Their primary task is to select a variable and
step through its bounded, source-backed graph route at their own pace.

## Design direction

This is a dense VS Code developer-tool surface. It preserves the editor theme,
existing graph vocabulary, and source-first language. Playback is a focused
inspection aid: a single moving value marker and one active hop clarify the
route; it never turns every node into an animated card or hides confidence.

## Information and interaction contract

- Variable chips remain the primary entry point; selecting one reveals its
  existing value-flow overlay, places its `START name = value` frame in a ready
  state, and exposes a compact Playback control strip. Selection never starts
  a pass: **Select a value → Play → token follows the real edge → value changes
  on arrival** is the ordered, visible first-use guide.
- Initial graph rendering and value selection have zero pending playback work.
  Play and Replay are the only progression actions; Pause, Previous, Next, and
  reset allow immediate interruption and deliberate review.
- The strip reports one bounded, possible-static Scenario frame in text as well
  as color. An explicit binding selection begins with `START name = value` at
  its definition, using entered Scenario input, source-derived state, or an
  explicit unknown. Derived and write frames do not create graph edges.
- Selecting a different binding, changing branch choices, or closing the view
  stops playback and returns it to the START frame.
- Empty and no-route states explain why playback is unavailable. Inferred hops
  remain dashed and are labeled as inferred.
- Values offers one explicit **Use recommended values** action. When local
  inference is available, the first click requests it and fills a checked case;
  type-only empty baselines cannot masquerade as a successful recommendation.
  Older payloads without inference retain their compatible first all-known ranked seed, otherwise the first
  partial-known seed, preserves its known source/default/literal values, and
  completes only missing or unknown values with conservative declared-type
  representatives. Same-file typed arrays receive one supported element,
  tuples retain supported positions, and complete required object shapes use
  literal-first leaves or `"sample"`, `0`, and `false`; broad unshaped arrays
  and objects remain explicit `[]`/`{}` fallbacks. It
  maps only by parameter binding identity and reports source, certainty,
  type-completed values, and remaining unavailable values. It never starts
  playback or executes source.
- Type representatives are derived from direct primitives/collections plus a
  bounded same-file TypeScript syntax pass for aliases, interfaces, readonly
  arrays, compatible unions, and object intersections. Imported or cyclic
  types stay unknown rather than being guessed.
- Required object properties are expanded to a bounded two-level representative
  shape so member-based calculations can start from type-valid JSON. Optional
  members are omitted; imported, cyclic, callable, unknown, or incomplete
  required shapes stay unavailable rather than being fabricated. Candidate
  order remains source-first and structurally deduplicated.
- Direct, safe parameter member predicates retain their typed field path. Their
  satisfying and non-satisfying boundary values are written back into a complete
  declared object representative instead of replacing the parameter with a
  scalar. Logical conditions retain each atomic field predicate, and typed
  string/array `.length` predicates produce bounded container values. When a
  parameter has no declared type, a direct safe member predicate may establish
  a bounded object shape; ambiguous untyped `.length` access stays unavailable.

## Visual and motion rules

The playback card includes a compact wrapping variable-token board. It keeps
one first-occurrence-ordered token per opaque binding/field identity, updates
it from the latest arrived `before → after` fact, and leaves future facts
pending. Complete identity/value text wraps without page overflow; only a
known arrived after value uses the semantic modified/link foreground. Locale
refresh and manual, automatic, and reduced-motion playback share these facts
without adding a scheduler.

- Reuse VS Code semantic colors: blue/link for tracked flow, yellow for sinks,
  and the existing warning/error colors only for their semantic states.
- Controls are compact, keyboard reachable, visibly focused, and grouped with
  a live status announcement.
- Motion uses bounded, distance-aware 1.4–2.8 second path travel plus a readable
  0.65–0.9 second semantic dwell. The larger labeled `name = value` token travels
  only along an already-existing lexical SVG hop; derived/write-only frames
  highlight their node without inventing a semantic edge. Mutations receive a
  one-shot orange `Δ` ring and expose `before → after` plus confidence in text.
- The token is a canvas-top foreground layer above edges and nodes. At a
  source-backed value transition, a node-anchored plaque states ordered
  `before/input → target operator expression → after/result`, confidence, and an
  explicit unknown reason where the Scenario data has one; it never invents a
  runtime value or operation.
- During an armed Play/Replay pass, translation-only camera follow keeps the
  token in the central half of the visible viewport. Pointer/trackpad pan,
  wheel or keyboard zoom, Center, and Fit immediately turn follow off for that
  pass while controls remain usable; a new ready/stopped Play pass re-arms it.
- Pointer and trackpad pan collect their final screen-space transform into one
  animation-frame paint. That flush updates only canvas/grid paint state; it
  does not relayout, refresh graph data, write toolbar copy, or message the Host.
- `prefers-reduced-motion` replaces token/camera travel with the identical
  ordered textual beats, active hop, confidence, START/Δ/sink semantics, and
  controls.
- Path length, bounded point samples, cadence, and camera safe-zone baseline
  are captured at transition start. Per-frame work only interpolates cached
  numbers and paints the foreground/canvas transform; it does not read SVG
  geometry, rebuild DOM/layout, rewrite locale/toolbar copy, persist state, or
  message the Host.
- Only the active frame and, where present, its lexical hop endpoints receive
  transient emphasis; no continuous or decorative loop is used. Reduced motion
  and forced colors retain START, `Δ`, status, and manual controls while
  suppressing traveler movement and pulse.
- All Project Analyzer-owned runtime and Webview surfaces follow the single
  `projectAnalyzer.uiLanguage` preference (`auto`, `ko`, or `en`). Explicit
  choices update open surfaces in place without changing graph or playback state.
  Once resolved, the sidebar Webview view title and owned editor-panel titles
  update immediately. The Activity Bar container, command/menu labels, Settings
  UI, and extension labels remain immutable manifest contribution chrome and
  follow VS Code's display language after reload; package-NLS supplies the
  sidebar fallback before resolution.
  Setting: `ko`/`en` override explicitly, while `auto` resolves from the VS
  Code display language (`ko`/`ko-*` is Korean; all other/missing values are
  English). The Host updates a ready card in place without playback work or a
  graph rebuild. Source identifiers and carried values remain unchanged. A
  settled transient calculation plaque is reformatted into the resolved locale
  in place; this copy-only pass never advances playback or moves the camera.

## Responsive and state requirements

- The control strip wraps in the Inspector and preserves labels at narrow
  editor widths.
- Disabled, empty, ready, paused, playing, complete, inferred, and sink states
  are visible and announced. Hidden, offscreen, disconnected, or reduced-motion
  routes arrive discretely while retaining the same token, value, and text.
- Long binding names and source labels wrap rather than force horizontal page
  scrolling.

# Function Guide

## Purpose

Function Guide is a source-backed reading mode for one selected function. It
helps a developer understand where the function fits in the codebase, what comes
in, what changes the path, what it changes or calls, and how it can finish.
Answers are assembled only from bounded static evidence: source documentation,
owner structure, existing architecture/semantic-flow indexes, direct graph
relations, and Function Logic. It is neither an AI summary nor a runtime
debugger: source is never executed and uncertainty remains visible.

## Information and interaction contract

- The graph header groups controls by **View** and **Read**, followed by a
  native **Graph key** disclosure for exact/inferred paths, choices,
  value flow/change, calls, and outcomes. **Function Guide** and **Details**
  remain mutually exclusive disclosures with `aria-expanded`; neither uses
  pressed state. Repeating the active control closes the reading panel.
- The reading panel has two exclusive modes. Inspector groups selected code,
  values/paths, and function information in three retained tabs;
  Function Guide shows **At a Glance** and five stable questions: codebase fit,
  inputs, path decisions, work/calls, and outcomes. Opening or changing a Guide
  question does not move the viewport, select a block, change graph semantics, open
  source, alter branch/value state, start playback, or calculate scenarios.
- Each answer contains a deterministic claim, source-backed facts, certainty,
  source basis, and an explicit **Show on Graph** or **Open Source** action when
  matching evidence exists. **Show on Graph** changes selection/emphasis and
  viewport only; it never replaces graph semantics.
- **Source Path Scenarios** is a lazy disclosure within the Guide. Its bounded
  interpreter starts only when opened, exposes idle/running/paused/complete
  status locally, pauses when the Guide closes, and never executes source.
  **Load Inputs & Open Values** transfers known literals only, then opens the
  editable Scenario destination in the Inspector's Values & paths tab.
- Closing the Guide clears Guide attention and scenario preview but preserves
  branch choices, value playback, manual values, per-session reading state, and
  all non-Guide graph state.

## Visual, accessibility, and responsive rules

- Reuse VS Code semantic tokens, UI/editor fonts, compact Inspector spacing, and
  the existing graph vocabulary. Do not introduce a new palette, font, card
  system, decorative motion, or a parallel attention opacity system.
- The default reading surface is one selected question at a time: overview,
  ordered question navigation, answer, three immediate facts, optional bounded
  **More Facts**, actions, then source basis. Counts are semantic, bounded, and
  explicit rather than inferred from truncated display rows.
- Use semantic headings, ordered navigation, buttons, definition lists, tables,
  and details. `aria-expanded`, `aria-controls`, visible `:focus-visible`,
  polite calculation status, forced-colors, reduced-motion, and text certainty
  are required.
- Long identifiers wrap; narrow Inspector layouts keep certainty as text badges
  beside each case/detail and use two- or three-column tables that do not create
  page-level horizontal scrolling. Guide attention uses the shared comprehension
  projection. Coarse-pointer targets are at least 44px.

## Interprocedural Scenario values

The existing Values rows remain the sole status surface. A bounded TS/JS direct
call result updates those rows using the existing calculation/unknown rendering;
localized finite boundary descriptors wrap in the existing detail treatment.
The browser only consumes opaque bundled programs and call IDs. It uses an
iterative tagged frame stack for program, expression, and call resumption, so
input edits recompute locally without source execution, Host traffic, or changes
to the graph snapshot. Payload v3 additionally marks an await boundary and
statically decided optional disposition. A bare async call stays partial; an
awaited exact local async program may contribute its bounded return value.
The evaluator never resolves names in the browser. Method/constructor and
generator support remains limited to opaque Host-proven programs, prototype-free
own data, zero-argument iterator `next`, and the shared depth/work budgets.

## Shared Scenario Workspace

Value progression retains the actual bounded evaluation order. Each mutation
shows its source statement and immediate before/after values; repeated loop
visits remain separate rows. Calls that update a shared object also update its
aliases, while earlier rows keep their original snapshots. Unsupported behavior
changes the current state to an explicit unknown with a reason. Special values
such as nested `undefined`, `NaN`, infinities and `-0` must remain distinguishable.
The existing Inspector, native variable controls, theme tokens, wrapped value
text, polite live region and playback frames remain the presentation contract.
Acceptance checks cover input edits, repeated mutations, caller/alias changes,
unknown boundaries and the rendered trace at desktop, tablet and narrow widths.

Values is the primary Scenario Workspace for the selected root function. Its
user-visible unit is one reachable **path scenario**, not merely one input seed.
The semantic four-column table shows scenario, path conditions, expected
effects/outcome, and evidence/gaps; recommended parameter inputs remain named
supporting evidence in the selected row's detail. Evaluated paths are listed
individually. When concrete evaluation is unavailable, a bounded graph planner
may enumerate source-backed condition choices and reachable effects as explicit
symbolic scenarios. It never claims concrete values for those symbolic paths.

Each path row has a sibling **Apply & Play** action after the four data columns:
it selects and previews that exact seed/path pair, then applies only its
deterministic branch edges through the existing single playback scheduler.
Function Guide may disclose the same rows, selection, and calculation state,
but never creates a second calculation or independently applies values. Status
is textual and polite: idle, calculating, paused, ready, partial, error, and
empty remain explicit static-analysis states.

Row selection and keyboard movement remain preview-only. A row action is
disabled with a textual reason until it has an evaluated path; the currently
playing, paused, or completed story is labeled in that row, prevents a second
start while active, and offers Replay after completion. The shared Flow playback
card also exposes a non-persistent native **Playback speed / 재생 속도** select:
`0.5×`, `1×` (the base cadence), `1.5×`, and `2×`. It is disabled only while
automatic progression is active. The selected multiplier divides both real-hop
remaining duration and textual-beat dwell, survives locale refresh for the card
lifetime, and has no Host or settings side effect. Reduced motion still uses
the same ordered textual beats; speed only affects their dwell cadence.

Selecting a row or path is preview-only: it may focus resolved graph evidence
without changing editable inputs, branch choices, selected graph block,
viewport, playback, or Host state. **Apply Inputs** writes only known parameter
binding identities. **Apply & Play** additionally applies only deterministic
branch choices, remembers just those previous choices for restoration, and
then starts the selected bounded story. Manual input or branch edits stop that
story and mark the workspace Custom/Modified; a later selection never silently
reapplies it.

The story begins with one scenario START beat, then follows retained evaluator
occurrence order through every bounded loop decision and visit, reachable
calculations, selected decisions, value changes, calls/effects, and the terminal
result. Every evaluated mutation remains one wrapped `variable: before → after`
semantic beat even when it has no visible hop; optional spatial travel is
suppressed for reduced motion while Play, Previous, and Next retain this exact
textual order. Evaluated transitions may add concrete before/after values;
symbolic beats retain source expressions and inferred confidence instead of
inventing values. A single foreground token travels only on a real, exact,
visible, non-dimmed lexical hop for the same binding. Cross-binding, derived,
unknown, inferred, or disconnected records use the existing discrete
calculation plaque and do not invent an edge. Values/Guide switching retains
the session but pauses work and stops motion when neither scenario surface is
active; relayout and locale refresh retain state without resuming it. Wide
tables expose four semantic columns plus an action column; narrow layouts stack
labeled cells without page-level horizontal scrolling.

For a function with two independent boolean decisions, the Workspace must make
the four reachable true/false combinations discoverable when inputs or external
state do not decide them. Selecting each row must highlight its exact branch
edges, identify the calls/effects reached on that path, and play a story that
contains those decisions and effects. A multiline Python signature must retain
its declared parameter types. Assignment expressions such as `name := value`
must appear as value changes, and helper names beginning with `bulk_delete` must
retain possible-effect styling. Unsupported concrete evaluation remains a
visible gap and must not collapse the path catalog to a misleading single row.
