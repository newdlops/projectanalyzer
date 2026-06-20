# Project Analyzer

Project Analyzer is a VS Code extension for exploring static project structure through file, class, function, and call relationship graphs.

## Development

```sh
npm install
npm run compile
```

Open the repository in VS Code and run `Run Project Analyzer Extension` from the Run and Debug view. The extension contributes a Project Analyzer Activity Bar container with a sidebar Structure Explorer Webview. The current scaffold provides a GUI shell, TypeScript/JavaScript symbol extraction, and module boundaries for analyzer, graph, protocol, storage, VS Code adapters, and shared types.

## Sidebar Actions

- Analyze Workspace
- Analyze Current File
- Switch Files, Calls, and Classes views
- Open selected source
- Show selected callers or callees
- Export JSON graph
- Clear cached graph
- Cancel analysis request
