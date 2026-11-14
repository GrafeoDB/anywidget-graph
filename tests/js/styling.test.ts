// Property-based styling shared by the 2D view, the 3D view and the export page (styling.ts).
// Run with: node --test tests/js/*.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { readFileSync, readdirSync } from "node:fs";

import { DARK, LIGHT } from "../../src/anywidget_graph/ui/palette.ts";
import { computeEdgeColor, computeNodeColor, getStylingOpts, nodeDisplay, Registries, registriesFor } from "../../src/anywidget_graph/ui/styling.ts";
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

// === The shared data palette (registry.ts, palette.ts): the largest categories get the 8 colours, the rest Other ===

const typed = (type: string, n: number, start = 0): GraphNode[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${type}${start + i}`, labels: [type] }));

test("node types take the data colours by count", () => {
  const nodes = [...typed("B", 3), ...typed("A", 10)];
  const opts = getStylingOpts(modelOf({ dark_mode: false }), nodes, [], new Registries());
  assert.equal(computeNodeColor(nodes[3], opts), LIGHT.data[0], "the largest type gets slot 1");
  assert.equal(computeNodeColor(nodes[0], opts), LIGHT.data[1]);
});

test("a node's own colour and the host's type colours still win", () => {
  const nodes: GraphNode[] = [{ id: "a", labels: ["A"], color: "#123456" }, { id: "b", labels: ["B"] }];
  const opts = getStylingOpts(modelOf({ dark_mode: false, type_colors: { nodes: { B: "#abcdef" } } }), nodes, [], new Registries());
  assert.equal(computeNodeColor(nodes[0], opts), "#123456");
  assert.equal(computeNodeColor(nodes[1], opts), "#abcdef");
});

test("a ninth node type is Other", () => {
  const nodes = "ABCDEFGHI".split("").flatMap((t, i) => typed(t, 20 - i));
  const opts = getStylingOpts(modelOf({ dark_mode: false }), nodes, [], new Registries());
  assert.equal(computeNodeColor(nodes[nodes.length - 1], opts), LIGHT.other);
});

test("a node without a type takes the first data colour, in the theme's palette", () => {
  const nodes: GraphNode[] = [{ id: "x" }];
  assert.equal(computeNodeColor(nodes[0], getStylingOpts(modelOf({ dark_mode: true }), nodes, [], new Registries())), DARK.data[0]);
});

test("categorical colour field values fold like types; numbers still use the scale", () => {
  const nodes: GraphNode[] = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, team: "red" })),
    { id: "q", team: "blue" },
  ];
  const opts = getStylingOpts(modelOf({ dark_mode: false, color_field: "team" }), nodes, [], new Registries());
  assert.equal(computeNodeColor(nodes[0], opts), LIGHT.data[0]);
  assert.equal(computeNodeColor(nodes[5], opts), LIGHT.data[1]);
});

test("edges default to the edge colour; a categorical edge field folds into the palette", () => {
  const edges: GraphEdge[] = [{ source: "a", target: "b", type: "KNOWS" }, { source: "b", target: "c", kind: "x" }];
  const plain = getStylingOpts(modelOf({ dark_mode: false }), [], edges, new Registries());
  assert.equal(computeEdgeColor(edges[0], plain), LIGHT.edge);
  const mapped = getStylingOpts(modelOf({ dark_mode: false, edge_color_field: "kind" }), [], edges, new Registries());
  assert.equal(computeEdgeColor(edges[1], mapped), LIGHT.data[0]);
});

test("colours stick for the widget: a later batch does not repaint", () => {
  const registries = new Registries();
  const first = typed("A", 2);
  getStylingOpts(modelOf({ dark_mode: false }), first, [], registries);
  const later = [...first, ...typed("B", 50)];
  const opts = getStylingOpts(modelOf({ dark_mode: false }), later, [], registries);
  assert.equal(computeNodeColor(first[0], opts), LIGHT.data[0], "A keeps slot 1 though B is now larger");
  assert.equal(computeNodeColor(later[2], opts), LIGHT.data[1]);
});

test("a new result that shares a coloured type keeps the colours; one that shares none gets the eight afresh", () => {
  const registries = new Registries();
  const first = "ABCDEFGH".split("").flatMap((t, i) => typed(t, 20 - i));
  getStylingOpts(modelOf({ dark_mode: false }), first, [], registries);
  // Shares H (slot 8): H keeps its colour and the new type is Other, all eight slots being taken
  const overlap = [...typed("H", 5), ...typed("Movie", 9)];
  const kept = getStylingOpts(modelOf({ dark_mode: false }), overlap, [], registries);
  assert.equal(computeNodeColor(overlap[0], kept), LIGHT.data[7]);
  assert.equal(computeNodeColor(overlap[5], kept), LIGHT.other);
  // Another query with none of the coloured types: its largest types get the first colours, not all Other
  const other = [...typed("Actor", 3), ...typed("Film", 9)];
  const fresh = getStylingOpts(modelOf({ dark_mode: false }), other, [], registries);
  assert.equal(computeNodeColor(other[3], fresh), LIGHT.data[0], "Film, the largest");
  assert.equal(computeNodeColor(other[0], fresh), LIGHT.data[1]);
});

test("a categorical colour field starts afresh the same way", () => {
  const registries = new Registries();
  const red = [{ id: "a", team: "red" }, { id: "b", team: "blue" }];
  getStylingOpts(modelOf({ dark_mode: false, color_field: "team" }), red, [], registries);
  const next = [{ id: "c", team: "green" }];
  const opts = getStylingOpts(modelOf({ dark_mode: false, color_field: "team" }), next, [], registries);
  assert.equal(computeNodeColor(next[0], opts), LIGHT.data[0]);
});

test("one widget keeps its registries across renders; the export assigns like a fresh widget", () => {
  const host = modelOf({ dark_mode: false });
  assert.equal(registriesFor(host), registriesFor(host));
  const nodes = [...typed("B", 3), ...typed("A", 10)];
  const fresh = getStylingOpts(modelOf({ dark_mode: false }), nodes, []);
  const widget = getStylingOpts(host, nodes, [], registriesFor(host));
  assert.equal(computeNodeColor(nodes[0], fresh), computeNodeColor(nodes[0], widget));
});

test("no hard-coded indigo is left in the ui scripts", () => {
  const ui = new URL("../../src/anywidget_graph/ui/", import.meta.url);
  for (const file of readdirSync(ui).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(new URL(file, ui), "utf8");
    for (const banned of ["#6366f1", "99, 102, 241"]) assert.ok(!source.includes(banned), `${banned} in ${file}`);
  }
});

test("nodeDisplay keeps the ring colour and fills it at 38% over the background", () => {
  assert.deepEqual(nodeDisplay("#5c93d9", "#ffffff"), { color: "#5c93d9", fillColor: "#c1d6f1" });
});

test("an untyped node is Other next to typed ones, and the first colour only in a graph without types", () => {
  const mixed = [{ id: "a", labels: ["Person"] }, { id: "b", labels: ["Person"] }, { id: "c" }] as GraphNode[];
  const opts = getStylingOpts(modelOf({}), mixed, [], new Registries());
  assert.equal(computeNodeColor(mixed[0], opts), LIGHT.data[0], "Person, the largest type");
  assert.equal(computeNodeColor(mixed[2], opts), LIGHT.other, "not Person's colour");
  const plain = [{ id: "a" }, { id: "b" }] as GraphNode[];
  assert.equal(computeNodeColor(plain[0], getStylingOpts(modelOf({}), plain, [], new Registries())), LIGHT.data[0]);
});
