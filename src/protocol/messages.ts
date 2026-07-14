/**
 * Typed message protocol between the VS Code extension host and Webview. Keeping
 * the protocol central prevents UI and extension code from drifting independently.
 */

import type { ProjectGraph } from "../shared/types";
import type { FunctionExplorerPayload, FunctionExplorerRequest } from "./functionExplorer";
import type { ProjectOverviewPayload } from "./projectOverview";
import type {
  ProjectReadingGuidePayload,
  ProjectReadingScopePayloadId,
  ProjectScopeReadingGuidePayload
} from "./projectReadingGuide";

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

/** Analysis request emitted by the GUI. */
export type AnalysisRunRequest = {
  scope: "workspace" | "currentFile";
};

/** Node relationship exploration request emitted by the GUI. */
export type NodeRelationshipRequest = {
  nodeId: string;
  direction: "callers" | "callees";
};

/** Request to reveal a graph node inside the editor-tab graph browser. */
export type GraphFocusNodeRequest = {
  nodeId: string;
};

/** Browser-side diagnostic log emitted by Webview scripts. */
export type WebviewLogRequest = {
  fields?: Record<string, unknown>;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  source: "graphPanel" | "sidebar";
};

/** Messages sent from Webview to Extension Host. */
export type WebviewRequest =
  | { type: "ui/ready"; payload: Record<string, never> }
  | { type: "graph/load"; payload: GraphLoadRequest }
  | { type: "graph/loadStructure"; payload: { graphVersion: string } }
  | { type: "graph/openPanel"; payload: Record<string, never> }
  | { type: "graph/showWorkspaceScope"; payload: Record<string, never> }
  | { type: "graph/focusNode"; payload: GraphFocusNodeRequest }
  | { type: "graph/expand"; payload: ExpandRequest }
  | { type: "analysis/run"; payload: AnalysisRunRequest }
  | { type: "analysis/cancel"; payload: Record<string, never> }
  | { type: "cache/clear"; payload: Record<string, never> }
  | { type: "node/openSource"; payload: { nodeId: string } }
  | { type: "node/showRelationship"; payload: NodeRelationshipRequest }
  | {
      type: "project/readingGuideScope";
      payload: { graphVersion: string; scopeId: ProjectReadingScopePayloadId };
    }
  | { type: "project/loadOverview"; payload: { graphVersion: string } }
  | { type: "search/query"; payload: SearchRequest }
  | { type: "export/run"; payload: ExportRequest }
  | FunctionExplorerRequest
  | { type: "telemetry/log"; payload: WebviewLogRequest };

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

/** Analysis lifecycle update displayed by the Webview. */
export type AnalysisStatusPayload = {
  state: "idle" | "running" | "complete" | "failed";
  message: string;
};

/** Messages sent from Extension Host to Webview. */
export type ExtensionResponse =
  | { type: "ui/ready"; payload: Record<string, never> }
  | { type: "graph/loaded"; payload: ProjectGraph }
  | { type: "graph/updated"; payload: ProjectGraph }
  | { type: "graph/structureLoaded"; payload: ProjectGraph }
  | { type: "graph/focusNode"; payload: GraphFocusNodeRequest }
  | { type: "graph/cleared"; payload: Record<string, never> }
  | { type: "analysis/status"; payload: AnalysisStatusPayload }
  | { type: "project/overviewLoaded"; payload: ProjectOverviewPayload }
  | { type: "project/readingGuideLoaded"; payload: ProjectReadingGuidePayload }
  | { type: "project/readingGuideScopeLoaded"; payload: ProjectScopeReadingGuidePayload }
  | { type: "function/indexLoaded"; payload: FunctionExplorerPayload }
  | { type: "view/modeChanged"; payload: { mode: GraphViewMode } }
  | { type: "search/results"; payload: SearchResult[] }
  | { type: "error"; payload: ErrorPayload };
