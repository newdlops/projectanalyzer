/** VS Code API contract tests cover selection, cancellation, access errors and bounded streaming. */
import assert from "node:assert/strict";
import test from "node:test";
import type { ScenarioInputProvider } from "../../application/scenarioInputs";

/** Loads the real adapter with only the VS Code boundary replaced by a fixture. */
function setup(options: { empty?: boolean; cancelPick?: boolean; errorCode?: string; fragment?: string; onStream?: () => void } = {}) {
  const calls: string[] = [];
  const tokens: Array<{ isCancellationRequested: boolean }> = [];
  class CancellationTokenSource {
    public token = { isCancellationRequested: false };
    public constructor() { tokens.push(this.token); }
    public cancel(): void { this.token.isCancellationRequested = true; }
    public dispose(): void { calls.push("dispose"); }
  }
  const model = { name: "Fixture", vendor: "test", maxInputTokens: 1000,
    async countTokens() { calls.push("count"); return 10; },
    async sendRequest(messages: unknown[]) {
      calls.push("send"); assert.deepEqual(messages, [{ role: "user", text: "bounded context" }]);
      if (options.errorCode) throw { code: options.errorCode };
      return { text: (async function* () { options.onStream?.(); yield options.fragment ?? '{"scenarios":[]}'; })() };
    } };
  const vscode = { CancellationTokenSource,
    lm: { async selectChatModels() { calls.push("list"); return options.empty ? [] : [model]; } },
    window: { async showQuickPick(items: Array<{ model: typeof model }>) { calls.push("pick"); return options.cancelPick ? undefined : items[0]; } },
    LanguageModelChatMessage: { User(text: string) { return { role: "user", text }; } }
  };
  const loader = require("node:module") as { _load(request: string, ...args: unknown[]): unknown };
  const original = loader._load;
  const path = require.resolve("../../vscode/scenarioInputModelProvider");
  delete require.cache[path];
  let provider: ScenarioInputProvider;
  try {
    loader._load = (request, ...args) => request === "vscode" ? vscode : original.call(loader, request, ...args);
    provider = (require(path) as { createScenarioInputModelProvider(): ScenarioInputProvider }).createScenarioInputModelProvider();
  } finally { loader._load = original; delete require.cache[path]; }
  return { provider, calls, tokens };
}

test("adapter is inert until an explicit request chooses a model", async () => {
  const fixture = setup(); assert.deepEqual(fixture.calls, []);
  const result = await fixture.provider.suggest("bounded context", "ko", new AbortController().signal);
  assert.equal(result.modelName, "Fixture"); assert.equal(result.text, '{"scenarios":[]}');
  assert.deepEqual(fixture.calls, ["list", "pick", "count", "send", "dispose"]);
});

test("missing models and dismissed selection send no source to a model", async () => {
  for (const options of [{ empty: true }, { cancelPick: true }]) {
    const fixture = setup(options);
    await assert.rejects(fixture.provider.suggest("bounded context", "en", new AbortController().signal), options.empty ? /unavailable/u : /cancelled/u);
    assert.ok(!fixture.calls.includes("send")); assert.equal(fixture.calls.at(-1), "dispose");
  }
});

test("access and missing-model errors become finite product states", async () => {
  for (const [errorCode, expected] of [["NoPermissions", "denied"], ["NotFound", "unavailable"], ["Blocked", "failed"]]) {
    const fixture = setup({ errorCode });
    await assert.rejects(fixture.provider.suggest("bounded context", "en", new AbortController().signal), new RegExp(expected));
  }
});

test("stream limits and cancellation release the model request", async () => {
  const oversized = setup({ fragment: "x".repeat(48001) });
  await assert.rejects(oversized.provider.suggest("bounded context", "en", new AbortController().signal), /invalid-response/u);
  assert.equal(oversized.tokens[0].isCancellationRequested, true);
  const controller = new AbortController();
  const cancelled = setup({ onStream: () => controller.abort() });
  await assert.rejects(cancelled.provider.suggest("bounded context", "en", controller.signal), /cancelled/u);
  assert.equal(cancelled.tokens[0].isCancellationRequested, true);
  const alreadyCancelled = setup();
  await assert.rejects(alreadyCancelled.provider.suggest("bounded context", "en", controller.signal), /cancelled/u);
  assert.ok(!alreadyCancelled.calls.includes("list"));
});
