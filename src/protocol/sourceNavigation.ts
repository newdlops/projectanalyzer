/**
 * Source-navigation identities shared across the Extension Host and Webview.
 * Tokens are snapshot-local opaque references; analyzer node IDs and absolute paths
 * remain inside the Extension Host.
 */

/** Opaque identity resolved only by the Host instance that issued it. */
export type SourceNodeToken = `source-node:${string}`;
