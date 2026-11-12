// Property-based styling shared by the 2D view, the 3D view and the export page (styling.ts).
// Run with: node --test tests/js/*.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeEdgeColor, getStylingOpts } from "../../src/anywidget_graph/ui/styling.ts";
import type { GraphEdge, GraphNode, WidgetModel } from "../../src/anywidget_graph/ui/types.ts";

function modelOf(values: Record<string, unknown>): WidgetModel {
  return { get: (key: string) => values[key], set: () => {}, save_changes: () => {}, on: () => {} };
}

test("an edge's own colour wins over the edge colour field and the type colour", () => {
  const edges: GraphEdge[] = [
    { source: "a", target: "b", type: "KNOWS", weight: 1, color: "#123456" },
    { source: "b", target: "c", type: "KNOWS", weight: 5 },
    { source: "c", target: "a", type: "KNOWS" },
  ];
  const opts = getStylingOpts(
    modelOf({ edge_color_field: "weight", type_colors: { edges: { KNOWS: "#ff0000" } } }),
    [],
    edges,
  );
  assert.equal(computeEdgeColor(edges[0], opts), "#123456");
  const mapped = computeEdgeColor(edges[1], opts);
  assert.notEqual(mapped, "#123456");
  assert.notEqual(mapped, "#ff0000", "the field mapping wins over the type colour");
  assert.equal(computeEdgeColor(edges[2], opts), "#ff0000", "no field value: the type colour");
});

test("colour and size domains come from very many values without overflowing the stack", () => {
  const n = 300_000;
  const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, score: i % 1000, rank: i * 2 }));
  const opts = getStylingOpts(modelOf({ color_field: "score", size_field: "rank" }), nodes, []);
  assert.deepEqual(opts.colorDomain, [0, 999]);
  assert.deepEqual(opts.sizeDomain, [0, 2 * (n - 1)]);
});

test("degrees are keyed by the id as a string, whether the data's ids are numbers or strings", () => {
  const edges = [{ source: 1, target: 2 }, { source: 1, target: "3" }] as unknown as GraphEdge[];
  const opts = getStylingOpts(modelOf({}), [], edges);
  assert.equal(opts.degreeMap.get("1"), 2);
  assert.equal(opts.degreeMap.get("2"), 1);
  assert.equal(opts.degreeMap.get("3"), 1);
});
