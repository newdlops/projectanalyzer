/**
 * Browser-side script for the Activity Bar sidebar. It renders a VS Code
 * Explorer-like file tree and keeps analysis controls close to navigation.
 */

import { getProgressiveFileGraphBrowserSource } from "./explorerProgressiveFileGraph";
import { getFrameworkTreeBrowserSource } from "./explorerFrameworkTree";
import { getLazyDetailsBrowserSource } from "./explorerLazyDetails";
import { getOverviewBrowserSource } from "./explorerOverview";
import { getReadingGuideBrowserSource } from "./explorerReadingGuide";
import { getVirtualTreeBrowserSource } from "./explorerVirtualTree";
import { getFunctionSearchBrowserSource } from "./functionSearch";

/**
 * Builds the sidebar control and file-tree script.
 */
export function getExplorerSidebarScript(): string {
  const progressiveFileGraphSource = getProgressiveFileGraphBrowserSource();
  const frameworkTreeSource = getFrameworkTreeBrowserSource();
  const functionSearchSource = getFunctionSearchBrowserSource();
  const lazyDetailsSource = getLazyDetailsBrowserSource();
  const overviewSource = getOverviewBrowserSource();
  const readingGuideSource = getReadingGuideBrowserSource();
  const virtualTreeSource = getVirtualTreeBrowserSource();

  return /* js */ `
    ${progressiveFileGraphSource}
    ${frameworkTreeSource}
    ${functionSearchSource}
    ${lazyDetailsSource}
    ${overviewSource}
    ${readingGuideSource}
    ${virtualTreeSource}
    const vscode = acquireVsCodeApi();
    const state = {
      graph: undefined,
      structureGraph: undefined,
      analysisState: "idle",
      expandedAccordionSections: new Set(),
      expandedTreeIds: new Set(["root", "function-flows:framework-handlers"]),
      graphRevision: 0,
      functionIndex: undefined,
      functionIndexLoading: false,
      functionIndexRequestVersion: undefined,
      functionIndexRevision: 0,
      functionSearch: undefined,
      functionSearchActive: false,
      functionSearchLoading: false,
      functionSearchPendingCursor: undefined,
      functionSearchPendingRequestId: undefined,
      functionSearchQuery: "",
      functionSearchError: undefined,
      functionSearchRequestSequence: 0,
      functionSearchRevision: 0,
      projectOverview: undefined,
      projectOverviewLoading: false,
      projectOverviewRequestVersion: undefined,
      readingGuide: undefined,
      scopeGuide: undefined,
      scopeGuideLoading: false,
      selectedScopeId: undefined,
      structureLoading: false,
      structureMode: "frameworks",
      structureRequestVersion: undefined,
      treeRevision: 0,
      treeRowsCache: new Map(),
      selectedTreeId: undefined,
      selectedFunctionId: undefined
    };
    const elements = {
      analyzeWorkspace: document.getElementById("analyze-workspace"),
      analyzeCurrent: document.getElementById("analyze-current"),
      showWorkspace: document.getElementById("show-workspace"),
      exportJson: document.getElementById("export-json"),
      clearCache: document.getElementById("clear-cache"),
      status: document.getElementById("status"),
      guideSummary: document.getElementById("guide-summary"),
      guideScopes: document.getElementById("guide-scopes"),
      guideScopeDetail: document.getElementById("guide-scope-detail"),
      projectBrief: document.getElementById("project-brief"),
      analysisSignals: document.getElementById("analysis-signals"),
      callAccordion: document.getElementById("accordion-calls"),
      structureAccordion: document.getElementById("accordion-structure"),
      analysisAccordion: document.getElementById("accordion-analysis"),
      callPanel: document.getElementById("call-panel"),
      structurePanel: document.getElementById("structure-panel"),
      analysisPanel: document.getElementById("analysis-panel"),
      callSection: document.getElementById("call-section"),
      structureSection: document.getElementById("structure-section"),
      analysisSection: document.getElementById("analysis-section"),
      structureFrameworks: document.getElementById("structure-frameworks"),
      structureFiles: document.getElementById("structure-files"),
      frameworkTree: document.getElementById("framework-tree"),
      callTree: document.getElementById("call-tree"),
      functionSearch: document.getElementById("function-search"),
      functionSearchInput: document.getElementById("function-search-input"),
      functionSearchSubmit: document.getElementById("function-search-submit"),
      functionSearchClear: document.getElementById("function-search-clear"),
      functionSearchStatus: document.getElementById("function-search-status"),
      functionSearchMore: document.getElementById("function-search-more"),
      explorerTree: document.getElementById("explorer-tree")
    };

    elements.analyzeWorkspace.addEventListener("click", () => {
      if (state.analysisState === "running") {
        postRequest("analysis/cancel", {}, "Cancel requested");
      } else {
        postRequest("analysis/run", { scope: "workspace" }, "Analyze workspace requested");
      }
    });

    elements.analyzeCurrent.addEventListener("click", () => {
      postRequest("analysis/run", { scope: "currentFile" }, "Analyze current file requested");
    });
    elements.showWorkspace.addEventListener("click", () => postRequest("graph/showWorkspaceScope", {}, "Loading workspace scope"));

    bindAccordion(elements.callAccordion, "calls");
    bindAccordion(elements.structureAccordion, "structure");
    bindAccordion(elements.analysisAccordion, "analysis");
    bindFunctionSearchControls();

    elements.structureFrameworks.addEventListener("click", () => setStructureMode("frameworks"));
    elements.structureFiles.addEventListener("click", () => setStructureMode("files"));

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
        const graphVersionChanged = state.graph?.version !== message.payload.version;
        state.graph = message.payload;
        state.graphRevision += 1;

        if (graphVersionChanged) {
          resetGraphScopedDetails();
        }

        elements.status.textContent = "Graph available";
        requestExpandedAccordionData();
        render();
        return;
      }

      if (message.type === "graph/structureLoaded") {
        if (
          !isCurrentGraphVersion(message.payload.version)
          || state.structureRequestVersion !== message.payload.version
        ) {
          return;
        }

        state.structureGraph = message.payload;
        state.structureLoading = false;
        state.treeRevision += 1;
        state.treeRowsCache.clear();
        if (state.expandedAccordionSections.has("structure")) {
          renderStructureTree();
        }
        return;
      }

      if (message.type === "function/indexLoaded") {
        if (
          !isCurrentGraphVersion(message.payload.graphVersion)
          || state.functionIndexRequestVersion !== message.payload.graphVersion
        ) {
          return;
        }
        state.functionIndex = message.payload;
        state.functionIndexLoading = false;
        state.expandedTreeIds = new Set(
          message.payload.options?.expandedRowIds ?? Array.from(state.expandedTreeIds)
        );
        state.selectedFunctionId =
          message.payload.options?.selectedFunctionId ?? state.selectedFunctionId;
        state.functionIndexRevision += 1;
        state.treeRowsCache.clear();
        renderAccordionSections();
        return;
      }

      if (message.type === "function/searchLoaded" || message.type === "function/searchFailed") {
        if (
          acceptFunctionSearchMessage(message)
          && state.expandedAccordionSections.has("calls")
        ) {
          renderFunctionCallTree();
        }
        return;
      }

      if (message.type === "project/overviewLoaded") {
        if (
          !isCurrentGraphVersion(message.payload.graphVersion)
          || state.projectOverviewRequestVersion !== message.payload.graphVersion
        ) {
          return;
        }
        state.projectOverview = message.payload;
        state.projectOverviewLoading = false;
        if (state.expandedAccordionSections.has("analysis")) {
          renderProjectOverview();
        }
        return;
      }

      if (message.type === "project/readingGuideLoaded") {
        if (!isCurrentGraphVersion(message.payload.graphVersion)) {
          return;
        }
        state.readingGuide = message.payload;
        renderProjectReadingGuide();
        return;
      }

      if (message.type === "project/readingGuideScopeLoaded") {
        if (
          !isCurrentGraphVersion(message.payload.graphVersion)
          || message.payload.scope.id !== state.selectedScopeId
        ) {
          return;
        }
        state.scopeGuide = message.payload;
        state.scopeGuideLoading = false;
        renderProjectReadingGuide();
        return;
      }

      if (message.type === "graph/cleared") {
        state.graph = undefined;
        state.analysisState = "idle";
        state.graphRevision += 1;
        resetGraphScopedDetails();
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
        if (message.payload.code !== "PROJECT_READING_SCOPE_NOT_FOUND") {
          state.analysisState = "failed";
        }
        state.functionIndexLoading = false;
        state.functionSearchLoading = false;
        state.functionSearchPendingCursor = undefined;
        state.functionSearchPendingRequestId = undefined;
        state.projectOverviewLoading = false;
        state.scopeGuideLoading = false;
        state.structureLoading = false;
        elements.status.textContent = message.payload.message;
        renderProjectReadingGuide();
        renderAccordionSections();
        renderActions();
      }
    });

    render();
    postRequest("ui/ready", {}, "Connecting");

    function postRequest(type, payload, statusText) {
      elements.status.textContent = statusText;
      vscode.postMessage({ type, payload });
    }

    function render() {
      renderProjectReadingGuide();
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
        requestAccordionData(sectionId);
      }
    }

    function renderAccordionSections() {
      renderAccordionSection("calls", elements.callSection, elements.callAccordion, elements.callPanel, renderFunctionCallTree);
      renderAccordionSection(
        "structure",
        elements.structureSection,
        elements.structureAccordion,
        elements.structurePanel,
        renderStructureTree
      );
      renderAccordionSection(
        "analysis",
        elements.analysisSection,
        elements.analysisAccordion,
        elements.analysisPanel,
        renderProjectOverview
      );
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
      for (const tree of panel.querySelectorAll(".explorer-tree")) {
        clearVirtualTree(tree);
      }
    }

    /** Switches the single Structure disclosure between semantic and file views. */
    function setStructureMode(mode) {
      state.structureMode = mode;
      state.treeRevision += 1;
      state.treeRowsCache.clear();
      renderStructureTree();
    }

    /** Renders only the structure subview explicitly selected by the user. */
    function renderStructureTree() {
      const showsFrameworks = state.structureMode === "frameworks";
      elements.structureFrameworks.classList.toggle("active", showsFrameworks);
      elements.structureFiles.classList.toggle("active", !showsFrameworks);
      elements.structureFrameworks.setAttribute("aria-selected", showsFrameworks ? "true" : "false");
      elements.structureFiles.setAttribute("aria-selected", showsFrameworks ? "false" : "true");
      elements.frameworkTree.hidden = !showsFrameworks;
      elements.explorerTree.hidden = showsFrameworks;

      const activeTree = showsFrameworks ? elements.frameworkTree : elements.explorerTree;
      const inactiveTree = showsFrameworks ? elements.explorerTree : elements.frameworkTree;
      clearVirtualTree(inactiveTree);

      if (!state.graph) {
        clearVirtualTree(activeTree);
        appendEmptyTree(activeTree, "Analyze a workspace to load project structure");
        return;
      }

      if (state.structureLoading) {
        clearVirtualTree(activeTree);
        appendEmptyTree(activeTree, "Loading project structure...");
        return;
      }

      if (!state.structureGraph || !isCurrentGraphVersion(state.structureGraph.version)) {
        clearVirtualTree(activeTree);
        appendEmptyTree(activeTree, "Project structure is not loaded");
        return;
      }

      if (showsFrameworks) {
        renderFrameworkTree();
      } else {
        renderFileTree();
      }
    }

    function renderFrameworkTree() {
      const graph = state.structureGraph;

      if (!graph || !isCurrentGraphVersion(graph.version)) {
        clearVirtualTree(elements.frameworkTree);
        appendEmptyTree(elements.frameworkTree, "Project structure is not loaded");
        return;
      }

      const rows = getTreeRows("frameworks", () => createFrameworkTreeRows(graph));
      renderVirtualTree(elements.frameworkTree, rows, "No frameworks detected");
    }

    function renderFileTree() {
      const graph = state.structureGraph;

      if (!graph || !isCurrentGraphVersion(graph.version)) {
        clearVirtualTree(elements.explorerTree);
        appendEmptyTree(elements.explorerTree, "Project structure is not loaded");
        return;
      }

      const rows = getTreeRows("files", () => createFileTreeRows(graph));
      renderVirtualTree(elements.explorerTree, rows, "No files in graph");
    }

    function renderFunctionCallTree() {
      renderFunctionSearchControls();

      if (!state.graph) {
        clearVirtualTree(elements.callTree);
        appendEmptyTree(elements.callTree, "Analyze a workspace to load function calls");
        return;
      }

      if (state.functionSearchActive) {
        if (state.functionSearchLoading && !state.functionSearch) {
          clearVirtualTree(elements.callTree);
          appendEmptyTree(elements.callTree, "Searching all analyzed functions...");
          return;
        }

        const searchRows = getTreeRows("function-search", createFunctionSearchRows);
        renderVirtualTree(elements.callTree, searchRows, "No functions match this search");
        return;
      }

      if (state.functionIndexLoading) {
        clearVirtualTree(elements.callTree);
        appendEmptyTree(elements.callTree, "Loading request flows...");
        return;
      }

      const rows = getTreeRows("calls", () => createHostFunctionRows() ?? []);
      renderVirtualTree(elements.callTree, rows, "No callable functions in graph");
    }

    function createHostFunctionRows() {
      if (!state.functionIndex) {
        return undefined;
      }

      return state.functionIndex.rows.map((row) => ({
        id: row.id,
        label: row.label,
        name: row.metadata?.name || row.label,
        detail: row.detail || "",
        kind: row.metadata?.legacyKind || row.kind,
        nodeId: row.symbolId,
        functionId: row.functionId,
        functionKind: row.functionKind,
        depth: row.depth,
        hasChildren: row.hasChildren,
        expanded: row.expanded
      }));
    }

    function getTreeRows(sectionId, createRows) {
      const cacheKey =
        sectionId +
        ":" +
        String(state.graphRevision) +
        ":" +
        String(state.functionIndexRevision) +
        ":" +
        String(state.functionSearchRevision) +
        ":" +
        String(state.treeRevision);
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
      button.title = row.openSourceOnClick
        ? "Open source: " + row.label + (row.detail ? " · " + row.detail : "")
        : row.nodeId
          ? row.label + " (Enter to open source)"
          : row.label;
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
        if (row.openSourceOnClick && row.nodeId) {
          vscode.postMessage({ type: "node/openSource", payload: { nodeId: row.nodeId } });
          return;
        }
        selectTreeRow(row, row.hasChildren);
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && row.nodeId) {
          event.preventDefault();
          vscode.postMessage({ type: "node/openSource", payload: { nodeId: row.nodeId } });
          return;
        }
        if (event.key === "ArrowRight" && row.hasChildren && !row.expanded) {
          event.preventDefault();
          selectTreeRow(row, true);
        }

        if (event.key === "ArrowLeft" && row.hasChildren && row.expanded) {
          event.preventDefault();
          selectTreeRow(row, true);
        }
      });
      button.addEventListener("dblclick", () => {
        if (row.nodeId) {
          vscode.postMessage({ type: "node/openSource", payload: { nodeId: row.nodeId } });
        }
      });

      return button;
    }

    /** Selects one row and emits at most one Function Index refresh request. */
    function selectTreeRow(row, toggleExpansion) {
      state.selectedTreeId = row.id;
      const selectedFunctionId = getConcreteFunctionId(row);

      if (selectedFunctionId) {
        state.selectedFunctionId = selectedFunctionId;
      }

      if (toggleExpansion) {
        toggleTreeRow(row.id);
      }

      if (row.id.startsWith("function-flows:") && (toggleExpansion || selectedFunctionId)) {
        requestFunctionIndexRefresh(row.id);
      }

      render();
    }

    /** Returns only source-backed callable identities eligible for impact analysis. */
    function getConcreteFunctionId(row) {
      if (!row.functionId || !row.nodeId) {
        return undefined;
      }

      if (["external", "unresolved"].includes(row.kind)) {
        return undefined;
      }

      if (["external", "unresolved"].includes(row.functionKind)) {
        return undefined;
      }

      return row.functionId;
    }

    function appendTreeRow(parent, row) {
      parent.append(createTreeRow(row));
    }

    function requestFunctionIndexRefresh(rowId) {
      if (!rowId.startsWith("function-flows:")) {
        return;
      }

      vscode.postMessage({
        type: "function/index",
        payload: {
          graphVersion: state.graph?.version,
          options: {
            expandedRowIds: Array.from(state.expandedTreeIds),
            selectedFunctionId: state.selectedFunctionId
          }
        }
      });
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
      // Explicit frames keep deeply expanded monorepo import chains off the JS call stack.
      const pending = [{ fileNode, ancestorIds, depth }];

      while (pending.length > 0) {
        const frame = pending.pop();
        const nextAncestorIds = [...frame.ancestorIds, frame.fileNode.id];
        const rowId = "import:" + nextAncestorIds.join(">");
        const relativePath = getTreeNodeLabel(graph, frame.fileNode);
        const children = (index.childrenByImporterId.get(frame.fileNode.id) ?? [])
          .filter((child) => !nextAncestorIds.includes(child.id));
        const hasChildren = frame.fileNode.kind === "file" && children.length > 0;
        const expanded = hasChildren && state.expandedTreeIds.has(rowId);

        rows.push({
          id: rowId,
          label: relativePath,
          name: getFileName(relativePath),
          detail: getTreeNodeDetail(relativePath, frame.fileNode, frame.depth),
          kind: frame.fileNode.kind === "external" ? "external" : frame.depth === 0 ? "entry" : "import",
          nodeId: frame.fileNode.id,
          depth: frame.depth,
          hasChildren,
          expanded
        });

        if (!expanded) {
          continue;
        }

        // Reverse insertion preserves the stable DFS display order of the former traversal.
        for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
          pending.push({
            fileNode: children[childIndex],
            ancestorIds: nextAncestorIds,
            depth: frame.depth + 1
          });
        }
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

    function renderActions() {
      const analysisRunning = state.analysisState === "running";
      const hasGraph = Boolean(state.graph);

      elements.analyzeWorkspace.disabled = false;
      elements.analyzeWorkspace.textContent = analysisRunning ? "Cancel Analysis" : "Analyze Workspace";
      elements.analyzeCurrent.disabled = analysisRunning;
      elements.showWorkspace.disabled = analysisRunning;
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
