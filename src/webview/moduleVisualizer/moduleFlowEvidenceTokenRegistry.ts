/**
 * Snapshot-local source-range authority for Module Flow relation evidence.
 * Raw paths and ranges never cross into browser messages; only issued opaque
 * tokens can be resolved while their immutable graph snapshot remains active.
 */

import { randomBytes } from "node:crypto";
import type { ModuleFlowEvidenceToken } from "../../protocol/moduleFlow";
import { createContentHash } from "../../shared/hash";
import type { ProjectGraph, SourceRange } from "../../shared/types";

const MODULE_FLOW_EVIDENCE_PREFIX = "module-flow-evidence:";

/** Concrete Host location returned only after token and snapshot validation. */
export type ModuleFlowEvidenceLocation = {
  filePath: string;
  range: SourceRange;
};

/** Owns approved relation locations for exactly one Module Flow panel session. */
export class ModuleFlowEvidenceTokenRegistry {
  private readonly locationsByToken = new Map<
    ModuleFlowEvidenceToken,
    ModuleFlowEvidenceLocation
  >();

  private readonly tokensByLocation = new Map<string, ModuleFlowEvidenceToken>();

  /** Files represented by graph or framework metadata are eligible for tokens. */
  private allowedFilePaths = new Set<string>();

  /** Random salt keeps equal paths unlinkable across visualization sessions. */
  private snapshotSalt: string | undefined;

  /** Replaces all source authority for one newly active immutable graph. */
  public activate(graphVersion: string, graph: ProjectGraph): void {
    this.clear();
    this.snapshotSalt = createContentHash(
      `${graphVersion}\0${randomBytes(24).toString("hex")}`
    );
    this.allowedFilePaths = new Set([
      ...graph.nodes.map((node) => node.filePath),
      ...(graph.metadata.frameworkUnits ?? []).map((unit) => unit.filePath),
      ...(graph.metadata.frameworkUnitEdges ?? [])
        .map((edge) => edge.filePath)
        .filter((filePath): filePath is string => Boolean(filePath))
    ].filter(Boolean));
  }

  /** Issues a stable token for one valid, graph-backed location. */
  public createToken(
    filePath: string,
    range: SourceRange
  ): ModuleFlowEvidenceToken | undefined {
    if (!this.snapshotSalt
      || !this.allowedFilePaths.has(filePath)
      || !isValidRange(range)) {
      return undefined;
    }
    const locationKey = createLocationKey(filePath, range);
    const existing = this.tokensByLocation.get(locationKey);
    if (existing) {
      return existing;
    }
    const token = `${MODULE_FLOW_EVIDENCE_PREFIX}${createContentHash(
      `${this.snapshotSalt}\0${locationKey}`
    )}` as ModuleFlowEvidenceToken;
    const collision = this.locationsByToken.get(token);
    if (collision && createLocationKey(collision.filePath, collision.range) !== locationKey) {
      return undefined;
    }
    const location = { filePath, range: { ...range } };
    this.locationsByToken.set(token, location);
    this.tokensByLocation.set(locationKey, token);
    return token;
  }

  /** Resolves only an evidence token issued during the active snapshot. */
  public resolve(token: ModuleFlowEvidenceToken): ModuleFlowEvidenceLocation | undefined {
    const location = this.locationsByToken.get(token);
    return location
      ? { filePath: location.filePath, range: { ...location.range } }
      : undefined;
  }

  /** Drops graph membership, salt, and every issued source location. */
  public clear(): void {
    this.locationsByToken.clear();
    this.tokensByLocation.clear();
    this.allowedFilePaths.clear();
    this.snapshotSalt = undefined;
  }
}

/** Rejects malformed or reversed zero-based source coordinates. */
function isValidRange(range: SourceRange): boolean {
  const coordinates = [
    range.startLine,
    range.startCharacter,
    range.endLine,
    range.endCharacter
  ];
  if (!coordinates.every((value) => Number.isInteger(value) && value >= 0)) {
    return false;
  }
  return range.endLine > range.startLine
    || (range.endLine === range.startLine
      && range.endCharacter >= range.startCharacter);
}

/** Stable private key used only to deduplicate equal Host locations. */
function createLocationKey(filePath: string, range: SourceRange): string {
  return [
    filePath,
    range.startLine,
    range.startCharacter,
    range.endLine,
    range.endCharacter
  ].join("\0");
}
