/** Unit tests for single-module component ownership in the Module Flow canvas. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  getModuleFlowModuleComponentFocusBrowserSource,
  selectModuleFlowComponentFocus,
  type ModuleFlowComponentFocusExpansion
} from "../../webview/moduleVisualizer/moduleFlowModuleComponentFocus";

type FocusEntry = readonly [string, ModuleFlowComponentFocusExpansion];

/** Creates one boundary-function branch with its module and function anchors. */
function boundaryEntry(key: string, moduleId: string, functionId: string): FocusEntry {
  return [key, {
    expansion: "boundaryFunctions",
    anchorModuleId: moduleId,
    nodes: [{ id: functionId }]
  }];
}

/** Creates one attached Function Logic child branch. */
function logicEntry(key: string, functionId: string): FocusEntry {
  return [key, {
    expansion: "functionLogic",
    anchorFunctionId: functionId
  }];
}

test("retains components only for the focused module and preserves module navigation", () => {
  const entries: FocusEntry[] = [
    ["module-tree", {
      expansion: "childModules",
      anchorModuleId: "module-a",
      nodes: [{ id: "module-b" }]
    }],
    boundaryEntry("module-a-functions", "module-a", "function-a"),
    logicEntry("function-a-logic", "function-a"),
    boundaryEntry("module-b-functions", "module-b", "function-b"),
    logicEntry("function-b-logic", "function-b"),
    logicEntry("orphan-logic", "function-missing")
  ];

  const selection = selectModuleFlowComponentFocus(entries, "module-b");

  assert.deepEqual(selection.retainedKeys, [
    "module-tree",
    "module-b-functions",
    "function-b-logic"
  ]);
  assert.deepEqual(selection.removedKeys, [
    "module-a-functions",
    "function-a-logic",
    "orphan-logic"
  ]);
});

test("a module without attached functions clears every previous component graph", () => {
  const selection = selectModuleFlowComponentFocus([
    ["module-tree", { expansion: "childModules", anchorModuleId: "module-a" }],
    boundaryEntry("module-a-functions", "module-a", "function-a"),
    logicEntry("function-a-logic", "function-a")
  ], "module-empty");

  assert.deepEqual(selection.retainedKeys, ["module-tree"]);
  assert.deepEqual(selection.removedKeys, ["module-a-functions", "function-a-logic"]);
});

test("serializes an iterative browser policy that cancels superseded responses", () => {
  const source = getModuleFlowModuleComponentFocusBrowserSource();

  assert.match(source, /function selectModuleFlowComponentFocus\(/u);
  assert.match(source, /function focusModuleComponents\(moduleId, moduleNode\)/u);
  assert.match(source, /state\.focusedModuleId = moduleId/u);
  assert.match(source, /pending\.moduleId !== moduleId/u);
  assert.match(source, /!retainedKeys\.has\(pending\.ownerExpansionKey\)/u);
  assert.doesNotMatch(source, /selectModuleFlowComponentFocus\([^)]*selectModuleFlowComponentFocus/u);
  assert.doesNotThrow(() => new Function(source));
});
