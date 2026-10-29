/** Regression cases for whole-function purpose provenance, prose roles and conservative source grounding. */
import assert from "node:assert/strict";
import test from "node:test";
import { readNarrativeQualityFacts, assertFunctionNarrativeQuality, createFunctionNarrativePurposeTask,
  parseFunctionNarrativePurpose, findFunctionNarrativeLiteralReturn, buildFunctionNarrativeQualityReading, type FunctionNarrativeProvider } from "../../application/functionNarratives";
import type { FunctionNarrative, FunctionNarrativeContext } from "../../shared/functionNarratives";
import { createLocalNarrativeQualitySchema } from "../../llm/functionNarratives/quality";
import { createWholeNarrativeRootHost } from "../helpers/wholeNarrativeRootHost";
import { wholeRootReply } from "../helpers/wholeNarrativeHost";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalFunctionNarrativeProvider } from "../../llm/functionNarratives";
import { ModelTaskManager } from "../../shared/modelTasks";
import { createLocalNarrativeWire } from "../../llm/functionNarratives/localWire";
import { normalizeLocalNarrativeResponse } from "../../llm/functionNarratives/localResponse";
import { createLocalNarrativeSchema } from "../../llm/functionNarratives/responseSchema";

function context(): FunctionNarrativeContext {
  return { functionName: "chooseSide", language: "typescript", detailLevel: "rich", limited: false,
    parameters: [{ name: "active", type: "boolean" }], snippets: [
      { id: "root", role: "function", startLine: 10, endLine: 14, truncated: false,
        text: 'function chooseSide(active: boolean): string {\n const item = echo("label");\n if (active) return "left";\n return "right";\n}' },
      { id: "helper", role: "helper", startLine: 20, endLine: 22, truncated: false,
        text: 'function echo(value: string): string {\n return value;\n}' }
    ], sourceEvidence: { complete: true, declarations: [], analysisCaveats: [], gaps: [],
      relations: [{ from: "root", to: "helper", kind: "calls", confidence: "exact" }] } };
}
function narrative(): FunctionNarrative {
  return { summary: 'Return "left" when active is true and "right" otherwise, after calling echo.', limitations: [], scenarios: [{
    title: "Selected source route", when: [], outcome: "Return a string", assumptions: [],
    explanation: "The helper returns its argument unchanged before the Boolean branch.", steps: [{
      code: 'const item = echo("label");', text: "Call echo and bind its return value.", syntax: "A const declaration binds the call result to a local name.",
      reason: "The helper returns the supplied string argument.", effect: "The local item holds the argument value.",
      source: { snippetId: "root", startLine: 11, endLine: 11 }
    }] }] };
}

test("quality facts cover all source returns and exact identity helpers independently of the current route", () => {
  const source = context();
  source.sourceFlow = { basis: "source-control-flow", paths: [], limited: false };
  const facts = readNarrativeQualityFacts(source);
  assert.equal(facts.closed, true);
  assert.deepEqual(facts.identityCalls, [{ name: "echo", parameter: "value", argumentIndex: 0 }]);
  assert.equal(facts.identityInvocations[0].argumentJson, JSON.stringify("label"));
  assert.equal(facts.identityInvocations[0].followingCondition, "active");
  assert.deepEqual(new Set(facts.returns.map(item => item.literal)), new Set(["left", "right"]));
  assert.deepEqual(facts.returns.find(item => item.literal === "right")!.conditions, ["active = false"]);
  const task = createFunctionNarrativePurposeTask({ ...source, nodePreparation: true, summaryTask: { inputs: [], steps: [], completed: [], omittedValues: 0 } });
  assert.equal(task.sourceFlow, undefined); assert.equal(task.summaryTask, undefined); assert.equal(task.nodePreparation, undefined);
  assert.deepEqual(task.snippets, source.snippets); assert.equal(task.functionPurposeTask, true);
});

