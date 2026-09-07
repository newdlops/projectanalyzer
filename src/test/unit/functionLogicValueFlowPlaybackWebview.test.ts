/** Focused generated-webview contract checks for bounded localized value playback. */
import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionVisualizerHtml } from "../../webview/functionVisualizer/functionVisualizerHtml";
import { getFunctionLogicDataFlowBrowserSource, getFunctionLogicValueFlowPlaybackBrowserSource } from "../../webview/codeFlow/dataFlow";
import { getFunctionLogicValueFlowPlaybackStyles } from "../../webview/codeFlow/dataFlow/functionLogicValueFlowPlaybackStyles";

test("ships an explicit localized playback card with one bounded work scheduler", () => {
  const html = getFunctionVisualizerHtml({
    webview: { cspSource: "vscode-webview:" } as never,
    nonce: "value-flow-playback-test-nonce"
  });

  assert.ok(html.includes("Select a value"));
  assert.ok(html.includes("Token follows the real edge"));
  assert.ok(html.includes("값 선택"));
  assert.ok(html.includes("토큰이 실제 간선을 따라감"));
  assert.ok(html.includes("createFunctionLogicValueFlowPlaybackCopy(options.language)"));
  assert.ok(html.includes("ui/language"));
  assert.ok(html.includes("document.addEventListener?.(\"visibilitychange\""));
  assert.ok(html.includes("cancelScheduledWork"));
  assert.ok(html.includes("path.getTotalLength"));
  assert.ok(html.includes("index < 48"));
});

test("activates an exact transition before repeated frames and skips rAF for a discrete gap", () => {
  const callbacks: Array<{ progress: number; active: boolean }> = [];
  const exact = runPlayback({
    onTransitionStart() { return { durationMs: 1400 }; },
    onTransition(_frame: unknown, _previous: unknown, _index: number, _count: number, progress: number) { callbacks.push({ progress, active: true }); }
  });
  exact.playFromStart();
  exact.flush(0); exact.flush(700); exact.flush(1400);
  assert.ok(callbacks.length >= 2);
  assert.ok(callbacks.every((callback) => callback.active));

  let arrivals = 0;
  const gap = runPlayback({ onTransitionStart() { return { durationMs: 0 }; }, onActiveFrame() { arrivals += 1; } });
  gap.playFromStart();
  assert.equal(gap.pending(), 0);
  assert.equal(arrivals, 2);
});

test("value-change frames give an edge-less long mutation an arrival and dwell without truncating its text", () => {
  const arrivals: Array<Record<string, unknown>> = [];
  const frames = [
    { type: "start", binding: { name: "source" }, carriedValue: "0" },
    { type: "change", binding: { name: "veryLongVariableIdentityThatMustRemainReadable" }, carriedValue: "a value that is intentionally much longer than any token label", transition: { targetName: "veryLongVariableIdentityThatMustRemainReadable", before: { kind: "known", value: "before value that remains complete" }, after: { kind: "known", value: "after value that remains complete" } } }
  ];
  const playback = runPlayback({ frames, onTransitionStart() { return { durationMs: 0 }; }, onActiveFrame(frame: Record<string, unknown>) { arrivals.push(frame); } });
  playback.playFromStart();

  assert.deepEqual(arrivals, frames);
  assert.match(getFunctionLogicValueFlowPlaybackBrowserSource(), /active\.transition\.targetName \+ ": " \+ before \+ " → " \+ after/);
  assert.doesNotMatch(getFunctionLogicDataFlowBrowserSource(), /tokenText\.slice\(0, 25\)/);
});

test("arms follow once for each explicit playback pass", () => {
  let arms = 0;
  const playback = runPlayback({ onTransitionStart() { return { durationMs: 0 }; }, onPassStart() { arms += 1; } });
  playback.playFromStart();
  playback.playFromStart();
  assert.equal(arms, 2);
});

test("settles a source frame when graph transition rendering throws", () => {
  let arrivals = 0;
  let transitionErrors = 0;
  const playback = runPlayback({
    onTransitionStart() { return { durationMs: 1400 }; },
    onTransition() { throw new Error("detached SVG path"); },
    onTransitionError() { transitionErrors += 1; },
    onActiveFrame() { arrivals += 1; }
  });
  playback.playFromStart();
  playback.flush(0);

  assert.equal(transitionErrors, 1);
  assert.equal(arrivals, 2);
  assert.equal(playback.pending(), 0);
});

