/** Host run lifecycle: validated batches are paged to storage and resumed without reanalyzing completed paths. */
import { FunctionNarrativeError, FunctionNarrativeScenarioRun, parseFunctionNarrative, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import type { FunctionNarrative, FunctionNarrativeContext, FunctionNarrativePageStore } from "../../shared/functionNarratives";

export type FunctionNarrativeStoredPage = { narrative: FunctionNarrative; modelName: string; offset: number; index: number };

/** One session owns one locale and snapshot; RAM retains small page metadata, never all model prose. */
export class FunctionNarrativeScenarioSession {
  private readonly run: FunctionNarrativeScenarioRun;
  private readonly pages: Array<{ modelName: string; offset: number }> = [];
  public constructor(private readonly context: FunctionNarrativeContext, private readonly store: FunctionNarrativePageStore) {
    this.run = new FunctionNarrativeScenarioRun(context);
  }
  public get complete(): boolean { return this.run.complete; }
  public get pageCount(): number { return this.pages.length; }
  public get coverage() {
    return { completed: this.run.completed, discovered: this.run.discovered,
      ...(this.run.exhausted ? { total: this.run.discovered } : {}), complete: this.run.complete,
      sourceLimited: this.context.limited || this.run.incompleteSource };
  }

  /** One bounded provider request. Errors/cancellation leave its exact source batch pending for an explicit retry. */
  public async analyzeNext(provider: FunctionNarrativeProvider, language: "ko" | "en", signal: AbortSignal,
    options: { reselectModel: boolean }): Promise<FunctionNarrativeStoredPage | undefined> {
    const batch = this.run.nextBatch();
    if (!batch) return undefined;
    const response = await provider.generate(batch, language, signal, options);
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    const narrative = parseFunctionNarrative(response.text, batch, language);
    const index = this.pages.length;
    const page = { modelName: response.modelName.slice(0, 100), offset: this.run.completed };
    await this.store.write(index, narrative);
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    this.pages.push(page); this.run.commitBatch();
    return { ...page, index, narrative };
  }

  /** Cache-only reads never contact a model; absent/stale pages cannot authorize source actions. */
  public async readPage(index: number): Promise<FunctionNarrativeStoredPage | undefined> {
    const page = this.pages[index];
    if (!Number.isSafeInteger(index) || index < 0 || !page) return undefined;
    const narrative = await this.store.read(index);
    return narrative ? { ...page, narrative, index } : undefined;
  }
  public dispose(): Promise<void> { return this.store.dispose(); }
}
