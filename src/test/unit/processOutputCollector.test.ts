/** Unit tests for aggregate, bounded Rust child-process output collection. */

import assert from "node:assert/strict";
import test from "node:test";
import { ProcessOutputCollector } from "../../analyzer/rust/processOutputCollector";

test("retains complete stdout while reporting aggregate chunks once", () => {
  const collector = new ProcessOutputCollector();
  collector.appendStdout(Buffer.from('{"nodes":'));
  collector.appendStdout(Buffer.from("[]}"));

  const output = collector.take();

  assert.equal(output.stdout, '{"nodes":[]}');
  assert.equal(output.stdoutBytes, 12);
  assert.equal(output.stdoutChunks, 2);
  assert.equal(output.stderrBytes, 0);
  assert.equal(output.stderrPreview, "");
});

test("bounds stderr preview without losing total byte and chunk counts", () => {
  const collector = new ProcessOutputCollector(8);
  collector.appendStderr(Buffer.from("first-"));
  collector.appendStderr(Buffer.from("second-error"));

  const output = collector.take();

  assert.equal(output.stderrPreview, "first-se");
  assert.equal(output.stderrBytes, 18);
  assert.equal(output.stderrChunks, 2);
  assert.equal(output.stderrOmittedBytes, 10);
});
