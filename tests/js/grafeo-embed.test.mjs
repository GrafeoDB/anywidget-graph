// The WASM client's page-wide engine and its demo data loading. Run with: node --test "tests/js/*.test.mjs"
// A fake engine stands in for @grafeo-db/wasm: it is put where the client looks for the loaded bindings.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as embed from "../../src/anywidget_graph/ui/grafeo-embed.js";

const created = [];
class FakeDatabase {
  constructor() {
    this.ran = [];
    created.push(this);
  }
  execute(query) {
    this.ran.push(query);
    return query.startsWith("RETURN") ? [{ x: 1 }] : [];
  }
  schema() {
    return { nodeTypes: [], edgeTypes: [] };
  }
}
globalThis[Symbol.for(`anywidget-graph.grafeo-wasm@${embed.GRAFEO_WASM_VERSION}`)] = Promise.resolve({ Database: FakeDatabase });

function fakeModel() {
  const values = {};
  return { get: (name) => values[name], set: (name, value) => { values[name] = value; }, save_changes() {}, values };
}

test("every copy of the module on a page uses the one loaded engine", async () => {
  const model = fakeModel();
  assert.equal(await embed.connect(model), true);
  assert.equal(model.values.connection_status, "connected");
  // A second copy of the module (a notebook that reconnected, a cell run again) finds the same bindings
  const copy = await import("../../src/anywidget_graph/ui/grafeo-embed.js?copy=2");
  assert.equal(await copy.connect(fakeModel()), true);
  assert.equal(created.length, 2, "each copy opens its own database on the shared engine");
});

test("the same statements load into a database once, however often a widget is drawn", async () => {
  const model = fakeModel();
  await embed.connect(model);
  const db = created[0];
  const before = db.ran.length;
  const statements = ["CREATE (:Movie {id: 'm1'});", "CREATE (:Person {id: 'p1'})", ""];
  assert.equal(await embed.loadStatements(statements, model), 0);
  assert.equal(await embed.loadStatements(statements, model), 0);
  assert.deepEqual(db.ran.slice(before), ["CREATE (:Movie {id: 'm1'})", "CREATE (:Person {id: 'p1'})"]);
  // Other statements still load
  await embed.loadStatements(["CREATE (:Movie {id: 'm2'})"], model);
  assert.equal(db.ran.at(-1), "CREATE (:Movie {id: 'm2'})");
});

test("a query whose rows hold nothing to draw says so; a write says nothing", async () => {
  const model = fakeModel();
  await embed.connect(model);
  assert.deepEqual(await embed.executeQuery("RETURN 1 AS x", "gql", model), { nodes: [], edges: [] });
  assert.match(model.values.query_error, /nothing to draw/);
  await embed.executeQuery("INSERT (:Movie)", "gql", model);
  assert.equal(model.values.query_error, "");
});
