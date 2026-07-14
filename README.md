# Project Analyzer

Project Analyzer is a VS Code extension evolving from a code explorer into an evidence-based **Project Learning Journey**. The current slice guides three source-orientation actions; its target roadmap extends from context and architecture to dependencies, safe change, operations, and hands-on proof. Static analysis supplies navigable evidence, but opening a graph is never treated as understanding the system.

## Project Learning Journey

The target product roadmap orders eight learning stages. Cumulative progression and stage gates are not enforced by the current slice:

1. **Context** — understand why the project exists, its scope, and its vocabulary.
2. **Architecture** — identify system boundaries, entrypoints, and major components.
3. **Critical Flows** — trace a representative request or job through concrete source.
4. **Data & Dependencies** — find state reads and writes plus internal and external dependencies.
5. **Quality & Change** — locate behavioral checks and reason about change impact.
6. **Operations & Failure** — learn observability, failure diagnosis, and recovery paths.
7. **Hands-on Proof** — demonstrate understanding through a small real task and its result.
8. **Continuous Refresh** — revisit evidence as code and operational knowledge change.

The target design applies the same learning contract to every stage. The current UI applies it as read-only guidance for the next orientation action:

```text
Why -> Learn -> Inspect evidence -> Do -> Explain back -> Exit criteria
```

Evidence and progress are kept separate. `Discovered` is a fact found directly in source or configuration; `Inferred` is an analyzer interpretation that still needs checking. `Confirmed` requires a person to validate context or meaning, while `Demonstrated` requires an observable execution, test, debugging session, or change result. The curriculum reserves `Unknown` for missing evidence; the current slice lists the evidence each stage still needs rather than automatically classifying every project gap. The extension does not promote an automatic finding or a visited screen into human confirmation or demonstrated ability.

The current vertical slice shows the full roadmap but tracks only whether the user has visited three concrete investigation actions:

- **Map project** by opening a scope detail.
- **Trace one representative request** by disclosing a source-backed path.
- **Verify in source** by requesting an editor open for a concrete path step.

Visited progress is navigation history, not a claim that the codebase is mastered or that onboarding is complete. The current action card presents the next orientation action's explanation, evidence to inspect, explain-back prompt, and exit criterion as read-only guidance. Capturing and reviewing the learner's answers, human confirmation, and executable proof remain subsequent slices.

## Current Evidence Slice: Project Map and Reading Guide

Below the Learning Journey card, the current evidence slice starts with a bounded **Project Map**, not a function list or analyzer dashboard. It merges framework evidence and HTTP/GraphQL execution counters by normalized `rootPath`, so NestJS HTTP routes plus GraphQL Query, Mutation, and Subscription operations in the same application appear on one scope card. The initial analyzer payload and Project Map contain at most three scope summaries and no individual function, call edge, diagnostic, or reading-path rows.

Selecting a scope lazily requests its second-stage reading guide from the Extension Host. That detail is capped at five measured source areas and three representative mapped HTTP/GraphQL paths, with at most three representative file labels per area and five source steps per path. File labels and step locations use workspace-relative paths; sources outside the workspace are reduced to filename-only safe abbreviations. Concrete steps show definition locations and open source through snapshot-local opaque tokens. Unresolved/external call steps label edge-local positions as call sites, while non-call framework mapping positions remain source evidence; neither becomes a source-navigation button. Representative area files remain non-interactive. Representative means a deterministic, source-backed example across transport types; it is not a claim that a function or business domain is the most important part of the project.

**Analysis Details** is closed by default. Opening it reveals the existing three factual analysis lines and at most three evidence-backed gap signals. These signals retain exact candidate and affected counts and describe analysis limitations or unresolved mappings, not runtime, security, or performance defects.

The Extension Host caches the semantic-flow index and Reading Guide projector for one immutable graph snapshot. Initial graph publication sends a constant-size graph shell plus the bounded Project Map; it does not send file/import rows, raw framework-unit/evidence rows, overview signals, or Function Index rows. **Browse Structure**, **Analysis Details**, and **Explore Code Flows** each request their data only when first opened. A Webview-only snapshot token, separate from the analyzer schema version, rejects late responses from an older analysis.

The Project Map and Reading Guide provide analyzer evidence for the first learning actions; they do not by themselves confirm project purpose, ownership, production behavior, or user comprehension. The roadmap keeps unsupported context outside automatic claims and states which source, documentation, execution, or team evidence is still needed.

## Request Flows

**Explore Code Flows** is closed by default. Opening it lazily requests the Function Index and shows bounded flow summaries. Its search box queries the complete concrete callable set by function name, qualified name, or source path; an empty query browses all concrete functions. Results arrive in 50-row cursor pages and open source directly through snapshot-local opaque tokens, so finding a function does not require transferring the full inventory or path-bearing analyzer IDs to the Webview. Search responses also echo a browser request identity, preventing a late response from an earlier same-text request from replacing current results. Workspace analysis normalizes HTTP route-to-handler entrypoints for Django, FastAPI, Express, and NestJS, and code-first GraphQL root operations for NestJS GraphQL and Strawberry. Large workspaces start with collapsed framework summaries instead of rendering every entrypoint at once.

```text
GET /users/:id
  -> UsersController.findOne
    -> UserService.loadUser
      -> UserRepository.findById
```

Mappings retain exact/resolved/inferred/unresolved confidence and source evidence. Expanding an HTTP route or GraphQL operation shows a downstream tree built only from analyzed `calls` edges and bounded by default to depth 3 and 25 steps. Cycles, duplicate targets, depth limits, and step limits are handled without recursive traversal. Named JavaScript/TypeScript imports and Python `from` imports are connected across files only when the binding and top-level callable are unique and unshadowed. Other unresolved targets and limit omissions remain visible as diagnostics instead of being silently removed. The pure public API is `createSemanticFlowIndex(ProjectGraph, { maxDepth, maxSteps })` in `src/insights/semanticFlow`.

