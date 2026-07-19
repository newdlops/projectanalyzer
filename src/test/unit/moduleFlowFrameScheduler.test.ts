/** Frame scheduler tests use a queued fake RAF to verify exact commit counts. */

import assert from "node:assert/strict";
import test from "node:test";
import { ModuleFlowFrameScheduler } from "../../webview/moduleVisualizer/moduleFlowFrameScheduler";

test("coalesces repeated requests and schedules reentrant work for the next frame", () => {
  let nextHandle = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  let commits = 0;
  let scheduler: ModuleFlowFrameScheduler;
  scheduler = new ModuleFlowFrameScheduler(
    (callback) => {
      nextHandle += 1;
      callbacks.set(nextHandle, callback);
      return nextHandle;
    },
    (handle) => { callbacks.delete(handle); },
    () => {
      commits += 1;
      if (commits === 1) scheduler.schedule();
    }
  );

  for (let index = 0; index < 120; index += 1) scheduler.schedule();
  assert.equal(callbacks.size, 1);
  const first = callbacks.entries().next().value as [number, FrameRequestCallback];
  callbacks.delete(first[0]);
  first[1](0);
  assert.equal(commits, 1);
  assert.equal(callbacks.size, 1);

  const second = callbacks.entries().next().value as [number, FrameRequestCallback];
  callbacks.delete(second[0]);
  second[1](16);
  assert.equal(commits, 2);
  assert.equal(callbacks.size, 0);
});

test("dispose cancels pending work and prevents future commits", () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let commits = 0;
  const scheduler = new ModuleFlowFrameScheduler(
    (callback) => {
      callbacks.set(1, callback);
      return 1;
    },
    (handle) => { callbacks.delete(handle); },
    () => { commits += 1; }
  );
  scheduler.schedule();
  scheduler.dispose();
  scheduler.schedule();
  assert.equal(callbacks.size, 0);
  assert.equal(commits, 0);
});
