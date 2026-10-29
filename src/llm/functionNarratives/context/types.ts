/** Local context contracts: token ceilings and source-free memory observations, independent of process transports. */
export type LocalNarrativeMemory = Readonly<{ totalBytes: number; availableBytes: number }>;
export type LocalNarrativeMemoryProbe = (signal: AbortSignal) => Promise<LocalNarrativeMemory>;
export type LocalNarrativeContextOptions = {
  /** Upper bound, not an eager allocation. Requests start at 8K and grow only when required. */
  maxContextTokens?: number;
  /** Percentage of system memory reserved for the OS and other applications; bounded to 20–30. */
  memoryReservePercent?: number;
  /** OS boundary injection for embedders/tests; never contains source or model output. */
  memory?: LocalNarrativeMemoryProbe;
};
export type LocalNarrativeContextSettings = Readonly<{ maxContextTokens: number; memoryReservePercent: number }>;
