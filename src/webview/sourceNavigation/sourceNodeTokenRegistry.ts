/**
 * Snapshot-local source-token registry for sidebar Webview navigation.
 * It bridges tokenized sidebar payloads to analyzer node identities and drops
 * every token mapping when the active graph changes. Raw IDs remain supported
 * for older sidebar payloads until those routes migrate independently.
 */

import { randomBytes } from "node:crypto";
import type { SourceNodeToken } from "../../protocol/sourceNavigation";
import { createContentHash } from "../../shared/hash";
import type { ProjectGraph, SymbolNode } from "../../shared/types";

/** Prefix lets the Host distinguish opaque tokens from legacy graph node IDs. */
const SOURCE_NODE_TOKEN_PREFIX = "source-node:";

/** Owns opaque source references for exactly one immutable sidebar graph snapshot. */
export class SourceNodeTokenRegistry {
  /** Analyzer identities remain indexed only in Extension Host memory. */
  private nodesById = new Map<string, SymbolNode>();

  private nodeIdsByToken = new Map<SourceNodeToken, string>();

  private tokensByNodeId = new Map<string, SourceNodeToken>();

  /** Random per-snapshot salt makes tokens opaque even when an ID is guessable. */
  private snapshotSalt: string | undefined;

  /** Replaces all token mappings when another immutable graph becomes active. */
  public activate(graphVersion: string, graph: ProjectGraph): void {
    this.clear();
    this.snapshotSalt = createContentHash(
      `${graphVersion}\0${randomBytes(24).toString("hex")}`
    );
    this.nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  }

  /** Issues one stable token for a concrete node in the active snapshot. */
  public createToken(nodeId: string): SourceNodeToken | undefined {
    if (!this.snapshotSalt || !this.nodesById.has(nodeId)) {
      return undefined;
    }

    const existing = this.tokensByNodeId.get(nodeId);
    if (existing) {
      return existing;
    }

    const token = `${SOURCE_NODE_TOKEN_PREFIX}${createContentHash(
      `${this.snapshotSalt}\0${nodeId}`
    )}` as SourceNodeToken;
    const collision = this.nodeIdsByToken.get(token);
    if (collision && collision !== nodeId) {
      return undefined;
    }

    this.tokensByNodeId.set(nodeId, token);
    this.nodeIdsByToken.set(token, nodeId);
    return token;
  }

  /** Resolves issued tokens, while retaining legacy active-graph IDs. */
  public resolve(reference: string): SymbolNode | undefined {
    const nodeId = reference.startsWith(SOURCE_NODE_TOKEN_PREFIX)
      ? this.nodeIdsByToken.get(reference as SourceNodeToken)
      : reference;
    return nodeId ? this.nodesById.get(nodeId) : undefined;
  }

  /** Drops the active graph, its random salt, and every issued token. */
  public clear(): void {
    this.nodesById.clear();
    this.nodeIdsByToken.clear();
    this.tokensByNodeId.clear();
    this.snapshotSalt = undefined;
  }
}
