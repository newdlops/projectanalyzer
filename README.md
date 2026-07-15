# Project Analyzer

Project Analyzer is a VS Code extension centered on an evidence-backed **Project Guided Tour**. Instead of showing a generic onboarding simulation or asking the reader to choose a scope first, its POC automatically selects one analyzed HTTP/GraphQL path and teaches it one concrete function at a time. The existing Project Reading Plan and complete investigation tools remain available in Explore. Static analysis supplies navigable evidence, but opening source is never treated as understanding the system.

## Project Guided Tour POC

After analysis, the default Guide surface shows one mission and one current source stop. Each stop explains why it appears now, what to look for in the function, a question to answer, its architectural-layer evidence, and what the reader should be able to explain before moving on. Only an Extension Host acknowledgment after VS Code opens the exact snapshot-bound source token reveals `Next stop`; a click, stale response, or failed open does not count as a visit.

The first POC intentionally promotes only concrete function definitions. Incoming callsite/decorator range navigation, multiple required anchors, related-test verification, persisted progress, non-HTTP execution surfaces, and true multi-root support remain follow-up work. If analysis cannot produce a concrete mission, Guide explains the evidence gap and offers an explicit transition to Explore rather than choosing an arbitrary file.

## Project Reading Plan and Learning Method

The optional learning roadmap orders eight stages. Cumulative progression and stage gates are not enforced by the current slice:

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

Explore keeps this earlier method in a collapsed disclosure and tracks only whether the user has visited three concrete investigation actions:

- **Map project** by opening a scope detail.
- **Trace one recommended request** by disclosing a source-backed path.
- **Verify in source** by requesting an editor open for a concrete path step.

Visited progress is navigation history, not a claim that the codebase is mastered or that onboarding is complete. The current action card presents the next orientation action's explanation, evidence to inspect, explain-back prompt, and exit criterion as read-only guidance. Capturing and reviewing the learner's answers, human confirmation, and executable proof remain subsequent slices.

## Explore Evidence: Project Map, Layers, and Recommended Entrypoints

The Explore surface preserves the bounded **Project Reading Plan** behind the default Guided Tour. It merges framework evidence and HTTP/GraphQL execution counters by normalized `rootPath`, so NestJS HTTP routes plus GraphQL Query, Mutation, and Subscription operations in the same application appear on one scope card. Its initial payload contains at most three scope summaries and no individual function, call edge, diagnostic, or alternative reading-path rows.

Selecting a scope lazily requests its second-stage plan from the Extension Host. Recommended entrypoints appear before source areas. The detail is capped at five measured source areas and three mapped HTTP/GraphQL learning paths, with at most three file labels per area and five source steps per path. File labels and step locations use workspace-relative paths; sources outside the workspace are reduced to filename-only safe abbreviations. Concrete steps show definition locations and open source through snapshot-local opaque tokens. Unresolved/external call steps label edge-local positions as call sites, while non-call framework mapping positions remain source evidence; neither becomes a source-navigation button. Area files remain non-interactive.

Path selection is educational evidence ranking, not business criticality. It prefers a reachable domain-rule candidate, then an application-workflow candidate. When neither intrinsic candidate exists, a concrete local function strictly between the mapped handler and an explicit repository, model, or side-effect boundary can become a low-confidence **Workflow bridge candidate**. This topology hint keeps the function's layer `Unclassified` and does not prove business ownership or purity; unresolved calls, observed terminals, and generic non-local/external calls are not effect evidence and cannot create the hint. Remaining paths rank mapped traces before unresolved and traversal-limited traces, followed by stronger layer evidence, fewer unresolved calls, shorter distance, and stable identity.

Each expanded path shows a concrete ribbon such as `Entry → Interface → Application/Domain candidate → Data access/Infrastructure` or `Entry → Interface → Unclassified workflow bridge → Data access/effect boundary`, explains why it was recommended, highlights a `START HERE` function, and lists what remains unknown. Traversal limits prevent a false conclusion that no deeper business layer exists.

