# Function renderer performance implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this bounded bugfix in the current session. Steps use checkbox syntax for tracking.

**Goal:** Stop idle Function Guide rendering and release graph-owned resources while reusing unchanged scenario calculations.

**Architecture:** Preserve the existing native DOM, VS Code theme tokens, typed messages, and interpreter. Retain the Guide disclosure node, balance its shared workspace ownership, and dispose all graph consumers. Keep scenario calculations in a renderer-local cache whose inputs include editable values and branch reachability.

**Tech stack:** TypeScript, generated CSP-compatible browser JavaScript, Node test runner.

**Spec:** `AGENTS.md`, `DESIGN.md` (Function Guide and Shared Scenario Workspace), `SPEC.MD`.

## Global constraints

- Preserve graph geometry, labels, opaque identities, explicit playback, and source navigation.
- No dependency additions, source execution, Host messages for presentation, or visual redesign.
- Keep shared Guide/Values results available across same-root relayout; expire obsolete roots and subscriptions.
- Use iterative bounded processing and keep implementation files below 800 lines.
- Verify actual browser rendering separately from compile and unit checks.

## Evidence and acceptance

Chrome reproduced 1,150 scenario renders and 1,149 workspace acquisitions within 0.29 seconds after one native disclosure click. `renderScenarios()` replaces an open `<details>`, whose queued `toggle` reacquires the workspace and replaces it again. The graph's disposal also omits the Guide unsubscribe, and trace/playback readers rerun the scenario evaluator for unchanged inputs.

- An opened disclosure settles without additional renders or workspace acquisitions.
- Opening/closing, switching Guide/Values, localization, and keyboard row selection preserve usable state.
- Old graph consumers receive no notifications after disposal; new roots retain no previous workspace payloads.
- Repeated playback reads reuse a calculation; input/branch changes produce fresh results.

## Review focus

- Native queued disclosure events must not restart rendering after localization or disposal.
- Repeated Inspector state updates must not acquire or release another surface's consumer.
- Attached-function relayout must preserve shared scenario results without retaining old DOM subscribers.
- Branch reachability and manual input edits must invalidate cached frames.
- Localization must refresh frame text without losing inputs, graph selection, or playback state.

### Task 1: Stabilize Guide disclosure and ownership

**Files:** `src/webview/codeFlow/tutor/functionTutorGuideBrowserSource.ts`; new generated-browser regression tests under `src/test/unit/`.

**Interfaces:** Preserve `createFunctionTutorPanel(logic, callbacks)` and its `setActive`, `refreshLanguage`, `dispose` surface.

- [x] Write behavior tests for queued toggles, balanced workspace ownership, and disposal; run them and observe the defects.
- [x] Retain the scenario `<details>` and summary; replace only its body. Guard unchanged native toggles and acquire/release once while active/open. Invalidate fallback work on disposal.
- [x] Verify tests plus Guide localization/Scenario Workspace regressions.

### Task 2: Release graph resources and bound root lifetime

**Files:** `src/webview/codeFlow/functionLogicBrowserSource.ts`, `src/webview/codeFlow/scenarioWorkspace/functionLogicScenarioWorkspaceBrowserSource.ts`, explicit root/reset hooks in Function Visualizer and sidebar, associated renderer tests.

**Interfaces:** Graph `dispose()` disposes its Guide. Workspace acquisition retains only the active root's fingerprint session; graph relayout reuses it.

- [x] Write a real generated-renderer test that rebuilds a root and verifies only the current Guide is notified; verify failure.
- [x] Dispose Guide subscriptions before Values teardown and expire previous-root workspace entries while preserving same-root cached results.
- [x] Verify root replacement, relayout, and navigation tests.

### Task 3: Reuse scenario evaluation for trace and playback

**Files:** `src/webview/codeFlow/valuePreview/functionLogicScenarioTraceBrowserSource.ts`, associated scenario tests.

**Interfaces:** Preserve trace `refresh()`, `setSelectedBinding()`, and `readFrames(bindingId)`; cache remains renderer-local and bounded.

- [x] Write tests counting real evaluations for repeated frame reads and checking fresh values after input, branch, and language changes; observe repeated evaluation failures.
- [x] Cache the projected calculation and selected binding's frames against editable input/reachability/language state. Release with the renderer.
- [x] Verify frame values, unknown boundaries, repeated occurrences, and playback regressions.

### Task 4: Verify and document

- [x] Run `npm test` and typecheck; inspect the diff for scope, lifecycle, and module boundaries.
- [x] Recheck the native disclosure reproduction in Chrome and inspect generated Webview at 390×844, 768×1024, and 1440×900.
- [x] Document renderer resource lifetime in `SPEC.MD` and record measured results and any unavailable checks.

## Verification results

- Chrome native disclosure reproduction: before, 1,150 renders / 1,149 workspace acquisitions in 0.29 seconds; after, 2 renders (including initial mount) / 1 acquisition, unchanged after 2 seconds. Both use the production Guide/workspace browser-source generators with empty seeds, not a rewritten UI.
- Real interpreter regression fixture: 100 repeated frame reads, trace selection, and refresh previously performed 103 evaluations; the retained renderer now performs 1. Input edits and block/edge reachability edits invalidate the calculation; locale changes reformat frames without reevaluation.
- Final focused browser/runtime suites: 85/85 passed, including 13 added regression cases for native queued toggles, independent ownership, cleanup, explicit reset, reuse, and invalidation.
- `npm run check` and `npm run compile`: passed after the final CSS adjustment. `git diff --check`: passed.
- `npm test`: Rust 82/82 passed; unit tests 755/759 passed. The four unit failures also reproduce against the compiled prechange baseline: `Function Guide type baseline bypasses unknown dynamic callsite arguments`; `Function Guide builds nested object input representatives from declared fields`; `projects and evaluates advanced private Scenario calls from TS and JS roots without graph method edges`; `source-backed graph uses explicit Inspector actions for decorated editor reveal`. Their source semantics/architecture guard are outside this performance change.
- Because the aggregate command stops at unit failures, `npm run test:package` was run separately: 12/12 passed.
- One fresh read-only reviewer found no blocking issues. The minor finding that previous results survived a definitive new-root request while loading was reproduced with two failing tests and fixed in explicit session/reset hooks; the follow-up review reported no remaining issues.

## Visual and interaction QA

The in-app browser provider was unavailable. Chrome reproduced and verified the native disclosure issue. Safari inspected the production Function Visualizer HTML in real iframe viewports of 390×844, 768×1024, and 1440×900. The fixture uses production source analysis, Tutor planning, opaque projection, HTML/CSS, and browser JavaScript; only the VS Code transport and theme variables are supplied locally. These are CSS viewports in a desktop browser, not mobile-device emulation or an installed VS Code Webview.

Checked Guide activation, disclosure opening, scenario click selection, keyboard ArrowUp selection, retained English→Korean localization, input handoff to Values, root loading, failure presentation, and recovery by loading the root again. After retiring the graph, the browser fixture reported 0 workspace entries and 0 registered preview labels. Mobile and tablet tables wrap long copy without page overflow. The narrow Guide caption originally retained a table-caption box after the table became block layout, collapsing its title to one character per line; including the caption in the existing responsive block rule fixed it, verified in English and Korean. No design-system changes were introduced.

Installed-extension CPU percentages and heap/RSS were not measured. The measured evidence is native render/acquisition counts, interpreter counts, resource-lifecycle tests, and real-browser presentation. No extension release or installation was requested.
