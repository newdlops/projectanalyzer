/** Real adapter/prompt/stream behavior against the external VS Code API boundary, without network or source execution. */
import assert from "node:assert/strict";
import test from "node:test";
import { createVsCodeFunctionNarrativeProvider, type FunctionNarrativeVsCodeApi } from "../../vscode/functionNarrativeProvider";
import type { FunctionNarrativeContext } from "../../shared/functionNarratives";

const context: FunctionNarrativeContext = { functionName: "describe", language: "kotlin", limited: false,
  snippets: [{ id: "root", role: "function", startLine: 1, endLine: 1, text: 'fun describe() = "ready"', truncated: false }] };

/** The fake covers only external APIs; the production adapter creates prompts and handles responses. */
function apiFixture(options: { missing?: boolean; oversized?: boolean; tokenCount?: number; deny?: boolean } = {}) {
  const observed = { selections: 0, prompts: [] as Array<{ content: string }>, cancellations: 0, disposals: 0, sends: 0 };
  const model = { id: "fixture-small", name: "Fixture LLM", vendor: "fixture", family: "fixture", version: "1", maxInputTokens: 16000,
    async countTokens() { return options.tokenCount ?? 200; },
    async sendRequest(messages: Array<{ content: string }>) {
      observed.sends += 1; observed.prompts = messages;
      if (options.deny) throw Object.assign(new Error("denied"), { code: "NoPermissions" });
      return { text: (async function*() { yield options.oversized ? "x".repeat(24001) : '{"summary":"ready"}'; })() };
    }
  };
  const api = {
    lm: { async selectChatModels() { observed.selections += 1; return options.missing ? [] : [model]; } },
    LanguageModelChatMessage: { User(content: string) { return { content }; } },
    CancellationTokenSource: class { token = { isCancellationRequested: false }; cancel() { observed.cancellations += 1; this.token.isCancellationRequested = true; } dispose() { observed.disposals += 1; } },
    window: { async showQuickPick(items: Array<{ model: unknown }>) { return items[0]; } }
  } as unknown as FunctionNarrativeVsCodeApi;
  return { api, observed };
}

test("VS Code LLM adapter is inert until requested and sends Kotlin snippets through the real prompt builder", async () => {
  const fixture = apiFixture(); const provider = createVsCodeFunctionNarrativeProvider(fixture.api);
  assert.equal(fixture.observed.selections, 0);
  const result = await provider.generate(context, "ko", new AbortController().signal);
  assert.equal(result.modelName, "Fixture LLM"); assert.equal(result.text, '{"summary":"ready"}');
  assert.equal(fixture.observed.sends, 1);
  assert.ok(fixture.observed.prompts[0].content.includes("Korean"));
  assert.ok(fixture.observed.prompts[1].content.includes('fun describe()'));
  assert.equal(fixture.observed.disposals, 1);
});

test("VS Code LLM adapter reports missing models, refused access and token limits without a hidden fallback", async () => {
  for (const [options, code] of [[{ missing: true }, "unavailable"], [{ deny: true }, "denied"], [{ tokenCount: 20000 }, "context-too-large"]] as const) {
    const fixture = apiFixture(options);
    await assert.rejects(createVsCodeFunctionNarrativeProvider(fixture.api).generate(context, "en", new AbortController().signal), { message: code });
    if (code !== "denied") assert.equal(fixture.observed.sends, 0);
  }
});

test("VS Code LLM adapter cancels oversized output and rejects an already cancelled request before model discovery", async () => {
  const fixture = apiFixture({ oversized: true });
  await assert.rejects(createVsCodeFunctionNarrativeProvider(fixture.api).generate(context, "en", new AbortController().signal), { message: "invalid-response" });
  assert.ok(fixture.observed.cancellations >= 1);
  const early = apiFixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(createVsCodeFunctionNarrativeProvider(early.api).generate(context, "en", controller.signal), { message: "cancelled" });
  assert.equal(early.observed.selections, 0);
});
