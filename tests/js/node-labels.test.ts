// Node labels never cover each other: the largest node's label first, on its right, its left, or not at all.
// Run with: node --test tests/js/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { boxesOverlap } from "../../src/anywidget_graph/ui/edge-labels.ts";
import { nodeLabelBox, pickNodeLabels } from "../../src/anywidget_graph/ui/node-labels.ts";
import type { NodeLabelCandidate } from "../../src/anywidget_graph/ui/node-labels.ts";

const node = (key: string, x: number, y: number, extra: Partial<NodeLabelCandidate> = {}): NodeLabelCandidate =>
  ({ key, x, y, radius: 5, width: 60, height: 14, ...extra });
const disc = (c: NodeLabelCandidate) => ({ x: c.x, y: c.y, width: 2 * c.radius, height: 2 * c.radius, angle: 0, owner: c.key });

test("labels with room all show, on the right of their nodes", () => {
  const nodes = [node("a", 0, 0), node("b", 0, 40), node("c", 200, 0)];
  assert.deepEqual([...pickNodeLabels(nodes, nodes.map(disc))], [["a", "right"], ["b", "right"], ["c", "right"]]);
});

test("labels of crowded nodes never cover each other; the first (largest) node keeps its label", () => {
  // b and c sit right of a, inside where a's label would go: a goes left, clear of both nodes
  const a = node("a", 0, 0), b = node("b", 40, 4), c = node("c", 40, -4, { width: 200 });
  const picked = pickNodeLabels([a, b, c], [a, b, c].map(disc));
  assert.equal(picked.get("a"), "left");
  const boxes = [...picked].map(([key, side]) => nodeLabelBox([a, b, c].find((n) => n.key === key)!, side));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.equal(boxesOverlap(boxes[i], boxes[j]), false);
  // Five nodes on top of each other: four positions around the first, and only room for so many
  const pile = ["p", "q", "r", "s", "t"].map((key) => node(key, 0, 0));
  assert.ok(pickNodeLabels(pile, []).size < 5, "not every label fits");
});

test("a label takes the first position clear of other nodes (right, left, above, below), or none unless a hub", () => {
  const a = node("a", 0, 0), right = node("x", 40, 0), left = node("y", -40, 0), up = node("u", 0, -20), down = node("d", 0, 20);
  assert.equal(pickNodeLabels([a], [a, right].map(disc)).get("a"), "left");
  assert.equal(pickNodeLabels([a], [a, right, left].map(disc)).get("a"), "above");
  assert.equal(pickNodeLabels([a], [a, right, left, up].map(disc)).get("a"), "below");
  // Nodes all around: an ordinary node's label is left out, a hub's shows on the right, over the node there
  assert.equal(pickNodeLabels([a], [a, right, left, up, down].map(disc)).has("a"), false);
  assert.equal(pickNodeLabels([{ ...a, hub: true }], [a, right, left, up, down].map(disc)).get("a"), "right");
});

test("a forced label always shows, and on its own side; the others make room for it", () => {
  const lane = node("lane", 0, 0, { forced: true, side: "left" }), next = node("n", -60, 0);
  const picked = pickNodeLabels([lane, next], [lane, next].map(disc));
  assert.equal(picked.get("lane"), "left");
  assert.equal(picked.get("n"), "left", "its right side is the lane label's");
  // A forced label shows even where every side is covered
  const wall = node("w", 0, 0, { width: 400 });
  assert.equal(pickNodeLabels([wall, node("f", 10, 0, { forced: true })], []).has("f"), true);
});
