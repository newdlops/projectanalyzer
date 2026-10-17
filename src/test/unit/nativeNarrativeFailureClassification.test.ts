/** Source authority and cancellation categories survive native execution/cleanup wrapping without inspecting exception text or invoking getters. */
import assert from "node:assert/strict";
import test from "node:test";
import { getNarrativeSourceFailureStatus } from "../../application/narrativeSources";
import { FunctionNarrativeError } from "../../shared/functionNarratives";
import { SourceCaptureError } from "../../shared/narrativeSources";

test("source revocation survives nested native aggregate and provider causes and takes precedence over cleanup cancellation", () => {
  const changed = new SourceCaptureError("source-changed", "Explicit source change"), cleanup = new FunctionNarrativeError("cancelled");
  const wrapper = Object.assign(new FunctionNarrativeError("failed"), { cause: new AggregateError([cleanup, new AggregateError([changed])]) });
  assert.equal(getNarrativeSourceFailureStatus(wrapper), "stale");
  assert.equal(getNarrativeSourceFailureStatus(new AggregateError([new SourceCaptureError("context-too-large", "Whole source budget"), changed])), "stale");
});

test("source cancellation and whole-source budget categories remain distinct and cleanup cancellation does not replace a precise outer timeout", () => {
  const cancelled = new SourceCaptureError("cancelled", "Explicit source cancellation");
  assert.equal(getNarrativeSourceFailureStatus(new AggregateError([cancelled])), "cancelled");
  assert.equal(getNarrativeSourceFailureStatus(Object.assign(new FunctionNarrativeError("timeout"), { cause: cancelled })), undefined);
  assert.equal(getNarrativeSourceFailureStatus(new AggregateError([cancelled, new SourceCaptureError("context-too-large", "Whole source budget")])), "context-too-large");
});

test("exception graph classification uses bounded iterative visited traversal and never invokes error or array accessors", () => {
  const changed = new SourceCaptureError("source-changed", "Explicit source change"), cycle: Record<string, unknown> = {};
  cycle.cause = cycle; cycle.errors = [cycle, { cause: changed }]; assert.equal(getNarrativeSourceFailureStatus(cycle), "stale");
  const nested = { cause: { cause: changed } }; assert.equal(getNarrativeSourceFailureStatus(nested, 1), undefined); assert.equal(getNarrativeSourceFailureStatus(nested, 2), "stale");
  let reads = 0; const getters = Object.defineProperties({}, { cause: { get() { reads++; return changed; } }, errors: { get() { reads++; return [changed]; } } });
  const entries = Object.defineProperty([], "0", { get() { reads++; return changed; } });
  assert.equal(getNarrativeSourceFailureStatus(getters), undefined); assert.equal(getNarrativeSourceFailureStatus({ errors: entries }), undefined); assert.equal(reads, 0);
});
