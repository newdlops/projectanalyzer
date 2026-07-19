/** Unit tests for safe relative source labels and full-text graph presentation. */

import assert from "node:assert/strict";
import test from "node:test";

import { createSourceDisplayFormatter } from "../../application/sourcePresentation";

test("retains complete workspace-relative paths for variable-size graph boxes", () => {
  const longRelativePath = `${Array.from({ length: 28 }, (_, index) =>
    `responsibility-segment-${index}`
  ).join("/")}/handler.ts`;
  const formatter = createSourceDisplayFormatter("/workspace", {
    preserveFullText: true
  });

  const location = formatter.location(`/workspace/${longRelativePath}`, {
    startLine: 40
  });

  assert.equal(location, `${longRelativePath}:41`);
  assert.doesNotMatch(location ?? "", /…|\/workspace/u);
});

test("keeps out-of-workspace labels private even in full-text mode", () => {
  const formatter = createSourceDisplayFormatter("/workspace", {
    preserveFullText: true
  });

  assert.equal(formatter.path("/private/source/secret-handler.ts"), "secret-handler.ts");
});
