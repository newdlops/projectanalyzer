/**
 * Bounded child-process output collection for the Rust analyzer adapter.
 * Stdout must remain complete for JSON parsing, while stderr diagnostics keep
 * only a fixed preview and both streams expose aggregate counts for one log.
 */

/** Aggregate output statistics recorded once when an engine process closes. */
export type ProcessOutputSummary = {
  stderrBytes: number;
  stderrChunks: number;
  stderrOmittedBytes: number;
  stdoutBytes: number;
  stdoutChunks: number;
};

/** Complete graph stdout plus bounded diagnostic output and aggregate counts. */
export type CollectedProcessOutput = ProcessOutputSummary & {
  stderrPreview: string;
  stdout: string;
};

const DEFAULT_STDERR_PREVIEW_BYTES = 8 * 1024;

/** Collects stream chunks without emitting one log event per data callback. */
export class ProcessOutputCollector {
  private readonly stdoutChunks: Buffer[] = [];
  private readonly stderrPreviewChunks: Buffer[] = [];
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private stdoutChunkCount = 0;
  private stderrChunkCount = 0;
  private stderrPreviewBytes = 0;

  public constructor(
    private readonly maximumStderrPreviewBytes = DEFAULT_STDERR_PREVIEW_BYTES
  ) {}

  /** Retains complete JSON output and updates counters without logging a chunk. */
  public appendStdout(chunk: Buffer): void {
    this.stdoutChunks.push(chunk);
    this.stdoutBytes += chunk.length;
    this.stdoutChunkCount += 1;
  }

  /** Retains only the leading diagnostic bytes while counting the full stream. */
  public appendStderr(chunk: Buffer): void {
    this.stderrBytes += chunk.length;
    this.stderrChunkCount += 1;
    const remaining = Math.max(0, this.maximumStderrPreviewBytes - this.stderrPreviewBytes);
    if (remaining === 0) {
      return;
    }
    const preview = Buffer.from(chunk.subarray(0, remaining));
    this.stderrPreviewChunks.push(preview);
    this.stderrPreviewBytes += preview.length;
  }

  /** Materializes stdout once, releases chunk references, and returns one result. */
  public take(): CollectedProcessOutput {
    const stdoutBuffer = Buffer.concat(this.stdoutChunks, this.stdoutBytes);
    const stderrBuffer = Buffer.concat(this.stderrPreviewChunks, this.stderrPreviewBytes);
    this.stdoutChunks.length = 0;
    this.stderrPreviewChunks.length = 0;
    return {
      ...this.summary(),
      stderrPreview: stderrBuffer.toString("utf8"),
      stdout: stdoutBuffer.toString("utf8")
    };
  }

  /** Drops retained buffers after spawn errors or disposal paths. */
  public release(): void {
    this.stdoutChunks.length = 0;
    this.stderrPreviewChunks.length = 0;
  }

  /** Returns stable counters without materializing either stream. */
  public summary(): ProcessOutputSummary {
    return {
      stderrBytes: this.stderrBytes,
      stderrChunks: this.stderrChunkCount,
      stderrOmittedBytes: Math.max(0, this.stderrBytes - this.stderrPreviewBytes),
      stdoutBytes: this.stdoutBytes,
      stdoutChunks: this.stdoutChunkCount
    };
  }
}
