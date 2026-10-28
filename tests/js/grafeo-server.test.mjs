// The grafeo-server client against a fake fetch that answers grafeo-server's endpoints with pinned responses: the
// contract a host serving these endpoints itself (Deriva's studio) must keep. Run with: node --test "tests/js/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";

import * as server from "../../src/anywidget_graph/ui/grafeo.js";

// grafeo-server 0.6 responses: nodes and edges with their fields flat, tagged decimals and dates
const SCHEMA = { name: "default", labels: [{ name: "File", count: 2 }], edge_types: [{ name: "IMPORTS", count: 1 }], property_keys: ["name"] };
const a = { _id: 0, _labels: ["File"], name: "a.py", size: { $decimal: "1.50" }, changed: { $date: "2026-10-01" } };
const b = { _id: 1, _labels: ["File"], name: "b.py" };
const imports = { _id: 0, _type: "IMPORTS", _source: 0, _target: 1, weight: { $decimal: "0.75" } };
const ANSWERS = {
  "MATCH (a)-[r]->(b) RETURN a, r, b": { columns: ["a", "r", "b"], rows: [[a, imports, b]] },
  "MATCH p = ()-[]->() RETURN p": { columns: ["p"], rows: [[{ nodes: [a, b], edges: [imports] }]] },
  "INSERT (:File)": { columns: [], rows: [], counters: { nodes_created: 1 } },
};

const requests = [];
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url, method: init.method || "GET", headers: init.headers, body: init.body && JSON.parse(init.body) });
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (url.endsWith("/health")) return json({ status: "ok" });
  if (url.includes("/db/") && url.endsWith("/schema")) return json(SCHEMA);
  if (url.endsWith("/query")) {
    const { query } = JSON.parse(init.body);
    return ANSWERS[query] ? json(ANSWERS[query]) : json({ error: "bad_request", detail: "syntax error" }, 400);
  }
  return json({ error: "not_found" }, 404);
};

function fakeModel(values = {}) {
  return { get: (k) => values[k], set: (k, v) => { values[k] = v; }, save_changes() {}, values };
}

test("connect checks /health, then reads /db/{database}/schema into the filter panel", async () => {
  requests.length = 0;
  const model = fakeModel({ connection_database: "graph" });
  assert.equal(await server.connect("http://studio.local/grafeo/", "", "", model), true);
  assert.equal(model.values.connection_status, "connected");
  assert.deepEqual(requests.map((r) => r.url), ["http://studio.local/grafeo/health", "http://studio.local/grafeo/db/graph/schema"]);
  assert.deepEqual(model.values.schema_node_types.map((t) => t.label), ["File"]);
  assert.deepEqual(model.values.schema_edge_types.map((t) => t.type), ["IMPORTS"]);
});

test("a query posts {query, language, database} and draws grafeo-server's nodes, edges and paths", async () => {
  const model = fakeModel({ connection_database: "graph" });
  await server.connect("http://studio.local/grafeo", "user", "secret", model);
  requests.length = 0;
  const result = await server.executeQuery("MATCH (a)-[r]->(b) RETURN a, r, b", "gql", "graph", model);
  assert.deepEqual(requests[0].body, { query: "MATCH (a)-[r]->(b) RETURN a, r, b", language: "gql", database: "graph" });
  assert.equal(requests[0].headers.Authorization, "Basic " + btoa("user:secret"));
  assert.equal(result.rows, 1);
  assert.deepEqual(result.nodes.map((n) => [n.id, n.label, n.labels]), [["0", "a.py", ["File"]], ["1", "b.py", ["File"]]]);
  assert.equal(result.nodes[0].size, 1.5);
  assert.equal(result.nodes[0].changed, "2026-10-01");
  assert.deepEqual(result.edges, [{ label: "IMPORTS", weight: 0.75, source: "0", target: "1" }]);

  const path = await server.executeQuery("MATCH p = ()-[]->() RETURN p", "gql", "graph", model);
  assert.equal(path.nodes.length, 2);
  assert.equal(path.edges.length, 1);

  const write = await server.executeQuery("INSERT (:File)", "gql", "graph", model);
  assert.deepEqual(write, { nodes: [], edges: [], rows: 0 });
});

test("a failed query reports the server's detail", async () => {
  const model = fakeModel();
  await server.connect("http://studio.local/grafeo", "", "", model);
  assert.equal(await server.executeQuery("MATCH (n RETURN n", "gql", "default", model), null);
  assert.equal(model.values.query_error, "Query error: syntax error");
});

test("two widgets on a page keep their own server", async () => {
  const first = fakeModel(), second = fakeModel();
  await server.connect("http://one.local", "", "", first);
  await server.connect("http://two.local", "", "", second);
  requests.length = 0;
  await server.executeQuery("INSERT (:File)", "gql", "default", first);
  await server.executeQuery("INSERT (:File)", "gql", "default", second);
  assert.deepEqual(requests.map((r) => r.url), ["http://one.local/query", "http://two.local/query"]);
  await server.disconnect(first);
  assert.equal(server.isConnected(first), false);
  assert.equal(server.isConnected(second), true);
});
