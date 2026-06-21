/**
 * Browser-side script for the Activity Bar sidebar. It renders a VS Code
 * Explorer-like file tree and keeps analysis controls close to navigation.
 */

import { getProgressiveFileGraphBrowserSource } from "./explorerProgressiveFileGraph";

/**
 * Builds the sidebar control and file-tree script.
 */
export function getExplorerSidebarScript(): string {
  const progressiveFileGraphSource = getProgressiveFileGraphBrowserSource();

  return /* js */ `
    ${progressiveFileGraphSource}
    const vscode = acquireVsCodeApi();
    const state = {
      graph: undefined,
      analysisState: "idle",
      expandedTreeIds: new Set(["root"]),
      selectedTreeId: undefined
    };
    const elements = {
      analyzeWorkspace: document.getElementById("analyze-workspace"),
      analyzeCurrent: document.getElementById("analyze-current"),
      openGraph: document.getElementById("open-graph"),
      cancelAnalysis: document.getElementById("cancel-analysis"),
      exportJson: document.getElementById("export-json"),
      clearCache: document.getElementById("clear-cache"),
      status: document.getElementById("status"),
      files: document.getElementById("files"),
      symbols: document.getElementById("symbols"),
      edges: document.getElementById("edges"),
      languageSummary: document.getElementById("language-summary"),
      frameworkSummary: document.getElementById("framework-summary"),
      frameworkTree: document.getElementById("framework-tree"),
      explorerTree: document.getElementById("explorer-tree")
    };

    elements.analyzeWorkspace.addEventListener("click", () => {
      postRequest("analysis/run", { scope: "workspace" }, "Analyze workspace requested");
    });

    elements.analyzeCurrent.addEventListener("click", () => {
      postRequest("analysis/run", { scope: "currentFile" }, "Analyze current file requested");
    });

    elements.openGraph.addEventListener("click", () => {
      postRequest("graph/openPanel", {}, "Opening graph browser");
    });

    elements.cancelAnalysis.addEventListener("click", () => {
      postRequest("analysis/cancel", {}, "Cancel requested");
    });

    elements.exportJson.addEventListener("click", () => {
      postRequest("export/run", { format: "json" }, "Export requested");
    });

    elements.clearCache.addEventListener("click", () => {
      postRequest("cache/clear", {}, "Clear requested");
    });

    window.addEventListener("message", (event) => {
      const message = event.data;

      if (message.type === "ui/ready") {
        elements.status.textContent = "Connected";
        return;
      }

      if (message.type === "graph/loaded" || message.type === "graph/updated") {
        state.graph = message.payload;
        elements.status.textContent = "Graph available";
        render();
        return;
      }

      if (message.type === "graph/cleared") {
        state.graph = undefined;
        state.analysisState = "idle";
        render();
        return;
      }

      if (message.type === "analysis/status") {
        state.analysisState = message.payload.state;
        elements.status.textContent = message.payload.message;
        renderActions();
        return;
      }

      if (message.type === "error") {
        state.analysisState = "failed";
        elements.status.textContent = message.payload.message;
        renderActions();
      }
    });

    render();
    postRequest("ui/ready", {}, "Connecting");
    postRequest("graph/load", { mode: "file", depth: 1 }, "Loading graph state");

    function postRequest(type, payload, statusText) {
      elements.status.textContent = statusText;
      vscode.postMessage({ type, payload });
    }

    function render() {
      renderStats();
      renderProjectSummary();
      renderFrameworkTree();
      renderFileTree();
      renderActions();
    }

    function renderStats() {
      const graph = state.graph;
      elements.files.textContent = graph ? String(graph.metadata.fileCount) : "0";
      elements.symbols.textContent = graph ? String(graph.metadata.symbolCount) : "0";
      elements.edges.textContent = graph ? String(graph.metadata.edgeCount) : "0";
    }

    function renderProjectSummary() {
      const graph = state.graph;

      elements.languageSummary.replaceChildren();
      elements.frameworkSummary.replaceChildren();

      if (!graph) {
        appendSummaryEmpty(elements.languageSummary, "No languages");
        appendSummaryEmpty(elements.frameworkSummary, "No frameworks");
        return;
      }

      const languageSummary = getLanguageSummary(graph);
      const frameworks = getDetectedFrameworks(graph);

      if (languageSummary.length === 0) {
        appendSummaryEmpty(elements.languageSummary, "No languages");
      } else {
        for (const language of languageSummary.slice(0, 6)) {
          appendSummaryItem(
            elements.languageSummary,
            language.language,
            String(language.fileCount) + " files"
          );
        }
      }

      if (frameworks.length === 0) {
        appendSummaryEmpty(elements.frameworkSummary, "No frameworks");
        return;
      }

      for (const framework of frameworks.slice(0, 8)) {
        appendSummaryItem(
          elements.frameworkSummary,
          framework.name,
          framework.ecosystem + " / " + framework.category
        );
      }
    }

    function renderFrameworkTree() {
      elements.frameworkTree.replaceChildren();

      if (!state.graph) {
        appendEmptyTree(elements.frameworkTree, "Analyze a workspace to load frameworks");
        return;
      }

      const rows = createFrameworkTreeRows(state.graph);

      if (rows.length === 0) {
        appendEmptyTree(elements.frameworkTree, "No frameworks detected");
        return;
      }

      for (const row of rows) {
        appendTreeRow(elements.frameworkTree, row);
      }
    }

    function renderFileTree() {
      elements.explorerTree.replaceChildren();

      if (!state.graph) {
        appendEmptyTree(elements.explorerTree, "Analyze a workspace to load files");
        return;
      }

      const rows = createFileTreeRows(state.graph);

      if (rows.length === 0) {
        appendEmptyTree(elements.explorerTree, "No files in graph");
        return;
      }

      for (const row of rows) {
        appendTreeRow(elements.explorerTree, row);
      }
    }

    function appendTreeRow(parent, row) {
      const button = document.createElement("button");
      const disclosure = document.createElement("span");
      const icon = document.createElement("span");
      const text = document.createElement("span");
      const name = document.createElement("span");
      const detail = document.createElement("span");
      const rowClasses = ["tree-row", row.kind + "-row"];

      button.type = "button";
      if (row.hasChildren) {
        rowClasses.push("expandable");
      }
      if (row.expanded) {
        rowClasses.push("expanded");
      }
      if (state.selectedTreeId === row.id) {
        rowClasses.push("selected");
      }

      button.className = rowClasses.join(" ");
      button.style.paddingLeft = String(4 + row.depth * 16) + "px";
      button.title = row.label;
      button.setAttribute("role", "treeitem");
      button.setAttribute("aria-level", String(row.depth + 1));
      if (row.hasChildren) {
        button.setAttribute("aria-expanded", row.expanded ? "true" : "false");
      }

      disclosure.className = "tree-disclosure";
      icon.className = "tree-file-icon";
      text.className = "tree-label-group";
      name.className = "tree-label";
      detail.className = "tree-detail";
      name.textContent = row.name;
      detail.textContent = row.detail;

      text.append(name);
      if (row.detail) {
        text.append(detail);
      }
      button.append(disclosure, icon, text);
      button.addEventListener("click", () => {
        state.selectedTreeId = row.id;

        if (row.hasChildren) {
          toggleTreeRow(row.id);
        }

        render();
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight" && row.hasChildren && !row.expanded) {
          event.preventDefault();
          state.selectedTreeId = row.id;
          toggleTreeRow(row.id);
          render();
        }

        if (event.key === "ArrowLeft" && row.hasChildren && row.expanded) {
          event.preventDefault();
          state.selectedTreeId = row.id;
          toggleTreeRow(row.id);
          render();
        }
      });
      button.addEventListener("dblclick", () => {
        if (row.nodeId) {
          vscode.postMessage({ type: "node/openSource", payload: { nodeId: row.nodeId } });
        }
      });

      parent.append(button);
    }

    function createFrameworkTreeRows(graph) {
      const rows = [];
      const frameworks = getDetectedFrameworks(graph);
      const units = getFrameworkUnits(graph);
      const unitsByFramework = new Map();

      for (const unit of units) {
        const key = getFrameworkKey(unit.framework, unit.rootPath);
        const existing = unitsByFramework.get(key) ?? [];
        existing.push(unit);
        unitsByFramework.set(key, existing);
      }

      for (const framework of frameworks) {
        appendFrameworkRows(graph, framework, unitsByFramework, rows);
      }

      return rows;
    }

    function appendFrameworkRows(graph, framework, unitsByFramework, rows) {
      const rootPath = framework.rootPath || ".";
      const rowId = getFrameworkRowId(framework);
      const frameworkUnits = unitsByFramework.get(getFrameworkKey(framework.name, rootPath)) ?? [];
      const hasChildren = frameworkUnits.length > 0;
      const expanded = hasChildren && state.expandedTreeIds.has(rowId);

      rows.push({
        id: rowId,
        label: framework.name + " / " + rootPath,
        name: framework.name,
        detail: rootPath + " / " + framework.category,
        kind: "framework",
        depth: 0,
        hasChildren,
        expanded
      });

      if (!expanded || frameworkUnits.length === 0) {
        return;
      }

      appendFrameworkUnitRows(graph, frameworkUnits, rows, rowId, 1);
    }

    function appendFrameworkUnitRows(graph, units, rows, parentTreeId, depth) {
      const childrenByParentId = new Map();
      const unitsById = new Map(units.map((unit) => [unit.id, unit]));
      const relationEdgesBySourceId = createFrameworkRelationEdgeIndex(graph, unitsById);
      const rootUnits = [];

      for (const unit of units) {
        if (unit.parentId) {
          const children = childrenByParentId.get(unit.parentId) ?? [];
          children.push(unit);
          childrenByParentId.set(unit.parentId, children);
        } else {
          rootUnits.push(unit);
        }
      }

      for (const unit of rootUnits.sort(compareFrameworkUnits)) {
        appendFrameworkUnitRow(graph, unit, childrenByParentId, relationEdgesBySourceId, unitsById, rows, parentTreeId, depth);
      }
    }

    function appendFrameworkUnitRow(graph, unit, childrenByParentId, relationEdgesBySourceId, unitsById, rows, parentTreeId, depth) {
      const rowId = parentTreeId + ":unit:" + unit.id;
      const children = (childrenByParentId.get(unit.id) ?? []).sort(compareFrameworkUnits);
      const relationEdges = relationEdgesBySourceId.get(unit.id) ?? [];
      const hasChildren = children.length > 0 || relationEdges.length > 0;
      const expanded = hasChildren && state.expandedTreeIds.has(rowId);

      rows.push({
        id: rowId,
        label: unit.name,
        name: unit.name,
        detail: unit.kind,
        kind: "semantic",
        nodeId: getFileNodeIdByPath(graph, unit.filePath),
        depth,
        hasChildren,
        expanded
      });

      if (!expanded) {
        return;
      }

      const modelChildren = unit.framework === "Django" && unit.kind === "app"
        ? children.filter((child) => child.kind === "model")
        : [];
      const nonModelChildren = modelChildren.length > 0
        ? children.filter((child) => child.kind !== "model")
        : children;

      for (const child of nonModelChildren) {
        appendFrameworkUnitRow(graph, child, childrenByParentId, relationEdgesBySourceId, unitsById, rows, rowId, depth + 1);
      }

      if (modelChildren.length > 0) {
        appendDjangoModelBucketRow(graph, modelChildren, childrenByParentId, relationEdgesBySourceId, unitsById, rows, rowId, depth + 1);
      }

      const structuralChildIds = new Set(nonModelChildren.map((child) => child.id));
      const relationAncestorIds = new Set([unit.id]);
      for (const edge of relationEdges) {
        const target = unitsById.get(edge.targetId);

        if (!target || (edge.kind !== "extends" && structuralChildIds.has(target.id))) {
          continue;
        }

        appendFrameworkRelationRow(
          graph,
          edge,
          relationEdgesBySourceId,
          unitsById,
          rows,
          rowId,
          depth + 1,
          relationAncestorIds
        );
      }
    }

    function appendDjangoModelBucketRow(graph, modelUnits, childrenByParentId, relationEdgesBySourceId, unitsById, rows, parentTreeId, depth) {
      const rowId = parentTreeId + ":models";
      const modelIds = new Set(modelUnits.map((unit) => unit.id));
      const inheritedModelIds = new Set();

      for (const model of modelUnits) {
        for (const edge of relationEdgesBySourceId.get(model.id) ?? []) {
          if (edge.kind === "extends" && modelIds.has(edge.targetId)) {
            inheritedModelIds.add(edge.targetId);
          }
        }
      }

      const rootModels = modelUnits
        .filter((unit) => !inheritedModelIds.has(unit.id))
        .sort(compareFrameworkUnits);
      const expanded = rootModels.length > 0 && state.expandedTreeIds.has(rowId);

      rows.push({
        id: rowId,
        label: "Models",
        name: "Models",
        detail: String(modelUnits.length) + " models",
        kind: "semantic",
        depth,
        hasChildren: rootModels.length > 0,
        expanded
      });

      if (!expanded) {
        return;
      }

      for (const model of rootModels) {
        appendFrameworkUnitRow(graph, model, childrenByParentId, relationEdgesBySourceId, unitsById, rows, rowId, depth + 1);
      }
    }

    function appendFrameworkRelationRow(graph, edge, relationEdgesBySourceId, unitsById, rows, parentTreeId, depth, ancestorUnitIds) {
      const target = unitsById.get(edge.targetId);

      if (!target || ancestorUnitIds.has(target.id)) {
        return;
      }

      const rowId = parentTreeId + ":edge:" + edge.kind + ":" + target.id;
      const nextRelationEdges = edge.kind === "extends"
        ? (relationEdgesBySourceId.get(target.id) ?? []).filter((childEdge) => childEdge.kind === "extends")
        : [];
      const visibleRelationEdges = nextRelationEdges.filter((childEdge) => !ancestorUnitIds.has(childEdge.targetId));
      const hasChildren = visibleRelationEdges.length > 0;
      const expanded = hasChildren && state.expandedTreeIds.has(rowId);

      rows.push({
        id: rowId,
        label: target.name,
        name: target.name,
        detail: getFrameworkRelationDetail(edge, target),
        kind: "semantic",
        nodeId: getFileNodeIdByPath(graph, target.filePath),
        depth,
        hasChildren,
        expanded
      });

      if (!expanded) {
        return;
      }

      const nextAncestorUnitIds = new Set(ancestorUnitIds);
      nextAncestorUnitIds.add(target.id);

      for (const childEdge of visibleRelationEdges) {
        appendFrameworkRelationRow(
          graph,
          childEdge,
          relationEdgesBySourceId,
          unitsById,
          rows,
          rowId,
          depth + 1,
          nextAncestorUnitIds
        );
      }
    }

    function getFrameworkRelationDetail(edge, target) {
      const relationLabel = edge.displayKind || edge.kind;
      return relationLabel + " / " + target.kind;
    }

    function createFrameworkRelationEdgeIndex(graph, unitsById) {
      const relationEdgesBySourceId = new Map();

      for (const edge of getFrameworkUnitEdges(graph)) {
        if (edge.kind === "contains" || !unitsById.has(edge.sourceId) || !unitsById.has(edge.targetId)) {
          continue;
        }

        if (edge.kind === "extends") {
          const edges = relationEdgesBySourceId.get(edge.targetId) ?? [];
          edges.push({
            ...edge,
            sourceId: edge.targetId,
            targetId: edge.sourceId,
            displayKind: "subclass"
          });
          relationEdgesBySourceId.set(edge.targetId, edges);
          continue;
        }

        const edges = relationEdgesBySourceId.get(edge.sourceId) ?? [];
        edges.push(edge);
        relationEdgesBySourceId.set(edge.sourceId, edges);
      }

      for (const edges of relationEdgesBySourceId.values()) {
        edges.sort((left, right) => {
          const leftTarget = unitsById.get(left.targetId);
          const rightTarget = unitsById.get(right.targetId);
          return compareFrameworkUnits(leftTarget, rightTarget);
        });
      }

      return relationEdgesBySourceId;
    }

    function createFileTreeRows(graph) {
      const index = createImportTreeIndex(graph);
      const rows = [];

      for (const rootNode of getApplicationEntryNodes(graph, index)) {
        appendImportRows(graph, index, rootNode, rows, [], 0);
      }

      return rows;
    }

    function createImportTreeIndex(graph) {
      const fileNodes = graph.nodes
        .filter((node) => node.kind === "file")
        .sort((left, right) => getRelativePath(graph, left.filePath).localeCompare(getRelativePath(graph, right.filePath)));
      const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
      const fileNodesById = new Map(fileNodes.map((node) => [node.id, node]));
      const importedFileIds = new Set();
      const importerFileIds = new Set();
      const childrenByImporterId = new Map();

      for (const edge of graph.edges) {
        if (!["imports", "exports"].includes(edge.kind)) {
          continue;
        }

        const source = fileNodesById.get(edge.sourceId);
        const target = nodesById.get(edge.targetId);

        if (!source || !target || !["file", "external"].includes(target.kind)) {
          continue;
        }

        if (target.kind === "file") {
          importedFileIds.add(target.id);
        }
        importerFileIds.add(source.id);
        const children = childrenByImporterId.get(source.id) ?? [];
        children.push(target);
        childrenByImporterId.set(source.id, children);
      }

      for (const children of childrenByImporterId.values()) {
        children.sort((left, right) => getTreeNodeLabel(graph, left).localeCompare(getTreeNodeLabel(graph, right)));
      }

      return {
        childrenByImporterId,
        fileImportChildrenBySourceId: childrenByImporterId,
        fileNodes,
        fileImportEdges: graph.edges.filter((edge) =>
          ["imports", "exports"].includes(edge.kind) &&
          fileNodesById.has(edge.sourceId) &&
          ["file", "external"].includes(nodesById.get(edge.targetId)?.kind)
        ),
        importedFileIds,
        importerFileIds,
        nodesById
      };
    }

    function appendImportRows(graph, index, fileNode, rows, ancestorIds, depth) {
      const nextAncestorIds = [...ancestorIds, fileNode.id];
      const rowId = "import:" + nextAncestorIds.join(">");
      const relativePath = getTreeNodeLabel(graph, fileNode);
      const children = (index.childrenByImporterId.get(fileNode.id) ?? [])
        .filter((child) => !nextAncestorIds.includes(child.id));
      const hasChildren = fileNode.kind === "file" && children.length > 0;
      const expanded = hasChildren && state.expandedTreeIds.has(rowId);

      rows.push({
        id: rowId,
        label: relativePath,
        name: getFileName(relativePath),
        detail: getTreeNodeDetail(relativePath, fileNode, depth),
        kind: fileNode.kind === "external" ? "external" : depth === 0 ? "entry" : "import",
        nodeId: fileNode.id,
        depth,
        hasChildren,
        expanded
      });

      if (!expanded) {
        return;
      }

      for (const child of children) {
        appendImportRows(graph, index, child, rows, nextAncestorIds, depth + 1);
      }
    }

    function toggleTreeRow(treeId) {
      if (state.expandedTreeIds.has(treeId)) {
        state.expandedTreeIds.delete(treeId);
      } else {
        state.expandedTreeIds.add(treeId);
      }
    }

    function appendEmptyTree(parent, message) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = message;
      parent.append(empty);
    }

    function appendSummaryEmpty(parent, message) {
      const empty = document.createElement("div");
      empty.className = "summary-empty";
      empty.textContent = message;
      parent.append(empty);
    }

    function appendSummaryItem(parent, label, detail) {
      const item = document.createElement("div");
      const name = document.createElement("span");
      const meta = document.createElement("span");

      item.className = "summary-item";
      name.className = "summary-name";
      meta.className = "summary-meta";
      name.textContent = label;
      meta.textContent = detail;
      item.title = label + " - " + detail;
      item.append(name, meta);
      parent.append(item);
    }

    function getLanguageSummary(graph) {
      if (Array.isArray(graph.metadata.languageSummary)) {
        return graph.metadata.languageSummary;
      }

      return (graph.metadata.languages ?? []).map((language) => ({
        language,
        fileCount: 0,
        percentage: 0
      }));
    }

    function getDetectedFrameworks(graph) {
      if (!Array.isArray(graph.metadata.frameworks)) {
        return [];
      }

      return graph.metadata.frameworks;
    }

    function getFrameworkUnits(graph) {
      if (!Array.isArray(graph.metadata.frameworkUnits)) {
        return [];
      }

      return graph.metadata.frameworkUnits;
    }

    function getFrameworkUnitEdges(graph) {
      if (!Array.isArray(graph.metadata.frameworkUnitEdges)) {
        return [];
      }

      return graph.metadata.frameworkUnitEdges;
    }

    function getFrameworkKey(name, rootPath) {
      return String(rootPath || ".") + "::" + String(name || "").toLowerCase();
    }

    function getFrameworkRowId(framework) {
      return "framework:" + getFrameworkKey(framework.name, framework.rootPath || ".");
    }

    function getFileNodeIdByPath(graph, filePath) {
      if (!filePath) {
        return undefined;
      }

      const fileNode = graph.nodes.find((node) => node.kind === "file" && node.filePath === filePath);
      return fileNode?.id;
    }

    function compareFrameworkUnits(left, right) {
      return String(left.kind).localeCompare(String(right.kind)) ||
        String(left.name).localeCompare(String(right.name));
    }

    function renderActions() {
      const analysisRunning = state.analysisState === "running";
      const hasGraph = Boolean(state.graph);

      elements.analyzeWorkspace.disabled = analysisRunning;
      elements.analyzeCurrent.disabled = analysisRunning;
      elements.cancelAnalysis.disabled = !analysisRunning;
      elements.openGraph.disabled = analysisRunning && !hasGraph;
      elements.exportJson.disabled = !hasGraph || analysisRunning;
      elements.clearCache.disabled = analysisRunning;
    }

    function getRelativePath(graph, filePath) {
      const workspaceRoot = graph.workspaceRoot.replace(/\\\\/g, "/");
      const normalized = filePath.replace(/\\\\/g, "/");

      if (normalized.startsWith(workspaceRoot + "/")) {
        return normalized.slice(workspaceRoot.length + 1);
      }

      return normalized.split("/").slice(-3).join("/");
    }

    function getTreeNodeLabel(graph, node) {
      if (node.kind === "external") {
        return node.qualifiedName || node.name || "external module";
      }

      return getRelativePath(graph, node.filePath);
    }

    function getTreeNodeDetail(relativePath, node, depth) {
      if (node.kind === "external") {
        return "external module usage";
      }

      return getDirectoryName(relativePath) || (depth === 0 ? "entrypoint" : "");
    }

    function getFileName(relativePath) {
      const parts = relativePath.split("/");
      return parts[parts.length - 1] || relativePath;
    }

    function getDirectoryName(relativePath) {
      const parts = relativePath.split("/");
      parts.pop();
      return parts.join("/");
    }
  `;
}
