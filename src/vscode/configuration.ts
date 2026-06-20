/**
 * VS Code configuration adapter. The rest of the extension reads a typed config
 * object instead of reaching into the VS Code API directly.
 */

import * as vscode from "vscode";

/** Runtime settings consumed by analyzer, graph, and Webview modules. */
export type ProjectAnalyzerConfig = {
  enabled: boolean;
  autoAnalyze: boolean;
  include: string[];
  exclude: string[];
  maxFileSizeKb: number;
  maxRenderedNodes: number;
  defaultDepth: number;
  includeExternalDependencies: boolean;
  showUnresolvedEdges: boolean;
  cache: {
    enabled: boolean;
    maxSizeMb: number;
  };
};

/**
 * Reads the current Project Analyzer settings from VS Code.
 */
export function readProjectAnalyzerConfig(): ProjectAnalyzerConfig {
  const config = vscode.workspace.getConfiguration("projectAnalyzer");

  return {
    enabled: config.get("enabled", true),
    autoAnalyze: config.get("autoAnalyze", true),
    include: config.get("include", ["**/*.{ts,tsx,js,jsx,py}"]),
    exclude: config.get("exclude", [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.venv/**",
      "**/venv/**"
    ]),
    maxFileSizeKb: config.get("maxFileSizeKb", 1024),
    maxRenderedNodes: config.get("maxRenderedNodes", 500),
    defaultDepth: config.get("defaultDepth", 2),
    includeExternalDependencies: config.get("includeExternalDependencies", false),
    showUnresolvedEdges: config.get("showUnresolvedEdges", true),
    cache: {
      enabled: config.get("cache.enabled", true),
      maxSizeMb: config.get("cache.maxSizeMb", 256)
    }
  };
}
