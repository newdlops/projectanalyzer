/** Deterministic, bounded function-node layout and relationship grouping for the call diagram. */
export function getFunctionCallsGraphSource(): string {
  return /* js */ `
    /** Breadth-first columns keep shared callees unique; cycles never cause recursive expansion. */
    function layoutFunctionCalls(nodes, connections, rootId, maxDepth = 6) {
      const byId = new Map(nodes.map(node => [node.id, node])); const outgoing = new Map();
      for (const edge of connections) { const list = outgoing.get(edge.from) || []; list.push(edge.to); outgoing.set(edge.from, list); }
      const depth = new Map([[rootId, 0]]); const queue = [rootId]; const visited = new Set();
      for (let cursor = 0; cursor < queue.length && cursor < 256; cursor += 1) {
        const id = queue[cursor]; if (visited.has(id)) continue; visited.add(id);
        if (depth.get(id) >= maxDepth) continue;
        for (const target of outgoing.get(id) || []) if (byId.has(target) && !depth.has(target)) { depth.set(target, depth.get(id) + 1); queue.push(target); }
      }
      const columns = new Map();
      for (const node of nodes) { const level = depth.get(node.id) ?? maxDepth; const column = columns.get(level) || []; column.push(node); columns.set(level, column); }
      const rows = Math.max(1, ...[...columns.values()].map(column => column.length));
      const height = Math.max(340, rows * 96 + 56); const positions = new Map();
      for (const [level, column] of columns) column.forEach((node, index) => positions.set(node.id, {
        x: 28 + level * 380, y: 28 + (height - 56) * (index + 0.5) / column.length - 40, width: 204, height: 80, depth: level
      }));
      const reachable = (start, target) => {
        const seen = new Set(); const todo = [{ id: start, depth: 0 }];
        for (let cursor = 0; cursor < todo.length && cursor < 256; cursor += 1) {
          const item = todo[cursor]; if (item.id === target) return true;
          if (seen.has(item.id) || item.depth >= 32) continue; seen.add(item.id);
          for (const next of outgoing.get(item.id) || []) todo.push({ id: next, depth: item.depth + 1 });
        }
        return false;
      };
      const grouped = new Map();
      for (const edge of connections) {
        if (!positions.has(edge.from) || !positions.has(edge.to)) continue;
        const key = edge.from + ">" + edge.to; const group = grouped.get(key) || { key, from: edge.from, to: edge.to, edges: [] };
        group.edges.push(edge); grouped.set(key, group);
      }
      const labels = [];
      const groups = [...grouped.values()].map((group, index) => {
        const from = positions.get(group.from), to = positions.get(group.to); const cycle = reachable(group.to, group.from);
        const sx = from.x + from.width, sy = from.y + from.height / 2, tx = to.x, ty = to.y + to.height / 2;
        let path, labelX, labelY;
        if (group.from === group.to) {
          path = "M " + sx + " " + (sy - 18) + " C " + (sx + 115) + " " + (sy - 110) + " " + (sx + 115) + " " + (sy + 110) + " " + sx + " " + (sy + 18);
          labelX = sx + 16; labelY = sy - 90;
        } else if (to.depth <= from.depth) {
          const route = height - 18 - index % 3 * 12;
          path = "M " + sx + " " + sy + " C " + (sx + 45) + " " + sy + " " + (sx + 45) + " " + route + " " + sx + " " + route
            + " L " + (tx - 16) + " " + route + " Q " + (tx - 24) + " " + route + " " + (tx - 24) + " " + ty + " L " + tx + " " + ty;
          labelX = (sx + tx) / 2 - 62; labelY = route - 42;
        } else {
          labelX = tx - 156; labelY = ty - 26;
          // Put labels near their destination, so fan-out does not halve their
          // vertical spacing. Shared destinations receive separate readable lanes.
          for (let attempt = 0; attempt < 128 && labels.some(label => Math.abs(label.x - labelX) < 140 && Math.abs(label.y - labelY) < 64); attempt += 1) labelY += 64;
          const laneY = labelY + 26, mid = sx + 18;
          path = "M " + sx + " " + sy + " C " + mid + " " + sy + " " + mid + " " + laneY + " " + labelX + " " + laneY
            + " L " + (tx - 20) + " " + laneY + " Q " + (tx - 10) + " " + laneY + " " + (tx - 10) + " " + ty + " L " + tx + " " + ty;
        }
        labels.push({ x: labelX, y: labelY });
        return { ...group, cycle, path, labelX, labelY };
      });
      return { positions, groups, width: Math.max(500, ...[...positions.values()].map(point => point.x + point.width + 156)), height: Math.max(height, ...labels.map(label => label.y + 84)) };
    }
  `;
}
