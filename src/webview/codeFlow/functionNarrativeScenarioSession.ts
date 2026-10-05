/** Host run lifecycle: validated batches are paged to storage and resumed without reanalyzing completed paths. */
import { FunctionNarrativeError, FunctionNarrativeScenarioRun, parseFunctionNarrative, initializeFunctionNarrativeNodes,
  createFunctionNarrativeNodeTask, appendFunctionNarrativeNodes, finalizeFunctionNarrativeNodes, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import type { FunctionNarrative, FunctionNarrativeContext, FunctionNarrativePageStore } from "../../shared/functionNarratives";

export type FunctionNarrativeStoredPage = { narrative: FunctionNarrative; modelName: string; offset: number; index: number };

/** One session owns one locale and snapshot; RAM retains small page metadata, never all model prose. */
export class FunctionNarrativeScenarioSession {
  private readonly run: FunctionNarrativeScenarioRun;
  private readonly pages: Array<{ modelName: string; offset: number }> = [];
  /** Small source-node → first saved page index; prose stays on disk. */
  private readonly nodePages = new Map<string, number>();
  /** One bounded unfinished page retains validated primary/node work across cancellation or failure. */
  private pending?: { batch: FunctionNarrativeContext; narrative: FunctionNarrative; modelName: string; scenarioIndex: number };
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

  /** Completes one page through bounded scenario/node requests; retries retain all validated work in that page. */
  public async analyzeNext(provider: FunctionNarrativeProvider, language: "ko" | "en", signal: AbortSignal,
    options: { reselectModel: boolean }): Promise<FunctionNarrativeStoredPage | undefined> {
    const batch = this.run.nextBatch();
    if (!batch) return undefined;
    if (!this.pending) {
      const response = await provider.generate(batch, language, signal, options);
      if (signal.aborted) throw new FunctionNarrativeError("cancelled");
      const narrative = parseFunctionNarrative(response.text, batch, language);
      for (let index = 0; index < narrative.scenarios.length; index++) {
        const path = batch.sourceFlow?.paths[index];
        if (path) initializeFunctionNarrativeNodes(path, narrative.scenarios[index]);
      }
      this.pending = { batch, narrative, modelName: response.modelName, scenarioIndex: 0 };
    }
    const pending = this.pending;
    while (pending.scenarioIndex < pending.narrative.scenarios.length) {
      const scenario = pending.narrative.scenarios[pending.scenarioIndex];
      const path = batch.sourceFlow?.paths[pending.scenarioIndex];
      const task = path && createFunctionNarrativeNodeTask(batch, path, scenario);
      if (task) {
        const response = await provider.generate(task, language, signal, { reselectModel: false });
        if (signal.aborted) throw new FunctionNarrativeError("cancelled");
        const interpreted = parseFunctionNarrative(response.text, task, language);
        appendFunctionNarrativeNodes(task, scenario, interpreted.scenarios[0]);
        continue;
      }
      if (path) finalizeFunctionNarrativeNodes(batch, path, scenario, pending.narrative.summary);
      pending.scenarioIndex++;
    }
    const narrative = pending.narrative;
    const index = this.pages.length;
    const page = { modelName: pending.modelName.slice(0, 100), offset: this.run.completed };
    await this.store.write(index, narrative);
    if (signal.aborted) throw new FunctionNarrativeError("cancelled");
    this.pages.push(page); this.run.commitBatch(); this.pending = undefined;
    for (const scenario of narrative.scenarios) for (const detail of scenario.nodeDetails ?? []) {
      if (!this.nodePages.has(detail.nodeId)) this.nodePages.set(detail.nodeId, index);
    }
    return { ...page, index, narrative };
  }

  /** Cache-only reads never contact a model; absent/stale pages cannot authorize source actions. */
  public async readPage(index: number): Promise<FunctionNarrativeStoredPage | undefined> {
    const page = this.pages[index];
    if (!Number.isSafeInteger(index) || index < 0 || !page) return undefined;
    const narrative = await this.store.read(index);
    return narrative ? { ...page, narrative, index } : undefined;
  }
  /** Cache-only graph lookup can reach a node on any completed page without scanning all stored prose. */
  public readNodePage(nodeId: string): Promise<FunctionNarrativeStoredPage | undefined> {
    const index = this.nodePages.get(nodeId);
    return index === undefined ? Promise.resolve(undefined) : this.readPage(index);
  }
  public dispose(): Promise<void> { this.pending = undefined; this.nodePages.clear(); return this.store.dispose(); }
}