test("missing or ambiguous implementations and unsupported effects never become a closed source proof", () => {
  for (const change of [
    (value: FunctionNarrativeContext) => { value.snippets[1].text = 'function echo(value: string): string { return fetch(value); }'; },
    (value: FunctionNarrativeContext) => { value.sourceEvidence!.relations[0].confidence = "inferred"; },
    (value: FunctionNarrativeContext) => { value.snippets[1].truncated = true; },
    (value: FunctionNarrativeContext) => { value.snippets[0].text = value.snippets[0].text.replace('echo("label")', 'state.value'); },
    (value: FunctionNarrativeContext) => { value.snippets[0].text = value.snippets[0].text.replace('active: boolean', 'active: boolean = probe()'); },
    (value: FunctionNarrativeContext) => { value.snippets.push({ ...value.snippets[1], id: "duplicate" }); }
  ]) { const source = context(); change(source); assert.equal(readNarrativeQualityFacts(source).closed, false); }
});

test("a short first-route purpose is rejected and both English and Korean whole-function purposes qualify", () => {
  const source = createFunctionNarrativePurposeTask(context());
  assert.throws(() => parseFunctionNarrativePurpose(JSON.stringify({ summary: 'Return "left" when active is true.' }), source, "en"), { detailCode: "quality-purpose-coverage" });
  assert.equal(parseFunctionNarrativePurpose(JSON.stringify({ summary: narrative().summary }), source, "en"), narrative().summary);
  assert.doesNotThrow(() => parseFunctionNarrativePurpose(JSON.stringify({ summary: 'echo 호출 후 active가 참이면 "left", 거짓이면 "right"를 반환합니다.' }), source, "ko"));
});

test("syntax must explain semantics even when the model copies a surrounding if line instead of the canonical expression", () => {
  const source = context(), reading = narrative();
  reading.scenarios[0].steps[0].syntax = reading.scenarios[0].steps[0].code;
  assert.throws(() => assertFunctionNarrativeQuality(reading, source), { detailCode: "quality-code-only-syntax" });
  Object.assign(reading.scenarios[0].steps[0], { code: "active", syntax: 'if (active) return "left";', source: { snippetId: "root", startLine: 12, endLine: 12 } });
  assert.throws(() => assertFunctionNarrativeQuality(reading, source), { detailCode: "quality-code-only-syntax" });
  reading.scenarios[0].steps[0].syntax = "The if statement selects its return only when the condition is true.";
  assert.doesNotThrow(() => assertFunctionNarrativeQuality(reading, source));
});

test("known input choices are excluded from assumptions while missing helper implementations retain genuine unknowns", () => {
  const source = context(), reading = narrative();
  reading.scenarios[0].assumptions = ["The caller supplies active as true in this scenario."];
  assert.throws(() => assertFunctionNarrativeQuality(reading, source), { detailCode: "quality-known-assumption" });
  const schema = { properties: { assumptions: { type: "array" }, limitations: { type: "array" } } };
  const result = createLocalNarrativeQualitySchema(schema, source) as typeof schema;
  assert.deepEqual(result.properties.assumptions, { const: [] }); assert.deepEqual(schema.properties.assumptions, { type: "array" });
  source.sourceEvidence!.relations = []; reading.scenarios[0].assumptions = ["The omitted helper must return normally before the branch is reached."];
  assert.doesNotThrow(() => assertFunctionNarrativeQuality(reading, source));
  assert.deepEqual(createLocalNarrativeQualitySchema(schema, source), schema);
});

test("identity helpers cannot acquire retrieval behavior from labels; actual unknown calls are not globally blacklisted", () => {
  const source = context(), reading = narrative();
  reading.scenarios[0].steps[0].text = "The helper retrieves the initial source item.";
  assert.throws(() => assertFunctionNarrativeQuality(reading, source), { detailCode: "quality-unsupported-retrieval" });
  reading.scenarios[0].steps[0].text = "The helper returns its argument without fetching data.";
  assert.doesNotThrow(() => assertFunctionNarrativeQuality(reading, source));
  reading.scenarios[0].steps[0].text = "It does not mutate inputs and retrieves an item.";
  assert.throws(() => assertFunctionNarrativeQuality(reading, source), { detailCode: "quality-unsupported-retrieval" });
  source.sourceEvidence!.relations = []; reading.scenarios[0].steps[0].text = "The unknown helper may fetch data; its implementation is missing.";
  assert.doesNotThrow(() => assertFunctionNarrativeQuality(reading, source));
});

