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
// The page-wide key anywidget-vector uses too: the glue module's URL
globalThis[Symbol.for(`grafeo-wasm:${embed.GRAFEO_WASM_CDN}/grafeo_wasm_bg.js`)] = Promise.resolve({ Database: FakeDatabase });

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
  const before = created.length;
  assert.equal(await copy.connect(fakeModel()), true);
  assert.equal(created.length, before + 1, "the copy opens a database on the shared engine");
});

test("each widget has its own database, and every view of a widget shares it", async () => {
  const host = fakeModel();
  const view = { ...fakeModel(), host };
  const other = fakeModel();
  const before = created.length;
  await embed.connect(host);
  await embed.connect(view);
  await embed.connect(other);
  assert.equal(created.length, before + 2, "the widget's two views share one database");
  assert.equal(embed.isConnected(view), true);
  assert.equal(embed.isConnected(fakeModel()), false);
  await embed.disconnect(other);
  assert.equal(embed.isConnected(other), false);
  assert.equal(embed.isConnected(host), true, "closing one widget's database leaves the others");
});

test("the same statements load into a database once, however often a widget is drawn", async () => {
  const model = fakeModel();
  await embed.connect(model);
  const db = created.at(-1);
  const before = db.ran.length;
  const statements = ["CREATE (:Movie {id: 'm1'});", "CREATE (:Person {id: 'p1'})", ""];
  assert.equal(await embed.loadStatements(statements, model), 0);
  assert.equal(await embed.loadStatements(statements, model), 0);
  assert.deepEqual(db.ran.slice(before), ["CREATE (:Movie {id: 'm1'})", "CREATE (:Person {id: 'p1'})"]);
  // Other statements still load
  await embed.loadStatements(["CREATE (:Movie {id: 'm2'})"], model);
  assert.equal(db.ran.at(-1), "CREATE (:Movie {id: 'm2'})");
});

test("a query reports its row count, so the widget can tell a write from rows with nothing to draw", async () => {
  const model = fakeModel();
  await embed.connect(model);
  assert.deepEqual(await embed.executeQuery("RETURN 1 AS x", "gql", model), { nodes: [], edges: [], rows: 1 });
  assert.deepEqual(await embed.executeQuery("INSERT (:Movie)", "gql", model), { nodes: [], edges: [], rows: 0 });
  assert.equal(model.values.query_error, "");
});
