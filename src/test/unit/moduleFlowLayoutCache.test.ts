/** Layout cache tests protect snapshot invalidation and bounded LRU behavior. */

import assert from "node:assert/strict";
import test from "node:test";
import { ModuleFlowLayoutCache } from "../../webview/moduleVisualizer/moduleFlowLayoutCache";

test("promotes cache hits and evicts the least recently used structural layout", () => {
  const cache = new ModuleFlowLayoutCache<number>(2);
  cache.set("base", 1);
  cache.set("expanded-a", 2);
  assert.equal(cache.get("base"), 1);
  cache.set("expanded-b", 3);

  assert.equal(cache.get("expanded-a"), undefined);
  assert.equal(cache.get("base"), 1);
  assert.equal(cache.get("expanded-b"), 3);
  assert.equal(cache.size, 2);
});

test("clear removes all snapshot-scoped layouts", () => {
  const cache = new ModuleFlowLayoutCache<object>(4);
  cache.set("old-snapshot", {});
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.get("old-snapshot"), undefined);
});
