/** Capability gates protect old/custom runners while avoiding costly recurrent speculative snapshots. */
import assert from "node:assert/strict";
import test from "node:test";
import { localNarrativeAccelerationArgs } from "../../llm/functionNarratives/localAcceleration";

const checkpoints = "--ctx-checkpoints N\n--checkpoint-min-step N\n--cache-ram N";

test("fully advertised runner uses bounded caches and ordinary decoding", () => {
  const args = localNarrativeAccelerationArgs(checkpoints + "\n--spec-type none,ngram-map-k");
  assert.deepEqual(args, ["--ctx-checkpoints", "8", "--checkpoint-min-step", "64", "--cache-ram", "256", "--spec-type", "none"]);
  assert.doesNotMatch(args.join(" "), /model-draft|ngram|temp|predict|ctx-size|threads/u);
});

test("legacy checkpoint support does not assume a speculative flag", () => {
  assert.deepEqual(localNarrativeAccelerationArgs(checkpoints),
    ["--ctx-checkpoints", "8", "--checkpoint-min-step", "64", "--cache-ram", "256"]);
});

test("partial and near-matching flags cannot opt an old runner into unsupported options", () => {
  for (const help of ["", "--ctx-checkpoints N", checkpoints.replace("--cache-ram", "--cache-ram-legacy"),
    "--spec-type-legacy none"]) {
    assert.deepEqual(localNarrativeAccelerationArgs(help), []);
  }
});