test("literal results reject additional encoding quotes and an absent else arm cannot be invented", () => {
  const source = context(), reading = narrative(), step = reading.scenarios[0].steps[0];
  Object.assign(step, { code: 'return "right";', source: { snippetId: "root", startLine: 13, endLine: 13 },
    syntax: "A return sends the literal string to the caller.", values: [{ name: "result", before: "not returned", after: JSON.stringify(JSON.stringify("right")) }] });
  assert.throws(() => assertFunctionNarrativeQuality(reading, source), { detailCode: "quality-literal-result" });
  step.values![0].after = JSON.stringify("right");
  assert.doesNotThrow(() => assertFunctionNarrativeQuality(reading, source));
  step.effect = "The else block runs.";
  assert.throws(() => assertFunctionNarrativeQuality(reading, source), { detailCode: "quality-invented-else" });
  step.effect = "There is no else block.";
  assert.doesNotThrow(() => assertFunctionNarrativeQuality(reading, source));
  source.snippets[0].text = source.snippets[0].text.replace('if (active) return "left";\n return "right";', 'if (active) return "left"; else return "right";');
  step.effect = "The else block runs.";
  assert.doesNotThrow(() => assertFunctionNarrativeQuality(reading, source));
});

test("source-owned literal-return readings encode the raw value once and retain exact return semantics", () => {
  const source = context();
  source.returnTypeText = "string"; source.valueNames = ["active", "result"];
  const target = { kind: "return", code: 'return "right";', confidence: "exact" as const,
    source: { snippetId: "root", startLine: 13, endLine: 13 } };
  source.nodeTask = { frame: { when: [], outcome: "return" }, example: { inputs: [{ name: "active", json: "false" }], result: "null" },
    targets: [target], reading: { explanation: "The false path reaches the final return.", priorState: [] } };
  const schema = createLocalNarrativeQualitySchema(createLocalNarrativeSchema(source), source) as any;
  assert.deepEqual(schema.properties.steps.items[0].properties.values.items[0].properties.after, { const: "right" });
  const reason = schema.properties.steps.items[0].properties.reason.const;
  assert.match(reason, /literal "right"/u);
  const wire = createLocalNarrativeWire(schema);
  const reply = wire.decode(JSON.stringify({ steps: [{ code: target.code, values: [{ name: "result" }] }] }));
  const normalized = JSON.parse(normalizeLocalNarrativeResponse(reply, source));
  assert.equal(normalized.steps[0].values[0].after, JSON.stringify("right"));
  assert.equal(normalized.steps[0].reason, reason);
});

test("a helper named fetch remains callable without assigning retrieval meaning to it", () => {
  const source = context(), reading = narrative();
  source.snippets = source.snippets.map(snippet => ({ ...snippet, text: snippet.text.replaceAll("echo", "fetch") }));
  reading.scenarios[0].steps[0].text = "Call fetch with the literal argument.";
  assert.doesNotThrow(() => assertFunctionNarrativeQuality(reading, source));
});

test("source return matching preserves spaces inside literals and does not constrain nonfinite numeric syntax", () => {
  const source = context();
  source.snippets[0].text = source.snippets[0].text.replace('"left"', '"left side"').replace('"right"', '"leftside"');
  const facts = readNarrativeQualityFacts(source);
  assert.equal(findFunctionNarrativeLiteralReturn(facts, 'return "leftside";')!.literalJson, JSON.stringify("leftside"));
  assert.equal(findFunctionNarrativeLiteralReturn(facts, 'return "left side";')!.literalJson, JSON.stringify("left side"));
  source.snippets[0].text = 'function chooseSide(active: boolean): number { return 1e999; }';
  assert.equal(findFunctionNarrativeLiteralReturn(readNarrativeQualityFacts(source), 'return 1e999;'), undefined);
});

test("constant and contradictory Boolean routes cannot force unreachable outcomes into a whole purpose", () => {
  const source = context();
  source.snippets[0].text = 'function chooseSide(active: boolean): string { if (false) return "dead"; if (active) return "left"; if (active) return "also-dead"; return "right"; }';
  assert.deepEqual(new Set(readNarrativeQualityFacts(source).returns.map(item => item.literal)), new Set(["left", "right"]));
  assert.doesNotThrow(() => parseFunctionNarrativePurpose(JSON.stringify({ summary: narrative().summary }), source, "en"));
});

