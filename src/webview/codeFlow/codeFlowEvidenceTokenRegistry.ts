/**
 * Snapshot-local source-range authority for the Function Logic Reader. It
 * exposes opaque tokens to the browser and resolves them only for source files
 * represented by the active immutable graph.
 */

import { randomBytes } from "node:crypto";
import type { CodeFlowEvidenceToken } from "../../protocol/functionLogic";
import { createContentHash } from "../../shared/hash";
import type { ProjectGraph, SourceRange } from "../../shared/types";

const EVIDENCE_TOKEN_PREFIX = "code-evidence:";

/** Host-only location resolved after a token and graph-version check. */
export type CodeFlowEvidenceLocation = {
  filePath: string;
  range: SourceRange;
};

/** Owns statement evidence for exactly one active graph snapshot. */
export class CodeFlowEvidenceTokenRegistry {
  private readonly locationsByToken = new Map<CodeFlowEvidenceToken, CodeFlowEvidenceLocation>();

  private readonly tokensByLocation = new Map<string, CodeFlowEvidenceToken>();

  private allowedFilePaths = new Set<string>();

  /** Random salt prevents evidence tokens from revealing file paths or ranges. */
  private snapshotSalt: string | undefined;

  /** Replaces the complete source-range authority for a newly active graph. */
  public activate(graphVersion: string, graph: ProjectGraph): void {
    this.clear();
    this.snapshotSalt = createContentHash(
      `${graphVersion}\0${randomBytes(24).toString("hex")}`
    );
    this.allowedFilePaths = new Set(graph.nodes.map((node) => node.filePath).filter(Boolean));
  }

  /** Issues one stable opaque token for a validated source location. */
  public createToken(filePath: string, range: SourceRange): CodeFlowEvidenceToken | undefined {
    if (!this.snapshotSalt || !this.allowedFilePaths.has(filePath) || !isValidRange(range)) {
      return undefined;
    }

    const locationKey = createLocationKey(filePath, range);
    const existing = this.tokensByLocation.get(locationKey);
    if (existing) {
      return existing;
    }
    const token = `${EVIDENCE_TOKEN_PREFIX}${createContentHash(
      `${this.snapshotSalt}\0${locationKey}`
    )}` as CodeFlowEvidenceToken;
    const collision = this.locationsByToken.get(token);
    if (collision && createLocationKey(collision.filePath, collision.range) !== locationKey) {
      return undefined;
    }

    const location = { filePath, range: { ...range } };
    this.locationsByToken.set(token, location);
    this.tokensByLocation.set(locationKey, token);
    return token;
  }

  /** Resolves only tokens previously issued in the active graph snapshot. */
  public resolve(token: CodeFlowEvidenceToken): CodeFlowEvidenceLocation | undefined {
    const location = this.locationsByToken.get(token);
    return location
      ? { filePath: location.filePath, range: { ...location.range } }
      : undefined;
  }

  /** Drops graph membership, random salt, and every issued evidence token. */
  public clear(): void {
    this.locationsByToken.clear();
    this.tokensByLocation.clear();
    this.allowedFilePaths.clear();
    this.snapshotSalt = undefined;
  }
}

/** Validates zero-based ordered source coordinates before they reach VS Code. */
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
    || (range.endLine === range.startLine && range.endCharacter >= range.startCharacter);
}

/** Deterministic private identity for deduping equal evidence locations. */
function createLocationKey(filePath: string, range: SourceRange): string {
  return [
    filePath,
    range.startLine,
    range.startCharacter,
    range.endLine,
    range.endCharacter
  ].join("\0");
}