test("uses a discrete arrival when graph transition setup throws", () => {
  let arrivals = 0;
  let transitionErrors = 0;
  const playback = runPlayback({
    onTransitionStart() { throw new Error("unmeasurable SVG path"); },
    onTransitionError() { transitionErrors += 1; },
    onActiveFrame() { arrivals += 1; }
  });
  playback.playFromStart();

  assert.equal(transitionErrors, 1);
  assert.equal(arrivals, 2);
  assert.equal(playback.pending(), 0);
});

test("keeps a card-local finite speed select without adding a scheduler", () => {
  const source = getFunctionLogicValueFlowPlaybackBrowserSource();
  assert.match(source, /\[0\.5, 1, 1\.5, 2\]/);
  assert.match(source, /speedSelect\.disabled = isPlaying/);
  assert.match(source, /\(\(1 - pendingProgress\) \* pendingDurationMs\) \/ speed/);
  assert.match(source, /FUNCTION_LOGIC_VALUE_FLOW_PLAYBACK_DWELL_MS \/ speed/);
  assert.match(source, /speedSelect\.addEventListener\("change"/);
  assert.doesNotMatch(source, /localStorage|workspaceConfiguration|postMessage/);
});

test("reports shared playback phase without changing the active frame contract", () => {
  const source = getFunctionLogicValueFlowPlaybackBrowserSource();
  assert.match(source, /options\.onPlaybackState\?\.\(activeBindingId, phase\)/);
  assert.match(source, /function setLanguage\(language\)[\s\S]*renderGuide\(\);[\s\S]*update\(\);/);
});

test("playback variable tokens keep stable facts, pending futures, and text-only wrapping contracts", () => {
  const source = getFunctionLogicValueFlowPlaybackBrowserSource();
  const styles = getFunctionLogicValueFlowPlaybackStyles();
  assert.match(source, /function renderVariableTokens\(frames, arrivedIndex\)/);
  assert.match(source, /const key = bindingId \+ /);
  assert.match(source, /index <= arrivedIndex/);
  assert.match(source, /logic-value-flow-playback-token-before/);
  assert.match(source, /logic-value-flow-playback-token-after/);
  assert.match(source, /isKnownPlaybackTokenValue\(transition\.after\)/);
  assert.match(source, /document\.createElement\("div"\)/);
  assert.match(styles, /\.logic-value-flow-playback-tokens[\s\S]*flex-wrap: wrap/);
  assert.match(styles, /\.logic-value-flow-playback-token-after\.changed/);
  assert.match(styles, /@media \(forced-colors: active\)[\s\S]*token-after\.changed/);
  assert.match(styles, /overflow-wrap: anywhere/);
});

/** Executes the card against the smallest DOM needed to observe scheduler behavior. */
function runPlayback(overrides: Record<string, unknown>) {
  const queued = new Map<number, (time: number) => void>(); let nextId = 1;
  const document = { hidden: false, addEventListener() {}, removeEventListener() {}, createElement() { return fakeElement(); } };
  const factory = new Function("document", "window", "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "performance", `function formatFunctionLogicScenarioState(state) { return String(state?.value); } ${getFunctionLogicValueFlowPlaybackBrowserSource()} return createFunctionLogicValueFlowPlayback;`) as (...args: unknown[]) => (options: Record<string, unknown>) => { playFromStart(): void };
  const create = factory(document, { matchMedia() { return { matches: false }; } }, (callback: (time: number) => void) => { const id = nextId++; queued.set(id, callback); return id; }, (id: number) => queued.delete(id), () => 0, () => {}, { now: () => 0 });
  const frames = overrides.frames as Array<Record<string, unknown>> | undefined;
  const playback = create({ language: "en", readFrames() { return frames || [{ type: "start", binding: { name: "input" }, carriedValue: "1" }, { type: "change", binding: { name: "result" }, carriedValue: "2" }]; }, onActiveFrame() {}, ...overrides });
  return { playback, playFromStart() { playback.playFromStart(); }, pending() { return queued.size; }, flush(time: number) { const callback = [...queued.values()][0]; queued.clear(); callback?.(time); } };
}

function fakeElement() {
  return { className: "", textContent: "", title: "", type: "", disabled: false, hidden: false, append() {}, appendChild() {}, replaceChildren() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {} };
}