test("Boolean branches are not runtime type checks and a later input decision cannot cause an earlier literal helper call", () => {
  const source = context(), reading = narrative();
  reading.summary = 'The function type-checks active and returns left or right.';
  assert.throws(() => assertFunctionNarrativeQuality(reading, source), { detailCode: "quality-invented-type-check" });
  reading.summary = narrative().summary;
  reading.scenarios[0].steps[0].reason = "Because active is true, echo receives the literal argument.";
  assert.throws(() => assertFunctionNarrativeQuality(reading, source), { detailCode: "quality-call-order" });
  reading.scenarios[0].steps[0].reason = "The literal argument is returned unchanged before active is tested.";
  assert.doesNotThrow(() => assertFunctionNarrativeQuality(reading, source));
  assert.throws(() => parseFunctionNarrativePurpose(JSON.stringify({ summary: 'Return "left" when activ is true and "right" otherwise.' }), source, "en"), { detailCode: "quality-purpose-condition" });
});

test("identity literal bindings and unchanged Boolean inputs retain values instead of generated explanatory rows", () => {
  const source = context(); source.valueNames = ["active", "item", "condition", "result"];
  const call = { kind: "mutation", code: 'const item = echo("label");', writeTargets: ["item"], confidence: "exact" as const,
    source: { snippetId: "root", startLine: 11, endLine: 11 } };
  const condition = { kind: "condition", code: "active", confidence: "exact" as const,
    branch: { outcome: "true" as const, confidence: "exact" as const }, source: { snippetId: "root", startLine: 12, endLine: 12 } };
  source.sourceFlow = { basis: "source-control-flow", limited: false, paths: [{ confidence: "exact", status: "source-terminal", steps: [call, condition] }] };
  source.nodeTask = { frame: { when: [], outcome: "return" }, example: { inputs: [{ name: "active", json: "true" }], result: "null" },
    targets: [call, condition], reading: { explanation: "The call precedes the Boolean test.", priorState: [] } };
  const schema = createLocalNarrativeQualitySchema(createLocalNarrativeSchema(source), source);
  assert.equal((schema as any).properties.steps.items[0].properties.reason.type, "string", "identity call prose remains model-authored");
  const wire = createLocalNarrativeWire(schema);
  const steps = [call, condition].map(target => ({ code: target.code, text: "Read this source operation.", syntax: "This statement uses the supplied value.",
    reason: "The source fixes the operand.", effect: "The next operation follows.", ...(target === call ? { values: [{ name: "item" }] } : {}) }));
  const normalized = JSON.parse(normalizeLocalNarrativeResponse(wire.decode(JSON.stringify({ steps })), source));
  assert.equal(normalized.steps[0].values[0].after, "label");
  assert.deepEqual(normalized.steps[1].values, [{ name: "active", before: "true", after: "true" }]);
});

test("a whole Boolean/literal recipe preserves call order and both return directions, and refuses extra or inferred work", () => {
  const source = context();
  source.sourceFlow = { basis: "source-control-flow", limited: false, paths: [{ confidence: "exact", status: "source-terminal", steps: [] }] };
  source.summaryTask = { inputs: [{ name: "active", json: "false" }], steps: [], completed: [], omittedValues: 0 };
  const ko = buildFunctionNarrativeQualityReading(source, "ko")!;
  assert.ok(ko.explanation.indexOf('echo("label")') < ko.explanation.indexOf("active가 false"));
  assert.match(ko.analysis.pathReason, /참 본문의 return "left";를 건너뛰고 return "right";/u);
  assert.match(ko.analysis.alternative, /true로 바꾸면.*return "left";를 실행/u);
  source.summaryTask.inputs[0].json = "true";
  const en = buildFunctionNarrativeQualityReading(source, "en")!;
  assert.match(en.analysis.pathReason, /execute return "left";/u);
  assert.match(en.analysis.alternative, /false.*skip.*return "left";.*execute return "right";/u);
  source.sourceFlow.paths[0].confidence = "inferred";
  assert.equal(buildFunctionNarrativeQualityReading(source, "en"), undefined);
  source.sourceFlow.paths[0].confidence = "exact";
  source.snippets[0].text = source.snippets[0].text.replace('const item = echo("label");', 'const item = echo("label"); const other = 2 + 3;');
  assert.equal(buildFunctionNarrativeQualityReading(source, "en"), undefined, "a route subset cannot stand in for the whole body");
});