Callable architecture is a separate graph-wide insight shared by the Reading Plan, request-flow rows, and complete function search. Its structural vocabulary is `Interface`, `Application`, `Domain`, `Data access`, `Infrastructure`, `Cross-cutting`, `Test`, and `Unclassified`. Anchored source structures such as `domain/`, `application/`, `persistence/`, `adapters/in`, and `adapters/out` can provide evidence. Existing framework semantics provide additional evidence: for example, a detected service is only an **Application workflow candidate**, never automatic Domain logic. Conflicting strong evidence stays `Unclassified` with alternatives, test source wins over production-looking labels, and generic names or folders such as `services`, `auth`, `core`, and `utils` do not decide a layer. Purity is always shown as unverified because the analyzer cannot prove absence of I/O, global state, dynamic dispatch, or hidden side effects.

**Analysis Details** is closed by default. Opening it reveals the existing three factual analysis lines and at most three evidence-backed gap signals. These signals retain exact candidate and affected counts and describe analysis limitations or unresolved mappings, not runtime, security, or performance defects.

The Extension Host caches the semantic-flow index, callable architecture index, and Reading Plan projector for one immutable graph snapshot. Initial graph publication sends a constant-size graph shell plus the bounded Project Map; it does not send file/import rows, raw framework-unit/evidence rows, overview signals, or Function Index rows. **Browse Structure**, **Analysis Details**, and **Explore Code Flows** each request their data only when first opened. A Webview-only snapshot token, separate from the analyzer schema version, rejects late responses from an older analysis.

The Project Map and Reading Plan provide analyzer evidence for the first learning actions; they do not by themselves confirm project purpose, ownership, production behavior, runtime importance, purity, or user comprehension. The roadmap keeps unsupported context outside automatic claims and states which source, documentation, execution, or team evidence is still needed.

## Request Flows

**Explore Code Flows** is closed by default. Opening it lazily requests the Function Index and shows bounded flow summaries with the same architecture assessment used by the Reading Plan. Its search box queries the complete concrete callable set by function name, qualified name, or source path; an empty query browses all concrete functions and places supported Domain/Application candidates ahead of unclassified callables. Results arrive in 50-row cursor pages and open source directly through snapshot-local opaque tokens, so finding a function does not require transferring the full inventory or path-bearing analyzer IDs to the Webview. Search responses also echo a browser request identity, preventing a late response from an earlier same-text request from replacing current results. Workspace analysis normalizes HTTP route-to-handler entrypoints for Django, FastAPI, Express, and NestJS, and code-first GraphQL root operations for NestJS GraphQL and Strawberry. Large workspaces start with collapsed framework summaries instead of rendering every entrypoint at once.

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

Open the repository in VS Code and run `Run Project Analyzer Extension` from the Run and Debug view. The extension contributes a Project Analyzer Activity Bar container with Guide and Explore surfaces. The current scaffold uses a Rust analyzer engine for workspace/current-file analysis, with a TypeScript fallback for development failures.

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
- Follow one automatically selected mission and one current definition stop at a time
- Open the current function and wait for source-open acknowledgment before moving to the next stop
- Use `Why now`, `Look for`, the question, layer evidence, unknowns, and `Move on when` as a source-reading checklist
- Switch to Explore without losing the existing Project Reading Plan and detailed investigation tools
- Review the optional learning-method roadmap without treating it as a completion score
- Review at most three normalized project scopes in Explore without loading function rows
- Select a scope to load evidence-ranked entrypoints before bounded source areas
- Review Entry, Interface, Application, Domain, Data access, Infrastructure, Cross-cutting, Test, or Unclassified evidence per function
- Open the recommended `START HERE` function while keeping purity and runtime importance unverified
- Treat a low-confidence Workflow bridge as a reading hint, never as an inferred layer or proven business owner
- Open Analysis Details for the three-line Project Brief and evidence-backed signals
- Open Explore Code Flows to lazily load HTTP/GraphQL summaries and bounded downstream calls
- Search every concrete callable by function name or source path and open a result directly
- Select a function to see affected request routes and GraphQL operations
- Open mapped handler and concrete callee source
- Export JSON graph
- Clear cached graph
