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
  existing value-flow overlay, starts one bounded pass, and exposes a compact
  Playback control strip.
- Initial graph rendering never starts motion. A direct variable selection
  starts one pass; Play, Pause, Previous, Next, and Replay allow immediate
  interruption and deliberate review.
- The strip reports the current hop and its semantic outcome (read, update,
  consume, or sink) in text as well as color.
- Selecting a different binding, changing branch choices, or closing the view
  stops playback and returns it to the first available hop.
- Empty and no-route states explain why playback is unavailable. Inferred hops
  remain dashed and are labeled as inferred.

## Visual and motion rules

- Reuse VS Code semantic colors: blue/link for tracked flow, yellow for sinks,
  and the existing warning/error colors only for their semantic states.
- Controls are compact, keyboard reachable, visibly focused, and grouped with
  a live status announcement.
- Motion is 220 ms per hop with an ease-out curve. The graph marker travels
  along the currently active SVG hop; the already-existing route remains
  visible for spatial context.
- `prefers-reduced-motion` replaces travel with an immediate active-hop state.
- Only the active hop and its two endpoint nodes receive transient emphasis;
  no continuous or decorative loop is used.

## Responsive and state requirements

- The control strip wraps in the Inspector and preserves labels at narrow
  editor widths.
- Disabled, empty, paused, playing, complete, inferred, and sink states are
  visible and announced.
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

- The graph header uses the explicit **Function Guide** disclosure control with
  `aria-expanded`; it is not a fifth graph lens and never uses pressed state.
- Opening the Guide does not move the viewport, open source, alter branch/value
  state, start playback, or calculate scenarios. It presents **At a Glance** and
  five stable questions: codebase fit, inputs, path decisions, work/calls, and
  outcomes.
- Each answer contains a deterministic claim, source-backed facts, certainty,
  source basis, and an explicit **Show on Graph** or **Open Source** action when
  matching evidence exists. Only those explicit actions may change the graph
  lens, selection, or viewport.
- **Static Input Cases** is a lazy disclosure within the Guide. Its bounded
  interpreter starts only when opened, reports pending/error state locally, and
  calls **Load Inputs into Values** only for known literals.
- Closing the Guide clears Guide attention but preserves branch choices, value
  playback, manual values, Inspector scroll, and all non-Guide graph state.

## Visual, accessibility, and responsive rules

- Reuse VS Code semantic tokens, UI/editor fonts, compact Inspector spacing, and
  the existing graph vocabulary. Do not introduce a new palette, font, card
  system, decorative motion, or a parallel attention opacity system.
- The default reading surface is one selected question at a time: overview,
  ordered question navigation, answer, facts, actions, then source basis.
  Counts and omitted items remain bounded and explicit.
- Use semantic headings, ordered navigation, buttons, definition lists, tables,
  and details. `aria-expanded`, `aria-controls`, visible `:focus-visible`,
  polite calculation status, forced-colors, reduced-motion, and text certainty
  are required.
- Long identifiers wrap; narrow Inspector layouts stack relation chains and move
  scenario certainty into row details instead of creating page-level horizontal
  scrolling. Guide attention uses the shared comprehension projection.
