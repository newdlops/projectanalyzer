/** Deterministic ordering and cycle-label helpers for Module Flow layout. */

import type { ModuleFlowSccComponent } from "./moduleFlowScc";
import type { ModuleFlowGraphEdgeInput, ModuleFlowGraphNodeInput } from "./moduleFlowGraphLayout";

/** Creates compatibility cycle copy; Webviews render the localized descriptor. */
export function createModuleFlowCycleLabel(component: ModuleFlowSccComponent): string {
  return component.nodeIds.length === 1 ? "Self cycle" : `Cycle · ${component.nodeIds.length} nodes`;
}

/** Fully orders duplicate candidate nodes independently of input order. */
export function compareModuleFlowNodes(left: ModuleFlowGraphNodeInput, right: ModuleFlowGraphNodeInput): number {
  return compareModuleFlowText(left.id, right.id) || compareModuleFlowText(left.kind, right.kind)
    || compareModuleFlowText(left.title, right.title) || compareModuleFlowText(left.subtitle ?? "", right.subtitle ?? "")
    || compareModuleFlowText((left.badges ?? []).join("\0"), (right.badges ?? []).join("\0"))
    || compareModuleFlowText((left.metricLines ?? []).join("\0"), (right.metricLines ?? []).join("\0"))
    || compareModuleFlowText((left.detailLines ?? []).join("\0"), (right.detailLines ?? []).join("\0"));
}

/** Fully orders duplicate candidate edges and their routing channels. */
export function compareModuleFlowEdges(left: ModuleFlowGraphEdgeInput, right: ModuleFlowGraphEdgeInput): number {
  return compareModuleFlowText(left.sourceId, right.sourceId) || compareModuleFlowText(left.targetId, right.targetId)
    || compareModuleFlowText(left.id, right.id) || compareModuleFlowText(left.kind ?? "", right.kind ?? "")
    || compareModuleFlowText(left.label ?? "", right.label ?? "");
}

/** Locale-independent comparison shared by host and browser layout runtimes. */
export function compareModuleFlowText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Returns browser declarations for the ordering helpers without module imports. */
export function getModuleFlowGraphOrderingBrowserSource(): string {
  return /* js */ `
    function compareModuleFlowText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
    function compareModuleFlowNodes(left, right) {
      return compareModuleFlowText(left.id, right.id) || compareModuleFlowText(left.kind, right.kind)
        || compareModuleFlowText(left.title, right.title) || compareModuleFlowText(left.subtitle || "", right.subtitle || "")
        || compareModuleFlowText((left.badges || []).join("\\0"), (right.badges || []).join("\\0"))
        || compareModuleFlowText((left.metricLines || []).join("\\0"), (right.metricLines || []).join("\\0"))
        || compareModuleFlowText((left.detailLines || []).join("\\0"), (right.detailLines || []).join("\\0"));
    }
    function compareModuleFlowEdges(left, right) {
      return compareModuleFlowText(left.sourceId, right.sourceId) || compareModuleFlowText(left.targetId, right.targetId)
        || compareModuleFlowText(left.id, right.id) || compareModuleFlowText(left.kind || "", right.kind || "")
        || compareModuleFlowText(left.label || "", right.label || "");
    }
    function createModuleFlowCycleLabel(component) { return component.nodeIds.length === 1 ? "Self cycle" : "Cycle · " + component.nodeIds.length + " nodes"; }
  `;
}
