/** Generated browser label helpers for Module Flow edges and expansion affordances. */
export function getModuleFlowLabelBrowserSource(): string {
  return /* js */ `
    function edgeLabel(edge) {
      if (!edge) return "";
      if (edge.presentation?.key) return projectAnalyzerText(edge.presentation.key, edge.presentation.params);
      if (edge.presentationKind === "contains") return projectAnalyzerText("module-edge-contains");
      if (edge.presentationKind === "functionEntry") return projectAnalyzerText("module-edge-function-entry");
      if (edge.presentationKind === "controlFlow") return edge.controlLabel || projectAnalyzerText("logic-edge-" + (edge.controlKind || "next"));
      const values = (edge.relations || []).map(function (relation) {
        return projectAnalyzerText("module-relation-" + relation.kind, {
          count: relation.count
        });
      });
      return values.join(" · ") || (edge.presentationKind === "concreteCall"
        ? projectAnalyzerText("module-edge-calls")
        : projectAnalyzerText("relationship"));
    }
    /** Describes what expanding a rendered module node will reveal. */
    function expansionHint(node) {
      if (!node.expandable) return projectAnalyzerText("inspect-module");
      if (node.expandable.boundaryFunctions) return projectAnalyzerText("attach-boundary");
      if (node.expandable.childModules) return projectAnalyzerText("attach-children");
      return projectAnalyzerText("inspect-module");
    }
  `;
}
