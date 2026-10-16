/** Prefer live editor text while keeping closed-file reads transient and bounded. */
import type * as vscode from "vscode";
import {
  SourceCaptureError, requireSourceActive, type NarrativeSourceReader, type SourceDocumentSnapshot
} from "../../shared/narrativeSources";

/** The native boundary is injected so source authority can be tested without VS Code. */
export type SourceWorkspaceDocuments = Pick<typeof vscode.workspace, "textDocuments">;

/**
 * Uses the same open/dirty-document authority as workspace analysis. It never
 * calls openTextDocument, which would retain all dependency files in the editor.
 */
export class VsCodeNarrativeSourceReader implements NarrativeSourceReader {
  public constructor(private readonly workspace: SourceWorkspaceDocuments,
    private readonly readClosed: NarrativeSourceReader["read"]) {}

  /** Reads an entire document version or a stable local file; never a prefix. */
  public async read(filePath: string, maximumBytes: number, signal: AbortSignal): Promise<SourceDocumentSnapshot | undefined> {
    requireSourceActive(signal);
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new RangeError("Positive source-file byte limit required");
    const open = this.findOpen(filePath);
    if (open) return this.snapshot(open, filePath, maximumBytes, signal);
    const disk = await this.readClosed(filePath, maximumBytes, signal);
    requireSourceActive(signal);
    // A document may open while disk I/O is pending; the editor then owns truth.
    const current = this.findOpen(filePath);
    return current ? this.snapshot(current, filePath, maximumBytes, signal) : disk;
  }

  /** Git revision documents sharing an fsPath must not shadow the working file. */
  private findOpen(filePath: string): vscode.TextDocument | undefined {
    return this.workspace.textDocuments.find((document) => document.uri.scheme === "file" && document.uri.fsPath === filePath);
  }

  /** Capture text and version together before another event can change ownership. */
  private snapshot(document: vscode.TextDocument, filePath: string, maximumBytes: number, signal: AbortSignal): SourceDocumentSnapshot {
    const version = document.version, text = document.getText();
    requireSourceActive(signal);
    if (version !== document.version) throw new SourceCaptureError("source-changed", "Editor document changed while reading");
    if (Buffer.byteLength(text, "utf8") > maximumBytes) throw new SourceCaptureError("context-too-large", "Whole editor source exceeds its byte limit");
    return { filePath, text, revision: "document:" + version };
  }
}
