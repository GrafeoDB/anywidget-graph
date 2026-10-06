// Tests for the browser-side Grafeo modules. Run with: node --test tests/js/
// (pytest runs them too, see tests/test_ui_bundle.py). The fixtures use the
// value encoding that @grafeo-db/wasm 0.5.44 and grafeo-server 0.5.44 return.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  grafeoRowsToGraph,
  grafeoSchemaToTypes,
  grafeoNodeLookupQuery,
  grafeoEdgeLookupQuery,
  isGrafeoNode,
  isGrafeoEdge,
  isGrafeoPath,
} from "../../src/anywidget_graph/ui/grafeo-result.js";
import * as embed from "../../src/anywidget_graph/ui/grafeo-embed.js";
import * as server from "../../src/anywidget_graph/ui/grafeo.js";

const alix = { _id: 0, _labels: ["Person"], name: "Alix", id: "p1" };
const gus = { _id: 1, _labels: ["Person"], name: "Gus" };
const vincent = { _id: 2, _labels: ["Person"], name: "Vincent" };
const knows1 = { _id: 0, _type: "KNOWS", _source: 0, _target: 1, since: 2020, source: "school" };
const knows2 = { _id: 1, _type: "KNOWS", _source: 1, _target: 2 };
const byId = { 0: alix, 1: gus, 2: vincent };
const edgeById = { 0: knows1, 1: knows2 };

// Answers the lookup queries the way the engine would
function fakeLookup(calls) {
  return (query) => {
    calls.push(query);
    const ids = query.match(/IN \[(.*)\]/)[1].split(", ").map(Number);
    return query.includes("()-[r]->()")
      ? ids.filter((i) => edgeById[i]).map((i) => ({ r: edgeById[i] }))
      : ids.filter((i) => byId[i]).map((i) => ({ n: byId[i] }));
  };
}

const edgeKeys = (graph) => graph.edges.map((e) => `${e.source}->${e.target}:${e.label}`).sort();
const nodeIds = (graph) => graph.nodes.map((n) => n.id).sort();

test("entity detection matches the engine encoding", () => {
  assert.ok(isGrafeoNode(alix));
  assert.ok(!isGrafeoNode(knows1));
  assert.ok(isGrafeoEdge(knows1));
  assert.ok(!isGrafeoEdge({ nodes: [0], edges: [], _type: "path" }));
  assert.ok(isGrafeoPath({ nodes: [0, 1], edges: [0], _type: "path" }));
  assert.ok(isGrafeoPath({ nodes: [0, 1], edges: [0] }));
  assert.ok(!isGrafeoPath(alix));
  assert.ok(!isGrafeoNode({ id: 1, labels: ["Person"] }), "legacy shape is not a Grafeo node");
});

test("object rows (WASM) build nodes and edges once", async () => {
  const rows = [
    { a: alix, r: knows1, b: gus },
    { a: gus, r: knows1, b: alix }, // undirected match: same edge again
    { a: gus, r: knows2, b: vincent },
  ];
  const graph = await grafeoRowsToGraph(rows);
  assert.deepEqual(nodeIds(graph), ["0", "1", "2"]);
  assert.deepEqual(edgeKeys(graph), ["0->1:KNOWS", "1->2:KNOWS"]);
});

test("array rows (server) are supported", async () => {
  const graph = await grafeoRowsToGraph([[alix, knows1, gus]]);
  assert.deepEqual(nodeIds(graph), ["0", "1"]);
  assert.equal(graph.edges.length, 1);
});

test("identity beats properties named id / source", async () => {
  const graph = await grafeoRowsToGraph([{ a: alix, r: knows1, b: gus }]);
  const node = graph.nodes.find((n) => n.name === "Alix");
  assert.equal(node.id, "0");
  assert.deepEqual(node.labels, ["Person"]);
  assert.equal(node.label, "Alix");
  const [edge] = graph.edges;
  assert.equal(edge.source, "0");
  assert.equal(edge.label, "KNOWS");
  assert.equal(edge.since, 2020);
});

test("lists: collect, variable-length edges, nodes(p)", async () => {
  const graph = await grafeoRowsToGraph([{ ns: [alix, gus, vincent], rs: [knows1, knows2] }]);
  assert.deepEqual(nodeIds(graph), ["0", "1", "2"]);
  assert.deepEqual(edgeKeys(graph), ["0->1:KNOWS", "1->2:KNOWS"]);
});

test("entities nested in maps are found", async () => {
  const graph = await grafeoRowsToGraph([{ m: { who: alix, more: { list: [gus] } } }]);
  assert.deepEqual(nodeIds(graph), ["0", "1"]);
});

test("paths with ids are resolved through lookups", async () => {
  const calls = [];
  const rows = [{ p: { nodes: [0, 1, 2], edges: [0, 1], _type: "path" } }];
  const graph = await grafeoRowsToGraph(rows, fakeLookup(calls));
  assert.deepEqual(nodeIds(graph), ["0", "1", "2"]);
  assert.deepEqual(edgeKeys(graph), ["0->1:KNOWS", "1->2:KNOWS"]);
  assert.deepEqual(calls, [grafeoEdgeLookupQuery(["0", "1"]), grafeoNodeLookupQuery(["0", "1", "2"])]);
});

