// Edge labels with edge_label_overlap = "avoid": each moves along its edge to a clear spot, or is left out.
// Run with: node --test tests/js/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { boxesOverlap, placeEdgeLabels, uprightAngle } from "../../src/anywidget_graph/ui/edge-labels.ts";
import type { EdgeLabelRequest, LabelBox } from "../../src/anywidget_graph/ui/edge-labels.ts";

/** A level edge from (x0, y) to (x1, y) between nodes of radius 5, with a 30 x 10 label. */
function level(key: string, x0: number, x1: number, y: number, width = 30): EdgeLabelRequest {
  return { key, ends: [`${key}-a`, `${key}-b`], from: { x: x0, y }, to: { x: x1, y }, fromRadius: 5, toRadius: 5, width, height: 10 };
}

test("text along an edge is never upside down", () => {
  assert.equal(uprightAngle(1, 0), 0);
  assert.equal(uprightAngle(-1, 0), 0);
  assert.ok(Math.abs(uprightAngle(0, 1) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(uprightAngle(0, -1) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(uprightAngle(-1, -1) - Math.PI / 4) < 1e-9);
});

test("boxes overlap when they cross, also turned, and not when they only touch or sit apart", () => {
  const a: LabelBox = { x: 0, y: 0, width: 20, height: 10, angle: 0 };
  assert.equal(boxesOverlap(a, { ...a, x: 10 }), true);
  assert.equal(boxesOverlap(a, { ...a, x: 20 }), false);
  assert.equal(boxesOverlap(a, { ...a, y: 30 }), false);
  // A long thin box turned 45 degrees crosses a level one at its centre, and misses one off its diagonal
  const turned: LabelBox = { x: 0, y: 0, width: 60, height: 4, angle: Math.PI / 4 };
  assert.equal(boxesOverlap(turned, { x: 0, y: 0, width: 10, height: 10, angle: 0 }), true);
  assert.equal(boxesOverlap(turned, { x: 20, y: -20, width: 10, height: 10, angle: 0 }), false);
});

test("a label with room sits in the middle of its edge, level with it", () => {
  const [placed] = placeEdgeLabels([level("e", 0, 200, 50)], []);
  assert.deepEqual(placed, { key: "e", x: 100, y: 50, angle: 0 });
});

test("a label moves along its edge, off a node label in the middle, and is left out when no spot is clear", () => {
  const middle: LabelBox = { x: 100, y: 50, width: 40, height: 14, angle: 0 };
  const [moved] = placeEdgeLabels([level("e", 0, 200, 50)], [middle]);
  assert.ok(moved.x < 75 || moved.x > 125, `moved off the middle (${moved.x})`);
  // The whole edge covered: no spot is clear
  const wall: LabelBox = { x: 100, y: 50, width: 200, height: 14, angle: 0 };
  assert.deepEqual(placeEdgeLabels([level("e", 0, 200, 50)], [wall]), []);
});

test("two edges on one line share it: the second label takes another spot, a third with none left is left out", () => {
  const edges = [level("a", 0, 200, 50, 50), level("b", 0, 200, 50, 50), level("c", 0, 200, 50, 50)];
  const placed = placeEdgeLabels(edges, []);
  assert.deepEqual(placed.map((p) => p.key), ["a", "b", "c"].slice(0, placed.length));
  assert.ok(placed.length >= 2);
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const box = (p: { x: number; y: number }): LabelBox => ({ ...p, width: 50, height: 10, angle: 0 });
      assert.equal(boxesOverlap(box(placed[i]), box(placed[j])), false, `${placed[i].key} and ${placed[j].key} apart`);
    }
  }
});

test("a label longer than its edge between the nodes is left out; its own end nodes do not block it", () => {
  assert.deepEqual(placeEdgeLabels([level("short", 0, 30, 0)], []), []);
  // Square boxes around its own end nodes (diagonal edge, so their corners reach towards the label)
  const edge: EdgeLabelRequest = { key: "d", ends: ["p", "q"], from: { x: 0, y: 0 }, to: { x: 40, y: 40 }, fromRadius: 6, toRadius: 6, width: 30, height: 10 };
  const ends: LabelBox[] = [
    { x: 0, y: 0, width: 12, height: 12, angle: 0, owner: "p" },
    { x: 40, y: 40, width: 12, height: 12, angle: 0, owner: "q" },
  ];
  assert.equal(placeEdgeLabels([edge], ends).length, 1);
  // Another node's box in the same place does block it
  assert.equal(placeEdgeLabels([edge], [{ x: 20, y: 20, width: 40, height: 40, angle: 0, owner: "r" }]).length, 0);
});
