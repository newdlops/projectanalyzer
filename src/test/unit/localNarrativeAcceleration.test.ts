/** Capability gates protect old/custom runners from unsupported optional acceleration arguments. */
import assert from "node:assert/strict";
import test from "node:test";
import { localNarrativeAccelerationArgs } from "../../llm/functionNarratives/localAcceleration";

const checkpoints = "--ctx-checkpoints N\n--checkpoint-min-step N\n--cache-ram N";
const ngrams = "--spec-type none,ngram-map-k\n--spec-ngram-map-k-size-n N\n--spec-ngram-map-k-size-m N";
const qwen = "/models/Qwen3.5-4B-Q4_K_M.gguf";

test("fully advertised Qwen runner uses bounded caches and a small target-verified draft", () => {
  const args = localNarrativeAccelerationArgs(checkpoints + "\n" + ngrams, qwen);
  assert.deepEqual(args, ["--ctx-checkpoints", "8", "--checkpoint-min-step", "64", "--cache-ram", "256",
    "--spec-type", "ngram-map-k", "--spec-ngram-map-k-size-n", "4", "--spec-ngram-map-k-size-m", "8"]);
  assert.doesNotMatch(args.join(" "), /model-draft|temp|predict|ctx-size|threads/u);
});

test("unrelated models retain ordinary decoding while supported caches remain bounded", () => {
  assert.deepEqual(localNarrativeAccelerationArgs(checkpoints + "\n" + ngrams, "/models/other.gguf"),
    ["--ctx-checkpoints", "8", "--checkpoint-min-step", "64", "--cache-ram", "256"]);
});

test("partial flags, near-matching names and unsupported draft kinds cannot opt a legacy runner in", () => {
  for (const help of ["", "--ctx-checkpoints N", checkpoints.replace("--cache-ram", "--cache-ram-legacy"),
    ngrams.replace("--spec-ngram-map-k-size-m", "--spec-ngram-map-k-size-m-legacy"), ngrams.replace("ngram-map-k\n", "draft-simple\n")]) {
    assert.deepEqual(localNarrativeAccelerationArgs(help, qwen), []);
  }
});
