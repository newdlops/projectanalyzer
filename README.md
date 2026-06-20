# Project Analyzer

Project Analyzer is a VS Code extension for exploring static project structure through file, class, function, and call relationship graphs.

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

## Sidebar Actions

- Analyze Workspace
- Analyze Current File
- Switch Files, Calls, and Classes views
- Open selected source
- Show selected callers or callees
- Export JSON graph
- Clear cached graph
- Cancel analysis request
