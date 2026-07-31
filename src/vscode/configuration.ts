/**
 * VS Code configuration adapter. The rest of the extension reads a typed config
 * object instead of reaching into the VS Code API directly.
 */

import * as vscode from "vscode";
import {
  resolveUiLanguage,
  type UiLanguage,
  type UiLanguagePreference
} from "../localization/uiLanguage";

/** Runtime settings consumed by analyzer, graph, and Webview modules. */
export type ProjectAnalyzerConfig = {
  uiLanguage: UiLanguage;
  enabled: boolean;
  autoAnalyze: boolean;
  include: string[];
  exclude: string[];
  maxFileSizeKb: number;
  maxRenderedNodes: number;
  defaultDepth: number;
  codeFlow?: {
    maxDepth: number;
    maxSteps: number;
    maxLogicBlocks: number;
  };
  includeExternalDependencies: boolean;
  showUnresolvedEdges: boolean;
  cache: {
    enabled: boolean;
    maxSizeMb: number;
  };
};

export { resolveUiLanguage, type UiLanguage } from "../localization/uiLanguage";

/**
 * Reads the current Project Analyzer settings from VS Code.
 */
export function readProjectAnalyzerConfig(): ProjectAnalyzerConfig {
  const config = vscode.workspace.getConfiguration("projectAnalyzer");

  return {
    uiLanguage: resolveUiLanguage(
      config.get<UiLanguagePreference | unknown>("uiLanguage", "auto"),
      vscode.env.language
    ),
    enabled: config.get("enabled", true),
    autoAnalyze: config.get("autoAnalyze", true),
    include: config.get("include", ["**/*.{ts,tsx,js,jsx,py,java,fs,fsx,ml,mli,ex,exs}"]),
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
    codeFlow: {
      maxDepth: config.get("codeFlow.maxDepth", 3),
      maxSteps: config.get("codeFlow.maxSteps", 30),
      maxLogicBlocks: config.get("codeFlow.maxLogicBlocks", 120)
    },
    includeExternalDependencies: config.get("includeExternalDependencies", false),
    showUnresolvedEdges: config.get("showUnresolvedEdges", true),
    cache: {
      enabled: config.get("cache.enabled", true),
      maxSizeMb: config.get("cache.maxSizeMb", 256)
    }
  };
}
