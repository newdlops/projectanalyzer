# Changelog

All notable user-visible changes to Project Analyzer: Code Flow are recorded in
this file. The changelog starts with the first distribution-documented build;
earlier local development builds were not tracked here.

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
