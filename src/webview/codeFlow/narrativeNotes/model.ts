/** Pure scenario-to-note projection and non-overlapping placement; source graph positions remain immutable. */
import type { FunctionNarrativeNodeDetail, FunctionNarrativeScenario } from "../../../shared/functionNarratives";

/** The renderer supplies only current, visible graph geometry and its verified identity adapter. */
export type NarrativeNoteNode = { blockId: string; x: number; y: number; width: number; height: number };
export type NarrativeGraphNote = {
  blockId: string;
  node: NarrativeNoteNode;
  /** Original indices retain source-navigation authority and separate repeated visits. */
  visits: Array<{ detail: FunctionNarrativeNodeDetail; nodeIndex: number }>;
};
export type NarrativeGraphNotePlacement = NarrativeGraphNote & { x: number; y: number; width: number; height: number };

/** Joins only this scenario's reached nodes; unknown or other-scenario descriptions never become graph notes. */
export function projectNarrativeGraphNotes(
  scenario: FunctionNarrativeScenario | undefined,
  nodes: readonly NarrativeNoteNode[],
  resolveBlockId: (id: string) => string | undefined = id => id
): NarrativeGraphNote[] {
  const reached = new Set(scenario?.graph?.nodeIds ?? []);
  const layouts = new Map(nodes.map(node => [node.blockId, node]));
  const notes = new Map<string, NarrativeGraphNote>();
  const details = scenario?.nodeDetails ?? [];
  // The portable result contract bounds repeated visits independently of graph size.
  for (let index = 0; index < Math.min(details.length, 900); index++) {
    const detail = details[index];
    if (!reached.has(detail.nodeId)) continue;
    const blockId = resolveBlockId(detail.nodeId);
    const node = blockId && layouts.get(blockId);
    if (!node || !blockId) continue;
    const note = notes.get(blockId) ?? { blockId, node, visits: [] };
    note.visits.push({ detail, nodeIndex: index });
    notes.set(blockId, note);
  }
  return [...notes.values()].sort((left, right) => left.node.y - right.node.y
    || left.visits[0].nodeIndex - right.visits[0].nodeIndex);
}

/** Places a rail outside source geometry; expanded notes push later notes down without moving graph nodes. */
export function layoutNarrativeGraphNotes(
  notes: readonly NarrativeGraphNote[],
  graphWidth: number,
  heights: ReadonlyMap<string, number> = new Map()
): NarrativeGraphNotePlacement[] {
  let bottom = 0;
  return notes.map(note => {
    const height = Math.max(128, Math.min(520, heights.get(note.blockId) ?? 128));
    const y = Math.max(16, note.node.y, bottom);
    bottom = y + height + 16;
    return { ...note, x: graphWidth + 24, y, width: 280, height };
  });
}
