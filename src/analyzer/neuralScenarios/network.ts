/** Small residual MLP: learned dense/tanh layers, analytic gradients, masked loss and Adam. */

export type TrainingRow = { x: number[]; y: Array<number | undefined> };

/** Reproducible PRNG shared by initialization, sampling and diagnostic comparisons. */
export function createNeuralRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let value = Math.imul(state ^ state >>> 15, 1 | state); value ^= value + Math.imul(value ^ value >>> 7, 61 | value); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}

/** Owns request-local weights; neither constructors nor predictions update training state. */
export class ScenarioNetwork {
  public readonly weights: Float64Array;
  private readonly hiddenBias: number;
  private readonly outputWeights: number;
  private readonly linearWeights: number;
  private readonly outputBias: number;

  public constructor(public readonly inputs: number, public readonly outputs: number, random = createNeuralRandom(42), private readonly hidden = 24) {
    this.hiddenBias = hidden * inputs;
    this.outputWeights = this.hiddenBias + hidden;
    this.linearWeights = this.outputWeights + outputs * hidden;
    this.outputBias = this.linearWeights + outputs * inputs;
    this.weights = new Float64Array(this.outputBias + outputs);
    for (let index = 0; index < this.weights.length; index += 1) {
      if (index >= this.hiddenBias && index < this.outputWeights || index >= this.outputBias) continue;
      this.weights[index] = (random() * 2 - 1) * (index < this.hiddenBias ? Math.sqrt(3 / inputs) : 0.05);
    }
  }

  private activations(x: number[]): number[] {
    return Array.from({ length: this.hidden }, (_, h) => {
      let sum = this.weights[this.hiddenBias + h];
      for (let i = 0; i < this.inputs; i += 1) sum += this.weights[h * this.inputs + i] * x[i];
      return Math.tanh(sum);
    });
  }

  /** Returns standardized comparison margins using the current learned parameters. */
  public predict(x: number[]): number[] {
    const activation = this.activations(x);
    return Array.from({ length: this.outputs }, (_, o) => {
      let sum = this.weights[this.outputBias + o];
      for (let h = 0; h < this.hidden; h += 1) sum += this.weights[this.outputWeights + o * this.hidden + h] * activation[h];
      for (let i = 0; i < this.inputs; i += 1) sum += this.weights[this.linearWeights + o * this.inputs + i] * x[i];
      return sum;
    });
  }

  /** Differentiates one learned margin with respect to the normalized input tuple. */
  public inputGradient(x: number[], output: number): number[] {
    const activation = this.activations(x);
    return x.map((_, i) => {
      let value = this.weights[this.linearWeights + output * this.inputs + i];
      for (let h = 0; h < this.hidden; h += 1) value += this.weights[this.outputWeights + output * this.hidden + h]
        * (1 - activation[h] ** 2) * this.weights[h * this.inputs + i];
      return value;
    });
  }

  /** Mean squared error over observed labels; an absent label contributes no target or gradient. */
  public loss(rows: TrainingRow[]): number {
    let sum = 0; let count = 0;
    for (const row of rows) {
      const predicted = this.predict(row.x);
      row.y.forEach((target, output) => { if (target !== undefined) { sum += (predicted[output] - target) ** 2; count += 1; } });
    }
    return count ? sum / count : 0;
  }

  /** Trains with masked full-batch gradients; held-out data is never passed here. */
  public async train(rows: TrainingRow[], epochs: number, signal?: AbortSignal): Promise<void> {
    const first = new Float64Array(this.weights.length); const second = first.slice();
    for (let epoch = 1; epoch <= epochs; epoch += 1) {
      if (signal?.aborted) throw new Error("neural-cancelled");
      const gradient = new Float64Array(this.weights.length); let count = 0;
      for (const row of rows) {
        const activation = this.activations(row.x); const predicted = this.predict(row.x);
        const hiddenGradient = new Float64Array(this.hidden);
        row.y.forEach((target, o) => {
          if (target === undefined) return;
          count += 1; const delta = 2 * (predicted[o] - target);
          gradient[this.outputBias + o] += delta;
          for (let i = 0; i < this.inputs; i += 1) gradient[this.linearWeights + o * this.inputs + i] += delta * row.x[i];
          for (let h = 0; h < this.hidden; h += 1) {
            gradient[this.outputWeights + o * this.hidden + h] += delta * activation[h];
            hiddenGradient[h] += delta * this.weights[this.outputWeights + o * this.hidden + h] * (1 - activation[h] ** 2);
          }
        });
        for (let h = 0; h < this.hidden; h += 1) {
          gradient[this.hiddenBias + h] += hiddenGradient[h];
          for (let i = 0; i < this.inputs; i += 1) gradient[h * this.inputs + i] += hiddenGradient[h] * row.x[i];
        }
      }
      if (!count) return;
      for (let i = 0; i < this.weights.length; i += 1) {
        const g = Math.max(-10, Math.min(10, gradient[i] / count));
        first[i] = 0.9 * first[i] + 0.1 * g; second[i] = 0.999 * second[i] + 0.001 * g * g;
        this.weights[i] -= 0.025 * (first[i] / (1 - 0.9 ** epoch)) / (Math.sqrt(second[i] / (1 - 0.999 ** epoch)) + 1e-8);
      }
      // Yield frequently enough for panel cancellation and Host message delivery.
      if (epoch % 4 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
}