test("the production captured-source Host qualifies one whole purpose before any page and reuses it across both branches", async () => {
  let purposes = 0, calls = 0, captured: FunctionNarrativeContext | undefined;
  const summary = 'Call finish, then return "enabled" when enabled is true and "disabled" otherwise.';
  const provider: FunctionNarrativeProvider = { supportsFinalSummary: () => true, supportsFunctionPurpose: () => true,
    async withRun(_language, _signal, operation) {
      try { return await operation(); } finally { host.events.push("provider-released"); }
    },
    async generate(task) {
      calls++;
      if (task.functionPurposeTask) {
        purposes++; captured = task;
        assert.equal(task.sourceFlow, undefined); assert.equal(task.nodeTask, undefined); assert.equal(task.summaryTask, undefined);
        assert.equal(readNarrativeQualityFacts(task).closed, true);
        return { modelName: "Purpose fixture", text: JSON.stringify({ summary }) };
      }
      const response = wholeRootReply(task);
      if (task.summaryTask) {
        assert.equal(task.summaryTask.knownFunctionSummary, summary);
        const value = JSON.parse(response.text);
        value.summary = task.summaryTask.knownFunctionSummary;
        value.scenarios[0].steps = task.summaryTask.steps;
        value.scenarios[0].example = { inputs: task.summaryTask.inputs, result: task.summaryTask.resultJson ?? value.scenarios[0].example.result };
        return { ...response, text: JSON.stringify(value) };
      }
      return response;
    } };
  const host = await createWholeNarrativeRootHost({ provider, callCount: 1 });
  try {
    await host.delivery.requestFunctionNarratives(host.request);
    const reply = host.replies().at(-1)!;
    assert.equal(reply.status, "ready"); assert.equal(reply.page!.count, 2); assert.equal(purposes, 1);
    assert.ok(captured!.snippets.some(snippet => snippet.text === host.helperText));
    for (let index = 0; index < reply.page!.count; index++) {
      await host.delivery.requestFunctionNarratives({ ...host.request, requestId: index + 2, pageIndex: index });
      const page = host.replies().at(-1)!.narrative!;
      assert.equal(page.summary, summary); assert.equal(page.scenarios[0].nodeDetails![0].text, summary);
    }
    const beforeRead = calls;
    await host.delivery.requestFunctionNarratives({ ...host.request, requestId: 9, pageIndex: 0 });
    assert.equal(calls, beforeRead);
  } finally { host.delivery.clearScenarioInputs(); }
});

test("local quality repair is bounded, keeps the source intact and never returns a fabricated fallback", async () => {
  for (const permanent of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), "narrative-quality-repair-"));
    const binaryPath = join(directory, "runner"), modelPath = join(directory, "fixture.gguf");
    const manager = new ModelTaskManager();
    await writeFile(modelPath, "GGUF fixture");
    await writeFile(binaryPath, `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);
      const file=path.join(__dirname,'attempts'), count=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0;
      fs.writeFileSync(file,String(count+1));
      const prompt=fs.readFileSync(args[args.indexOf('--file')+1],'utf8');
      const expected=${JSON.stringify(context().snippets[0].text)};
      if(!expected.split('\\n').every(line=>prompt.includes(JSON.stringify(line).slice(1,-1))) || (count && !prompt.includes('failed a prose quality check'))) process.exit(3);
      process.stdout.write(JSON.stringify({summary:count && !${permanent} ? ${JSON.stringify(narrative().summary)} : 'Return left when active is true.'}));`, { mode: 0o700 });
    const provider = createLocalFunctionNarrativeProvider({ binaryPath, modelPath, taskManager: manager,
      memory: async () => ({ totalBytes: 64 * 1024 ** 3, availableBytes: 48 * 1024 ** 3 }) });
    try {
      const operation = provider.generate(createFunctionNarrativePurposeTask(context()), "en", new AbortController().signal);
      if (permanent) await assert.rejects(operation, { detailCode: "quality-purpose-coverage" });
      else assert.equal(JSON.parse((await operation).text).summary, narrative().summary);
      assert.equal(await readFile(join(directory, "attempts"), "utf8"), "2");
    } finally { await manager.dispose(); await rm(directory, { recursive: true, force: true }); }
  }
});
