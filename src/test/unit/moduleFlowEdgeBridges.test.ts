/**
 * Module Flow edge-bridge tests cover deterministic perpendicular crossing
 * detection, nearby-line clustering, SVG line jumps, direction cues, endpoint
 * exclusion, and parity with the serialized browser implementation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createModuleFlowBridgeDirectionPath,
  createModuleFlowEdgeBridges,
  createModuleFlowEdgePath,
  getModuleFlowEdgeBridgesBrowserSource,
  type ModuleFlowRoutedEdgeInput
} from "../../application/moduleFlow/moduleFlowEdgeBridges";

const crossingEdges: ModuleFlowRoutedEdgeInput[] = [{
  edgeId: "horizontal",
  points: [{ x: 0, y: 50 }, { x: 100, y: 50 }]
}, {
  edgeId: "vertical-a",
  points: [{ x: 50, y: 0 }, { x: 50, y: 100 }]
}, {
  edgeId: "vertical-b",
  points: [{ x: 60, y: 0 }, { x: 60, y: 100 }]
}];

test("clusters nearby perpendicular crossings into one deterministic line bridge", () => {
  const forward = createModuleFlowEdgeBridges(crossingEdges);
  const reversed = createModuleFlowEdgeBridges([...crossingEdges].reverse());

  assert.deepEqual([...reversed.entries()], [...forward.entries()]);
  assert.deepEqual(forward.get("horizontal"), [{
    segmentIndex: 0,
    startX: 43,
    endX: 67,
    y: 50,
    crossingCount: 2
  }]);
  assert.equal(forward.has("vertical-a"), false);
  assert.equal(forward.has("vertical-b"), false);
});

test("builds a curved jump and local triangle in the edge's travel direction", () => {
  const bridges = createModuleFlowEdgeBridges(crossingEdges).get("horizontal") ?? [];
  const forwardPath = createModuleFlowEdgePath(crossingEdges[0].points, bridges);
  const forwardDirection = createModuleFlowBridgeDirectionPath(
    crossingEdges[0].points,
    bridges
  );
  const reversePoints = [...crossingEdges[0].points].reverse();
  const reversePath = createModuleFlowEdgePath(reversePoints, bridges);
  const reverseDirection = createModuleFlowBridgeDirectionPath(reversePoints, bridges);

  assert.match(forwardPath, /^M 0 50 L 43 50 C [\d.]+ 42\.8 [\d.]+ 42\.8 67 50 L 100 50$/u);
  assert.match(reversePath, /^M 100 50 L 67 50 C [\d.]+ 42\.8 [\d.]+ 42\.8 43 50 L 0 50$/u);
  assert.match(forwardDirection, /^M 51\.8 [\d.]+ L 58\.8 [\d.]+ L 51\.8 [\d.]+ Z$/u);
  assert.match(reverseDirection, /^M 58\.2 [\d.]+ L 51\.2 [\d.]+ L 58\.2 [\d.]+ Z$/u);
});

test("ignores shared endpoints and self-crossings instead of drawing false bridges", () => {
  const endpointEdges: ModuleFlowRoutedEdgeInput[] = [{
    edgeId: "horizontal",
    points: [{ x: 0, y: 50 }, { x: 100, y: 50 }]
  }, {
    edgeId: "endpoint-touch",
    points: [{ x: 50, y: 10 }, { x: 50, y: 50 }]
  }];
  const selfCrossing: ModuleFlowRoutedEdgeInput = {
    edgeId: "self-crossing",
    points: [
      { x: 10, y: 20 },
      { x: 90, y: 20 },
      { x: 90, y: 80 },
      { x: 40, y: 80 },
      { x: 40, y: 10 }
    ]
  };

  assert.equal(createModuleFlowEdgeBridges(endpointEdges).size, 0);
  assert.equal(createModuleFlowEdgeBridges([selfCrossing]).size, 0);
});

test("exports the same bridge and SVG path behavior into the Webview runtime", () => {
  const source = getModuleFlowEdgeBridgesBrowserSource();
  const browser = new Function(`${source}\nreturn {
    createModuleFlowEdgeBridges,
    createModuleFlowEdgePath,
    createModuleFlowBridgeDirectionPath
  };`)() as {
    createModuleFlowEdgeBridges: typeof createModuleFlowEdgeBridges;
    createModuleFlowEdgePath: typeof createModuleFlowEdgePath;
    createModuleFlowBridgeDirectionPath: typeof createModuleFlowBridgeDirectionPath;
  };
  const hostBridges = createModuleFlowEdgeBridges(crossingEdges);
  const browserBridges = browser.createModuleFlowEdgeBridges(crossingEdges);
  const bridges = hostBridges.get("horizontal") ?? [];

  assert.deepEqual([...browserBridges.entries()], [...hostBridges.entries()]);
  assert.equal(
    browser.createModuleFlowEdgePath(crossingEdges[0].points, bridges),
    createModuleFlowEdgePath(crossingEdges[0].points, bridges)
  );
  assert.equal(
    browser.createModuleFlowBridgeDirectionPath(crossingEdges[0].points, bridges),
    createModuleFlowBridgeDirectionPath(crossingEdges[0].points, bridges)
  );
});
