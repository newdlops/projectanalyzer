/**
 * Typed message protocol between the VS Code extension host and Webview. Keeping
 * the protocol central prevents UI and extension code from drifting independently.
 */

import type { ProjectGraph } from "../shared/types";

/** Supported graph view modes shown by the explorer. */
export type GraphViewMode = "call" | "file" | "class";

/** Request for loading a graph view into the Webview. */
export type GraphLoadRequest = {
  mode: GraphViewMode;
  rootNodeId?: string;
  depth: number;
};

/** Request for expanding an existing graph node. */
export type ExpandRequest = {
  nodeId: string;
  depth: number;
};

/** Search request emitted by the Webview. */
export type SearchRequest = {
  query: string;
};

/** Export request emitted by the Webview or command palette. */
export type ExportRequest = {
  format: "json" | "graphml" | "mermaid" | "dot" | "svg" | "png" | "markdown";
};

/** Messages sent from Webview to Extension Host. */
export type WebviewRequest =
  | { type: "graph/load"; payload: GraphLoadRequest }
  | { type: "graph/expand"; payload: ExpandRequest }
  | { type: "node/openSource"; payload: { nodeId: string } }
  | { type: "search/query"; payload: SearchRequest }
  | { type: "export/run"; payload: ExportRequest };

/** Search result returned to the Webview. */
export type SearchResult = {
  nodeId: string;
  label: string;
  detail: string;
};

/** Error payload safe to display inside the explorer. */
export type ErrorPayload = {
  code: string;
  message: string;
};

/** Messages sent from Extension Host to Webview. */
export type ExtensionResponse =
  | { type: "graph/loaded"; payload: ProjectGraph }
  | { type: "graph/updated"; payload: ProjectGraph }
  | { type: "search/results"; payload: SearchResult[] }
  | { type: "error"; payload: ErrorPayload };
