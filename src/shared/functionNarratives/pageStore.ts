/** Storage port for validated scenario pages; generation and browser code never choose a filesystem path. */
import type { FunctionNarrative } from "./types";

/** A fresh store belongs to one immutable function/language run and is disposed with that run. */
export type FunctionNarrativePageStore = {
  write(index: number, narrative: FunctionNarrative): Promise<void>;
  read(index: number): Promise<FunctionNarrative | undefined>;
  dispose(): Promise<void>;
};
export type FunctionNarrativePageStoreFactory = () => FunctionNarrativePageStore;
