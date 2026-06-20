# Project Analyzer

Project Analyzer is a VS Code extension for exploring static project structure through file, class, function, and call relationship graphs.

## Development

```sh
npm install
npm run compile
```

Open the repository in VS Code and run `Run Project Analyzer Extension` from the Run and Debug view. The current scaffold provides the extension manifest, command registration, a Webview shell, and core module boundaries for analyzer, graph, protocol, storage, VS Code adapters, and shared types.

## Commands

- `Project Analyzer: Open Explorer`
- `Project Analyzer: Analyze Workspace`
- `Project Analyzer: Analyze Current File`
- `Project Analyzer: Show Call Graph`
- `Project Analyzer: Show File Graph`
- `Project Analyzer: Show Class Graph`
- `Project Analyzer: Find Callers`
- `Project Analyzer: Find Callees`
- `Project Analyzer: Export Graph`
- `Project Analyzer: Clear Cache`
- `Project Analyzer: Cancel Analysis`