Function hotspots count distinct caller and callee identities. Repeated call sites between the same pair remain available as edge evidence but do not by themselves make a function look broadly shared or high-impact.

Select a concrete function in the Function Explorer to show **Affected Request Flows** above the request tree. Impact analysis follows incoming `calls` edges with cycle, depth, and step guards and reports the route mapping plus call-path confidence.

## GraphQL Operations

GraphQL is modeled by its executable root operations rather than by the shared HTTP `/graphql` transport endpoint:

```text
GraphQL
  Query
    viewer -> ViewerResolver.viewer -> UserService.loadViewer
  Mutation
    updateProfile -> ProfileResolver.updateProfile
  Subscription
    profileChanged -> ProfileResolver.profileChanged
```

Expanding GraphQL first reveals `Query`, `Mutation`, and `Subscription` counts, with a `rootPath` scope first when a monorepo has multiple GraphQL roots. Operation rows are created only after their type bucket is expanded; expanding an operation then reveals its concrete resolver and bounded downstream calls.

The first code-first adapter recognizes NestJS-style `@Resolver` classes with `@Query`, `@Mutation`, and `@Subscription` methods, plus conventional Strawberry root types. Nested `@ResolveField` methods and ordinary object fields are not promoted to root entrypoints. SDL/schema-first mappings, inline Apollo/Yoga resolver objects, Graphene fields, federation metadata, and dynamic registration are not yet split into operation flows. Nested selection-set dispatch to field resolvers is also outside the current flow model.

The summary-first projection limits initial row, DOM, and Webview transfer volume. The analyzer scan and full host-side graph are still created in the Extension Host when a graph is loaded; opening Structure currently transfers its projected file/import graph as one lazy payload. Function search is cursor-backed, but each page still scans and sorts host-side matches, and section refreshes still return a capped row projection. True chunked analysis, source streaming, indexed query acceleration, and general section/inventory pagination remain scaling work.

## Current Accuracy and Scaling Limits

The Rust engine is a lightweight syntax analyzer, not a compiler frontend. JavaScript and TypeScript extraction still uses textual/line-oriented heuristics and does not use an AST, lexical scope graph, or receiver/type resolution. Python now uses a stateful, offset-preserving scanner to mask comments and single-, double-, and triple-quoted strings before symbol, call, import, binding, and shadow analysis; declaration keywords are boundary-checked. This removes known string/docstring and keyword-prefix false positives, but it is still not a Python AST or full semantic resolver. Published symbol, call, import, route, and GraphQL operation ranges convert scanner byte offsets to VS Code UTF-16 columns, including non-ASCII source.

For ordinary JavaScript/TypeScript and Python calls, same-file lexical or qualified-name matches are reported as `resolved`, while file-wide unique-name fallback is `inferred`. Direct parameters and simple local bindings block bare-name resolution so `run(helper) { helper() }` is not linked to an unrelated top-level `helper`; unsupported binding forms remain conservative. This confidence is deliberately weaker than parser- and type-backed proof. Dynamic dispatch, computed properties, runtime registration, ambiguous imports, and unsupported syntax can remain unresolved or be missed.

The source manifest and analyzer still materialize source input and the complete graph in the Extension Host. Bounded rows and cached projections reduce browser work but do not yet make analysis memory proportional to the visible subgraph. AST/type-backed resolution (starting with JavaScript/TypeScript), cursor-backed section/inventory paging, and streaming/chunked analysis are the main remaining foundations for a compiler-grade large-repository analyzer.

## Design Basis

The learning journey synthesizes public engineering guidance rather than claiming to reproduce an internal company process. Its sequential, outcome-oriented curriculum and hands-on checks are informed by Google SRE's [Accelerating SREs to On-Call and Beyond](https://sre.google/sre-book/accelerating-sre-on-call/). Quality and operations stages draw on the systematic concerns in Google's [Production Readiness Review](https://sre.google/sre-book/evolving-sre-engagement-model/). Its emphasis on explainable context, maintained evidence, tutorials, and explicit knowledge gaps is informed by the Software Engineering at Google chapters on [Knowledge Sharing](https://abseil.io/resources/swe-book/html/ch03.html) and [Documentation](https://abseil.io/resources/swe-book/html/ch10.html).

## Development

```sh
npm install
npm run engine:build
npm run compile
```

Open the repository in VS Code and run `Run Project Analyzer Extension` from the Run and Debug view. The extension contributes a Project Analyzer Activity Bar container with a Project Learning Journey sidebar. The current scaffold uses a Rust analyzer engine for workspace/current-file analysis, with a TypeScript fallback for development failures.

## Rust Engine

```sh
npm run engine:test
npm run engine:build
```

The Rust engine lives in `engine/analyzer` and emits ProjectGraph JSON for the extension host.

## Packaging

```sh
npm run package:vsix
```

Packaging builds one target-specific native engine, excludes Cargo build artifacts, and rejects VSIX files above the configured size budget.

## Sidebar Actions

- Analyze Workspace
- Analyze Current File
- Review the full Project Learning Journey roadmap without treating it as a completion score
- Track visited progress for Map project, Trace one representative request, and a Verify in source request
- Review at most three normalized project scopes without loading function rows
- Select a scope to load bounded source areas and representative reading paths
- Open Analysis Details for the three-line Project Brief and evidence-backed signals
- Open Explore Code Flows to lazily load HTTP/GraphQL summaries and bounded downstream calls
- Search every concrete callable by function name or source path and open a result directly
- Select a function to see affected request routes and GraphQL operations
- Open mapped handler and concrete callee source
- Export JSON graph
- Clear cached graph
