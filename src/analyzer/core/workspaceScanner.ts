/**
 * Workspace scanner abstraction. The initial scaffold keeps file discovery
 * behind a port so VS Code-specific APIs do not leak into analyzer core logic.
 */

import type { SourceFile } from "../../shared/types";

/** Read-only file system port required by the analyzer pipeline. */
export interface WorkspaceFileSystem {
  getWorkspaceRoot(): string | undefined;
  findSourceFiles(): Promise<SourceFile[]>;
}

/**
 * Discovers source files through the injected file system port.
 */
export class WorkspaceScanner {
  public constructor(private readonly fileSystem: WorkspaceFileSystem) {}

  /**
   * Returns files eligible for analysis according to VS Code settings.
   */
  public async scan(): Promise<SourceFile[]> {
    return this.fileSystem.findSourceFiles();
  }
}
