/** Storage port for validated scenario pages; generation and browser code never choose a filesystem path. */
import type { FunctionNarrativePage } from "./types";

/** A fresh store belongs to one immutable function/language run and is disposed with that run. */
export type FunctionNarrativePageStore = {
  write(index: number, narrative: FunctionNarrativePage): Promise<void>;
  read(index: number): Promise<FunctionNarrativePage | undefined>;
  dispose(): Promise<void>;
};
export type FunctionNarrativePageStoreFactory = () => FunctionNarrativePageStore;
