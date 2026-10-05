/** Resumable source-scenario batching keeps request bounds independent from total function coverage. */
import type { FunctionNarrativeContext, FunctionNarrativeFlowPath } from "../../shared/functionNarratives";
import { createFunctionNarrativeScenarioIterator } from "./scenarioIterator";

/** One run belongs to a captured context and language; an uncommitted batch survives cancellation/error. */
export class FunctionNarrativeScenarioRun {
  public completed = 0;
  public discovered = 0;
  public exhausted = false;
  public incompleteSource = false;
  private readonly iterator: IterableIterator<FunctionNarrativeFlowPath>;
  private lookahead?: FunctionNarrativeFlowPath;
  private pending?: FunctionNarrativeContext;

  public constructor(private readonly context: FunctionNarrativeContext) {
    this.iterator = createFunctionNarrativeScenarioIterator(context)!;
  }

  /** Two paths per response at most; long routes are requested alone without removing their operations. */
  public nextBatch(): FunctionNarrativeContext | undefined {
    if (this.pending) return this.pending;
    const paths: FunctionNarrativeFlowPath[] = [];
    let characters = 0;
    while (paths.length < 2) {
      const candidate = this.lookahead ?? this.readPath();
      this.lookahead = undefined;
      if (!candidate) break;
      const size = JSON.stringify(candidate).length;
      if (paths.length && size + characters > 5000) { this.lookahead = candidate; break; }
      paths.push(candidate); characters += size;
    }
    if (!paths.length) return undefined;
    if (!this.lookahead && !this.exhausted) this.lookahead = this.readPath();
    const { scenarioGraph: _hostGraph, checkedExamples: _examples, ...batch } = this.context;
    this.pending = { ...batch, scenarioBatch: { offset: this.completed },
      sourceFlow: { basis: "source-control-flow", paths, limited: paths.some((path) => path.status === "partial") } };
    return this.pending;
  }

  /** Advances only after independently validated model output has been retained. */
  public commitBatch(): void {
    if (!this.pending) throw new Error("No scenario batch to commit");
    this.completed += this.pending.sourceFlow!.paths.length;
    this.pending = undefined;
  }

  /** Includes a finite symbolic loop pass, never asserts runtime feasibility or external-call results. */
  public get complete(): boolean { return this.exhausted && !this.lookahead && !this.pending; }

  private readPath(): FunctionNarrativeFlowPath | undefined {
    if (this.exhausted) return undefined;
    const next = this.iterator.next();
    if (next.done) { this.exhausted = true; return undefined; }
    this.discovered += 1;
    this.incompleteSource ||= next.value.status === "partial";
    return next.value;
  }
}