test("edges without endpoints get their nodes looked up", async () => {
  const calls = [];
  const graph = await grafeoRowsToGraph([{ r: knows2 }], fakeLookup(calls));
  assert.deepEqual(nodeIds(graph), ["1", "2"]);
  assert.equal(graph.edges.length, 1);
  assert.equal(calls.length, 1);
});

test("without a lookup, dangling edges are dropped instead of crashing the renderer", async () => {
  const graph = await grafeoRowsToGraph([{ r: knows2 }, { p: { nodes: [5], edges: [7] } }]);
  assert.deepEqual(graph, { nodes: [], edges: [] });
});

test("a failing lookup keeps the entities that were returned", async () => {
  const graph = await grafeoRowsToGraph([{ a: alix, p: { nodes: [0, 1], edges: [0] } }], () => {
    throw new Error("boom");
  });
  assert.deepEqual(nodeIds(graph), ["0"]);
  assert.equal(graph.edges.length, 0);
});

test("lookups use validated integer ids only", () => {
  assert.equal(grafeoNodeLookupQuery(["1", "2"]), "MATCH (n) WHERE id(n) IN [1, 2] RETURN n");
  assert.equal(grafeoEdgeLookupQuery(["3"]), "MATCH ()-[r]->() WHERE id(r) IN [3] RETURN r");
});

test("path members that are not ids are ignored safely", async () => {
  const calls = [];
  const graph = await grafeoRowsToGraph([{ p: { nodes: ["1) RETURN n //", -1, 1.5], edges: [] } }], fakeLookup(calls));
  assert.deepEqual(graph, { nodes: [], edges: [] });
  assert.deepEqual(calls, []);
});

test("bigint ids (above 2^53) are kept exact", async () => {
  const big = { _id: 9007199254740993n, _labels: ["Big"] };
  const graph = await grafeoRowsToGraph([{ n: big }]);
  assert.equal(graph.nodes[0].id, "9007199254740993");
});

test("scalar and empty results give an empty graph", async () => {
  assert.deepEqual(await grafeoRowsToGraph([{ name: "Alix", c: 3 }]), { nodes: [], edges: [] });
  assert.deepEqual(await grafeoRowsToGraph([]), { nodes: [], edges: [] });
  assert.deepEqual(await grafeoRowsToGraph(undefined), { nodes: [], edges: [] });
});

test("schema conversion: flat 0.5.x shape and legacy nested shape", () => {
  const flat = { mode: "lpg", labels: [{ name: "Person", count: 3 }], edge_types: [{ name: "KNOWS", count: 2 }] };
  assert.deepEqual(grafeoSchemaToTypes(flat), {
    nodeTypes: [{ label: "Person", properties: [], count: 3 }],
    edgeTypes: [{ type: "KNOWS", properties: [], count: 2 }],
  });
  const nested = { lpg: { labels: ["Person"], edgeTypes: ["KNOWS"] } };
  assert.deepEqual(grafeoSchemaToTypes(nested), {
    nodeTypes: [{ label: "Person", properties: [], count: null }],
    edgeTypes: [{ type: "KNOWS", properties: [], count: null }],
  });
  assert.deepEqual(grafeoSchemaToTypes(null), { nodeTypes: [], edgeTypes: [] });
});

test("wasm: pinned CDN location", () => {
  assert.match(embed.GRAFEO_WASM_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(embed.GRAFEO_WASM_CDN, `https://cdn.jsdelivr.net/npm/@grafeo-db/wasm@${embed.GRAFEO_WASM_VERSION}`);
});

test("wasm: runStatement routes GQL to execute and others to executeWithLanguage", () => {
  const calls = [];
  const db = {
    execute: (q) => (calls.push(["execute", q]), []),
    executeWithLanguage: (q, l) => (calls.push(["executeWithLanguage", q, l]), []),
  };
  embed.runStatement(db, "MATCH (n) RETURN n", "gql");
  embed.runStatement(db, "MATCH (n) RETURN n", undefined);
  embed.runStatement(db, "g.V()", "gremlin");
  assert.deepEqual(calls, [
    ["execute", "MATCH (n) RETURN n"],
    ["execute", "MATCH (n) RETURN n"],
    ["executeWithLanguage", "g.V()", "gremlin"],
  ]);
});

test("wasm: queries before connect report an error instead of throwing", async () => {
  const state = {};
  const model = { set: (k, v) => (state[k] = v), get: (k) => state[k], save_changes() {} };
  assert.equal(embed.isConnected(), false);
  assert.equal(await embed.executeQuery("MATCH (n) RETURN n", "gql", model), null);
  assert.match(state.query_error, /not initialized/);
});

test("server: request body, schema URL and error messages", () => {
  assert.deepEqual(server.buildQueryBody("q", undefined, "default"), { query: "q", language: "gql" });
  assert.deepEqual(server.buildQueryBody("q", "cypher", "movies"), { query: "q", language: "cypher", database: "movies" });
  assert.equal(server.schemaUrl("http://h:7474", "default"), "http://h:7474/db/default/schema");
  assert.equal(server.schemaUrl("http://h:7474", "my db"), "http://h:7474/db/my%20db/schema");
  assert.equal(server.errorMessage(400, '{"error":"bad_request","detail":"syntax error"}'), "syntax error");
  assert.equal(server.errorMessage(500, '{"error":"internal_error","detail":null}'), "internal_error");
  assert.equal(server.errorMessage(502, "Bad Gateway"), "Bad Gateway");
  assert.equal(server.errorMessage(503, ""), "Query failed with status 503");
});
