/**
 * Browser-portable frame scheduler for coalescing Module Flow visual updates.
 *
 * Callers own dirty flags; this class guarantees that many schedule requests
 * before one animation frame produce one commit and supports lifecycle cancel.
 */

export type ModuleFlowRequestFrame = (callback: FrameRequestCallback) => number;
export type ModuleFlowCancelFrame = (handle: number) => void;

/** Coalesces pending graph, selection, resize, and zoom writes into one frame. */
export class ModuleFlowFrameScheduler {
  private frameHandle: number | undefined;
  private disposed = false;

  public constructor(
    private readonly requestFrame: ModuleFlowRequestFrame,
    private readonly cancelFrame: ModuleFlowCancelFrame,
    private readonly commit: () => void
  ) {}

  /** Requests a commit unless one is already queued for the next frame. */
  public schedule(): void {
    if (this.disposed || this.frameHandle !== undefined) return;
    this.frameHandle = this.requestFrame(() => {
      this.frameHandle = undefined;
      if (!this.disposed) this.commit();
    });
  }

  /** Cancels a pending callback and permanently disables this scheduler. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameHandle !== undefined) this.cancelFrame(this.frameHandle);
    this.frameHandle = undefined;
  }
}

/** Serializes the scheduler without importing extension-host code in Webviews. */
export function getModuleFlowFrameSchedulerBrowserSource(): string {
  return ModuleFlowFrameScheduler.toString();
}
