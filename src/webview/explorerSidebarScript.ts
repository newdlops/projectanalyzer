/**
 * Browser-side script for the Activity Bar sidebar. It renders a VS Code
 * Explorer-like file tree and keeps analysis controls close to navigation.
 */

import { getProgressiveFileGraphBrowserSource } from "./explorerProgressiveFileGraph";
import { getFunctionCallTreeBrowserSource } from "./explorerFunctionCallTree";
import { getFrameworkTreeBrowserSource } from "./explorerFrameworkTree";
import { getVirtualTreeBrowserSource } from "./explorerVirtualTree";

/**
 * Builds the sidebar control and file-tree script.
 */
export function getExplorerSidebarScript(): string {
  const progressiveFileGraphSource = getProgressiveFileGraphBrowserSource();
  const functionCallTreeSource = getFunctionCallTreeBrowserSource();
  const frameworkTreeSource = getFrameworkTreeBrowserSource();
  const virtualTreeSource = getVirtualTreeBrowserSource();

  return /* js */ `
    ${progressiveFileGraphSource}
    ${functionCallTreeSource}
    ${frameworkTreeSource}
    ${virtualTreeSource}
    const vscode = acquireVsCodeApi();
    const state = {
      graph: undefined,
      analysisState: "idle",
      expandedAccordionSections: new Set(["frameworks"]),
      expandedTreeIds: new Set(["root"]),
      graphRevision: 0,
      treeRevision: 0,
      treeRowsCache: new Map(),
      selectedTreeId: undefined
    };
    const elements = {
      analyzeWorkspace: document.getElementById("analyze-workspace"),
      analyzeCurrent: document.getElementById("analyze-current"),
      showWorkspace: document.getElementById("show-workspace"),
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
      frameworkAccordion: document.getElementById("accordion-frameworks"),
      callAccordion: document.getElementById("accordion-calls"),
      filesAccordion: document.getElementById("accordion-files"),
      frameworkPanel: document.getElementById("framework-panel"),
      callPanel: document.getElementById("call-panel"),
      filesPanel: document.getElementById("files-panel"),
      frameworkSection: document.getElementById("framework-section"),
      callSection: document.getElementById("call-section"),
      filesSection: document.getElementById("files-section"),
      frameworkTree: document.getElementById("framework-tree"),
      callTree: document.getElementById("call-tree"),
      explorerTree: document.getElementById("explorer-tree")
    };

    elements.analyzeWorkspace.addEventListener("click", () => {
      postRequest("analysis/run", { scope: "workspace" }, "Analyze workspace requested");
    });

    elements.analyzeCurrent.addEventListener("click", () => {
      postRequest("analysis/run", { scope: "currentFile" }, "Analyze current file requested");
    });
    elements.showWorkspace.addEventListener("click", () => postRequest("graph/showWorkspaceScope", {}, "Loading workspace scope"));

    elements.openGraph.addEventListener("click", () => {
      elements.status.textContent = "Graph rendering is temporarily disabled";
    });

    bindAccordion(elements.frameworkAccordion, "frameworks");
    bindAccordion(elements.callAccordion, "calls");
    bindAccordion(elements.filesAccordion, "files");

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
        state.graphRevision += 1;
        state.treeRowsCache.clear();
        elements.status.textContent = "Graph available";
        render();
        return;
      }

      if (message.type === "graph/cleared") {
        state.graph = undefined;
        state.analysisState = "idle";
        state.graphRevision += 1;
        state.treeRowsCache.clear();
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
      renderAccordionSections();
      renderActions();
    }

    function bindAccordion(header, sectionId) {
      header.addEventListener("click", () => {
        toggleAccordionSection(sectionId);
        renderAccordionSections();
      });
    }

    function toggleAccordionSection(sectionId) {
      if (state.expandedAccordionSections.has(sectionId)) {
        state.expandedAccordionSections.delete(sectionId);
      } else {
        state.expandedAccordionSections.add(sectionId);
      }
    }

    function renderAccordionSections() {
      renderAccordionSection("frameworks", elements.frameworkSection, elements.frameworkAccordion, elements.frameworkPanel, renderFrameworkTree);
      renderAccordionSection("calls", elements.callSection, elements.callAccordion, elements.callPanel, renderFunctionCallTree);
      renderAccordionSection("files", elements.filesSection, elements.filesAccordion, elements.filesPanel, renderFileTree);
    }

    function renderAccordionSection(sectionId, section, header, panel, renderPanel) {
      const expanded = state.expandedAccordionSections.has(sectionId);

      section.classList.toggle("collapsed", !expanded);
      header.setAttribute("aria-expanded", expanded ? "true" : "false");
      panel.hidden = !expanded;

      if (!expanded) {
        clearAccordionPanel(panel);
        return;
      }

      renderPanel();
    }

    function clearAccordionPanel(panel) {
      const tree = panel.querySelector(".explorer-tree");

      if (tree) {
        clearVirtualTree(tree);
      }
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
      if (!state.graph) {
        clearVirtualTree(elements.frameworkTree);
        appendEmptyTree(elements.frameworkTree, "Analyze a workspace to load frameworks");
        return;
      }

      const rows = getTreeRows("frameworks", () => createFrameworkTreeRows(state.graph));
      renderVirtualTree(elements.frameworkTree, rows, "No frameworks detected");
    }

    function renderFileTree() {
      if (!state.graph) {
        clearVirtualTree(elements.explorerTree);
        appendEmptyTree(elements.explorerTree, "Analyze a workspace to load files");
        return;
      }

      const rows = getTreeRows("files", () => createFileTreeRows(state.graph));
      renderVirtualTree(elements.explorerTree, rows, "No files in graph");
    }

    function renderFunctionCallTree() {
      if (!state.graph) {
        clearVirtualTree(elements.callTree);
        appendEmptyTree(elements.callTree, "Analyze a workspace to load function calls");
        return;
      }

      const rows = getTreeRows("calls", () => createFunctionCallTreeRows(state.graph, state.expandedTreeIds));
      renderVirtualTree(elements.callTree, rows, "No callable functions in graph");
    }

    function getTreeRows(sectionId, createRows) {
      const cacheKey = sectionId + ":" + String(state.graphRevision) + ":" + String(state.treeRevision);
      const cached = state.treeRowsCache.get(cacheKey);

      if (cached) {
        return cached;
      }

      const rows = createRows();
      state.treeRowsCache.set(cacheKey, rows);
      return rows;
    }

    function createTreeRow(row) {
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

      return button;
    }

    function appendTreeRow(parent, row) {
      parent.append(createTreeRow(row));
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

      state.treeRevision += 1;
      state.treeRowsCache.clear();
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

    function renderActions() {
      const analysisRunning = state.analysisState === "running";
      const hasGraph = Boolean(state.graph);

      elements.analyzeWorkspace.disabled = analysisRunning;
      elements.analyzeCurrent.disabled = analysisRunning;
      elements.showWorkspace.disabled = analysisRunning;
      elements.cancelAnalysis.disabled = !analysisRunning;
      elements.openGraph.disabled = true;
      elements.openGraph.title = "Graph rendering is temporarily disabled";
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
