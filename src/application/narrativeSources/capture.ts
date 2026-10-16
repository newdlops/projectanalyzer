/** Iterative complete source acquisition and action-lifetime freshness checks. */
import { createContentHash } from "../../shared/hash";
import type { SourceRange } from "../../shared/types";
import {
  SourceCaptureError, requireSourceActive, type NarrativeSourceGraph, type NarrativeSourceReader,
  type SourceCaptureLimits, type SourceDocumentSnapshot, type NarrativeSourceCapture, type NarrativeSourceLease
} from "../../shared/narrativeSources";
import { readWholeCallableSource, type SourceDeclarationResolver } from "./declaration";
import { extractWholeSourceRange } from "./ranges";
import { createSourceValidation } from "./validation";

/** All requested root/caller/parent IDs are mandatory; dependencies expand lazily. */
export type CaptureNarrativeSourcesOptions = {
  rootIds: readonly string[]; limits: SourceCaptureLimits; signal: AbortSignal;
  graph: NarrativeSourceGraph; reader: NarrativeSourceReader; resolveDeclaration?: SourceDeclarationResolver;
};

/** Compare complete call ranges, preserving two identical expressions at different sites. */
const rangeKey = (range: SourceRange) => [range.startLine, range.startCharacter, range.endLine, range.endCharacter].join(":");

/**
 * Captures every requested declaration and reachable known helper without any
 * row/line/character truncation. Unknown source/depth stays explicit; resource
 * overflow rejects the action. Caller owns and must dispose the resulting lease.
 */
