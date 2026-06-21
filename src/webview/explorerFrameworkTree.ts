/**
 * Browser-injected helpers for the framework semantic tree. These helpers are
 * kept separate from the sidebar shell script so accordion state and tree
 * construction remain independently readable.
 */

/** Returns browser-injected source for framework semantic tree helpers. */
export function getFrameworkTreeBrowserSource(): string {
  return /* js */ `
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
  `;
}
