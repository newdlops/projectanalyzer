# Changelog

All notable user-visible changes to Project Analyzer: Code Flow are recorded in
this file. The changelog starts with the first distribution-documented build;
earlier local development builds were not tracked here.

## 0.0.1033 - 2026-07-20

### Added

- A 256×256 Marketplace icon derived from the Code Flow Activity Bar mark, plus
  dark gallery-banner metadata and search keywords.
- F#, OCaml, and Elixir `|>` pipeline visualization with language-correct
  argument insertion, exact stage ranges, and same-canvas child-function drill.
- A first-run installation path, supported-language summary, local-data policy,
  troubleshooting guidance, support template, and maintainer release checklist.

### Changed

- Functional pipeline languages now participate in workspace analysis, editor
  context selection, Function Logic visualization, and project graph expansion.
- Release packaging now treats the icon, README, changelog, and support document
  as required distribution artifacts.

### Analysis boundaries

- Haskell composition, monadic bind, computation expressions, macros, and
  higher-order callback execution are not presented as exact pipe-forward flow.
- Static graph confidence remains visible as `exact`, `resolved`, `inferred`, or
  `unresolved`; the visualizer does not claim to show an observed runtime trace.