export async function captureNarrativeSources(options: CaptureNarrativeSourcesOptions): Promise<NarrativeSourceLease> {
  const { graph, reader, signal } = options;
  // Resource policy belongs to this action even if settings change during I/O.
  const limits = Object.freeze({ ...options.limits });
  try {
    if (!options.rootIds.length || options.rootIds.some((id) => !id)) throw new TypeError("Source root identities required");
    for (const key of ["maxDepth", "maxDeclarations", "maxSourceBytes", "maxFileBytes", "maxTotalFileBytes", "maxGraphNodes", "maxEdges"] as const) {
      const value = limits[key];
      if (!Number.isSafeInteger(value) || value < (key === "maxDepth" ? 0 : 1)) throw new RangeError("Invalid complete source resource limit");
    }
    if (options.rootIds.length > limits.maxGraphNodes) throw new SourceCaptureError("context-too-large", "Requested source roots exceed graph budget");
  } catch (error) { graph.dispose(); throw error; }
  const files = new Map<string, SourceDocumentSnapshot>(), versions = new Map<string, { filePath: string; revision: string; sha256: string }>();
  const result: NarrativeSourceCapture = { limits: { ...limits }, snapshotId: graph.snapshotId, rootIds: [...options.rootIds], declarations: [], edges: [], gaps: [],
    analysisCaveats: [], complete: false, fileVersions: [], capturedUtf8Bytes: 0, readFileUtf8Bytes: 0, maximumVisitedDepth: 0 };
  const queue = [...new Set(options.rootIds)].map((id) => ({ id, depth: 0, from: undefined as string | undefined, edgeId: undefined as string | undefined }));
  const queued = new Set(queue.map((row) => row.id)), visited = new Set<string>();
  const examined = new Set<string>();
  let examinedEdges = 0;
  const nodeAt = (id: string) => {
    if (!examined.has(id) && examined.size >= limits.maxGraphNodes) throw new SourceCaptureError("context-too-large", "Source graph exceeds node budget");
    examined.add(id); return graph.getNode(id);
  };
  const resolver = options.resolveDeclaration ?? readWholeCallableSource;
  let disposed = false, expectedCaptureHash = "";
  const unchanged = () => {
    if (expectedCaptureHash && createContentHash(JSON.stringify(result)) !== expectedCaptureHash) throw new SourceCaptureError("source-changed", "Owned source capture was mutated");
  };
  const assertCurrent = async (checkSignal: AbortSignal) => {
    if (disposed) throw new SourceCaptureError("disposed", "Source capture lease was disposed");
    requireSourceActive(checkSignal); graph.assertCurrent();
    unchanged();
    for (const previous of versions.values()) {
      const current = await reader.read(previous.filePath, limits.maxFileBytes, checkSignal);
      requireSourceActive(checkSignal);
      if (!current || current.filePath !== previous.filePath || current.revision !== previous.revision || createContentHash(current.text) !== previous.sha256) {
        throw new SourceCaptureError("source-changed", "Captured source version changed");
      }
    }
    graph.assertCurrent(); unchanged();
  };
  try {
    for (let index = 0; index < queue.length; index++) {
      requireSourceActive(signal);
      const task = queue[index]; if (visited.has(task.id)) continue; visited.add(task.id);
      const node = nodeAt(task.id);
      const gap = (reason: NarrativeSourceCapture["gaps"][number]["reason"]) => result.gaps.push({ targetId: task.id, from: task.from, edgeId: task.edgeId, reason });
      if (!node || node.kind === "external") { gap("symbol-unavailable"); continue; }
      const expectedHash = graph.getFileContentHash(node.filePath);
      if (!expectedHash) { gap("source-unbound"); continue; }
      let file = files.get(node.filePath);
      if (!file) {
        file = await reader.read(node.filePath, limits.maxFileBytes, signal); requireSourceActive(signal);
        if (!file) { gap("source-unavailable"); continue; }
        if (file.filePath !== node.filePath || !file.revision || createContentHash(file.text) !== expectedHash) throw new SourceCaptureError("source-changed", "Current file differs from analyzed graph input");
        const bytes = Buffer.byteLength(file.text, "utf8");
        if (bytes > limits.maxFileBytes || result.readFileUtf8Bytes + bytes > limits.maxTotalFileBytes) throw new SourceCaptureError("context-too-large", "Whole source files exceed capture memory budget");
        result.readFileUtf8Bytes += bytes; files.set(node.filePath, file);
        versions.set(node.filePath, { filePath: node.filePath, revision: file.revision, sha256: expectedHash });
      }
      const originalNode = JSON.stringify(node), declaration = resolver(node, file.text);
      if (JSON.stringify(node) !== originalNode) throw new SourceCaptureError("source-changed", "Declaration resolver mutated its source owner");
      if (!declaration) { gap("declaration-unavailable"); continue; }
      const text = extractWholeSourceRange(file.text, declaration.range), bytes = Buffer.byteLength(text, "utf8");
      if (!text) { gap("declaration-unavailable"); continue; }
      if (result.declarations.length >= limits.maxDeclarations || result.capturedUtf8Bytes + bytes > limits.maxSourceBytes) throw new SourceCaptureError("context-too-large", "Whole declarations exceed source capture budget");
      result.capturedUtf8Bytes += bytes; result.maximumVisitedDepth = Math.max(result.maximumVisitedDepth, task.depth);
      result.declarations.push({ graphNode: structuredClone(node), id: node.id, filePath: node.filePath, name: node.name, kind: node.kind, language: node.language,
        range: { ...declaration.range }, text, depth: task.depth, sourceSha256: createContentHash(text), fileSha256: expectedHash });
      result.analysisCaveats.push(...declaration.caveats.map((caveat) => ({ declarationId: node.id, ...caveat })));
      if (declaration.limited || node.metadata?.partial || node.metadata?.sourceCaptureAnalysisLimited) gap("analysis-limited");
      const outgoing = graph.getOutgoingEdges(node.id, limits.maxEdges - examinedEdges);
      examinedEdges += outgoing.length;
      const evidenceOwners = new Map<string, Set<string>>(), coveredCalls = new Set<string>();
      for (const site of declaration.callsites) for (const evidence of site.evidenceRanges) {
        const evidenceKey = rangeKey(evidence), owners = evidenceOwners.get(evidenceKey) ?? new Set<string>();
        owners.add(rangeKey(site.range)); evidenceOwners.set(evidenceKey, owners);
      }
      for (const edge of outgoing) if (edge.kind === "calls") {
        const evidenceKey = edge.range && rangeKey(edge.range), owners = evidenceKey && evidenceOwners.get(evidenceKey);
        const selected = owners && (owners.has(evidenceKey!) ? evidenceKey : owners.size === 1 ? [...owners][0] : undefined);
        if (selected) coveredCalls.add(selected);
        else result.gaps.push({ from: node.id, targetId: edge.targetId, edgeId: edge.id, reason: "call-unrepresented" });
      }
      for (const site of declaration.callsites) if (!coveredCalls.has(rangeKey(site.range))) {
        result.gaps.push({ from: node.id, targetId: "callsite:" + rangeKey(site.range), reason: "call-unrepresented" });
      }
      for (const edge of outgoing) {
        if (edge.sourceId !== node.id) throw new SourceCaptureError("source-changed", "Graph edge belongs to another source owner");
        let follow = ["calls", "references", "uses", "instantiates"].includes(edge.kind);
        if (edge.kind === "contains") follow = ["function", "method", "constructor"].includes(nodeAt(edge.targetId)?.kind ?? "");
        if (!follow) continue;
        result.edges.push(structuredClone(edge));
        if (edge.confidence === "unresolved") { result.gaps.push({ from: node.id, targetId: edge.targetId, edgeId: edge.id, reason: "unresolved" }); continue; }
        if (queued.has(edge.targetId) || visited.has(edge.targetId)) continue;
        if (task.depth >= limits.maxDepth) { result.gaps.push({ from: node.id, targetId: edge.targetId, edgeId: edge.id, reason: "depth-limit" }); continue; }
        queued.add(edge.targetId); queue.push({ id: edge.targetId, depth: task.depth + 1, from: node.id, edgeId: edge.id });
      }
    }
    result.fileVersions = [...versions.values()].map((version) => ({ ...version })); result.complete = result.gaps.length === 0;
    files.clear(); await assertCurrent(signal);
    expectedCaptureHash = createContentHash(JSON.stringify(result));
    return { capture: result, captureSha256: expectedCaptureHash, assertCurrent,
      createValidationReceipt() {
        if (disposed) throw new SourceCaptureError("disposed", "Source capture lease was disposed");
        unchanged(); graph.assertCurrent();
        if (!graph.createValidation) throw new SourceCaptureError("source-changed", "Source graph cannot authorize cached results");
        return createSourceValidation({ graph: graph.createValidation(), reader, versions: [...versions.values()], maximumFileBytes: limits.maxFileBytes });
      },
      dispose() { if (!disposed) { disposed = true; files.clear(); versions.clear(); graph.dispose(); } } };
  } catch (error) { files.clear(); versions.clear(); graph.dispose(); throw error; }
}
