/**
 * Browser-only compound-region helpers for Function Logic. They derive
 * decorative body bounds from opaque parent-block identities after the final
 * graph layout, so attached child functions never leave stale group geometry.
 */

/** Returns CSP-safe helpers for rendering control owners around their bodies. */
export function getFunctionLogicCompoundGroupBrowserSource(): string {
  return /* js */ `
    const LOGIC_COMPOUND_PADDING_X = 14;
    const LOGIC_COMPOUND_PADDING_TOP = 20;
    const LOGIC_COMPOUND_PADDING_BOTTOM = 14;

    /**
     * Computes one owner-plus-descendants rectangle with an explicit stack,
     * visited guard, and no assumptions about source or layout order.
     */
    function createLogicCompoundGroups(blocks, nodeLayoutsByBlockId) {
      const blocksById = new Map(blocks.map((block) => [block.id, block]));
      const childrenByParentId = new Map();

      for (const block of blocks) {
        if (!block.parentBlockId || block.parentBlockId === block.id
          || !blocksById.has(block.parentBlockId)) {
          continue;
        }
        const children = childrenByParentId.get(block.parentBlockId) || [];
        children.push(block.id);
        childrenByParentId.set(block.parentBlockId, children);
      }

      const groups = [];
      for (const owner of blocks) {
        const directChildren = childrenByParentId.get(owner.id) || [];
        const ownerLayout = nodeLayoutsByBlockId.get(owner.id);
        if (directChildren.length === 0 || !ownerLayout) continue;

        const pending = [...directChildren];
        const visited = new Set([owner.id]);
        const memberLayouts = [ownerLayout];
        while (pending.length > 0) {
          const memberId = pending.pop();
          if (!memberId || visited.has(memberId)) continue;
          visited.add(memberId);
          const memberLayout = nodeLayoutsByBlockId.get(memberId);
          if (memberLayout) memberLayouts.push(memberLayout);
          const children = childrenByParentId.get(memberId) || [];
          for (let index = children.length - 1; index >= 0; index -= 1) {
            pending.push(children[index]);
          }
        }

        const left = Math.min(...memberLayouts.map((layout) => layout.x));
        const top = Math.min(...memberLayouts.map((layout) => layout.y));
        const right = Math.max(...memberLayouts.map((layout) => layout.x + layout.width));
        const bottom = Math.max(...memberLayouts.map((layout) => layout.y + layout.height));
        groups.push({
          ownerBlockId: owner.id,
          kind: owner.kind,
          depth: Number.isFinite(Number(owner.depth)) ? Number(owner.depth) : 0,
          memberBlockIds: [...visited],
          x: left - LOGIC_COMPOUND_PADDING_X,
          y: top - LOGIC_COMPOUND_PADDING_TOP,
          width: right - left + LOGIC_COMPOUND_PADDING_X * 2,
          height: bottom - top + LOGIC_COMPOUND_PADDING_TOP
            + LOGIC_COMPOUND_PADDING_BOTTOM
        });
      }

      return groups.sort((left, right) =>
        left.depth - right.depth
          || (right.width * right.height) - (left.width * left.height)
          || left.ownerBlockId.localeCompare(right.ownerBlockId)
      );
    }

    /** Creates one pointer-transparent layer behind edges and statement nodes. */
    function createLogicCompoundGroupLayer(groups, blocksById) {
      const layer = document.createElement("div");
      layer.className = "logic-compound-group-layer";
      layer.setAttribute("aria-hidden", "true");

      renderLogicCompoundGroupLayer(layer, groups, blocksById);
      return layer;
    }

    /** Replaces decorative frames while preserving the stable graph layer. */
    function renderLogicCompoundGroupLayer(layer, groups, blocksById) {
      layer.replaceChildren();

      for (const group of groups) {
        const owner = blocksById.get(group.ownerBlockId);
        if (!owner) continue;
        const frame = document.createElement("div");
        const caption = document.createElement("span");
        frame.className = "logic-compound-group logic-compound-" + group.kind
          + " logic-compound-depth-" + normalizeLogicVisualDepth(group.depth);
        frame.setAttribute("data-owner-block-id", group.ownerBlockId);
        frame.style.setProperty("left", group.x + "px");
        frame.style.setProperty("top", group.y + "px");
        frame.style.setProperty("width", group.width + "px");
        frame.style.setProperty("height", group.height + "px");
        caption.className = "logic-compound-caption";
        caption.textContent = formatLogicKind(owner.kind).toUpperCase() + " BODY";
        frame.append(caption);
        layer.append(frame);
      }
    }
  `;
}
