# Project Analyzer

Project Analyzer is a VS Code extension for answering where backend requests or GraphQL operations enter a project, which source handler receives them, what the handler calls next, and how confidently each mapping was resolved.

## Request Flows

The sidebar opens on **Request Flows**. Workspace analysis normalizes HTTP route-to-handler entrypoints for Django, FastAPI, Express, and NestJS, and code-first GraphQL root operations for NestJS GraphQL and Strawberry. Large workspaces start with collapsed framework summaries instead of rendering every entrypoint at once.

```text
GET /users/:id
  -> UsersController.findOne
    -> UserService.loadUser
      -> UserRepository.findById
```

Mappings retain exact/resolved/inferred/unresolved confidence and source evidence. Expanding an HTTP route or GraphQL operation shows a downstream tree built only from analyzed `calls` edges and bounded by default to depth 3 and 25 steps. Cycles, duplicate targets, depth limits, and step limits are handled without recursive traversal. Named JavaScript/TypeScript imports and Python `from` imports are connected across files only when the binding and top-level callable are unique and unshadowed. Other unresolved targets and limit omissions remain visible as diagnostics instead of being silently removed. The pure public API is `createSemanticFlowIndex(ProjectGraph, { maxDepth, maxSteps })` in `src/insights/semanticFlow`.

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

The summary-first projection limits initial row and DOM volume. The analyzer scan and semantic-flow index are still created when a graph is loaded; true chunked analysis and server-side pagination remain scaling work.

## Development

```sh
npm install
npm run engine:build
npm run compile
```

Open the repository in VS Code and run `Run Project Analyzer Extension` from the Run and Debug view. The extension contributes a Project Analyzer Activity Bar container with a sidebar Structure Explorer Webview. The current scaffold uses a Rust analyzer engine for workspace/current-file analysis, with a TypeScript fallback for development failures.

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
- Explore collapsed HTTP route and GraphQL operation summaries, mapped handlers, and bounded downstream calls
- Select a function to see affected request routes and GraphQL operations
- Open mapped handler and concrete callee source
- Export JSON graph
- Clear cached graph
