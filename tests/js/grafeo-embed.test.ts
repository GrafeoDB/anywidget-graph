// The WASM client's page-wide engine and the demo's dataset loading. Run with: node --test tests/js/*.test.ts
// A fake engine stands in for @grafeo-db/wasm: it is put where the client looks for the loaded bindings.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as embed from "../../src/anywidget_graph/ui/grafeo-embed.ts";
import { fakeModel } from "./helpers.ts";
import { setGlobalSymbol } from "../../src/anywidget_graph/ui/types.ts";

const created: FakeDatabase[] = [];
class FakeDatabase implements embed.WasmDatabase {
  ran: string[] = [];
  constructor() {
    created.push(this);
  }
  execute(query: string) {
    this.ran.push(query);
    return query.startsWith("RETURN") ? [{ x: 1 }] : [];
  }
  executeWithLanguage(query: string, _language: string) {
    this.ran.push(query);
    return [];
  }
  close() {}
  free() {}
  schema() {
    return { nodeTypes: [], edgeTypes: [] };
  }
}
// The page-wide key anywidget-vector uses too: the glue module's URL
setGlobalSymbol(Symbol.for(`grafeo-wasm:${embed.GRAFEO_WASM_CDN}/grafeo_wasm_bg.js`), Promise.resolve({ Database: FakeDatabase }));



test("every copy of the module on a page uses the one loaded engine", async () => {
  const model = fakeModel();
  assert.equal(await embed.connect(model), true);
  assert.equal(model.values.connection_status, "connected");
  // A second copy of the module (a notebook that reconnected, a cell run again) finds the same bindings
  const copy = await import("../../src/anywidget_graph/ui/grafeo-embed.ts?copy=2") as unknown as typeof embed;
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

test("a query reports its row count, so the widget can tell a write from rows with nothing to draw", async () => {
  const model = fakeModel();
  await embed.connect(model);
  assert.deepEqual(await embed.executeQuery("RETURN 1 AS x", "gql", model), { nodes: [], edges: [], rows: 1 });
  assert.deepEqual(await embed.executeQuery("INSERT (:Movie)", "gql", model), { nodes: [], edges: [], rows: 0 });
  assert.equal(model.values.query_error, "");
});

/** A local stand-in for @grafeo-db/datasets: dist/silicon-valley/gql.js exporting `statements`, or throwing. */
async function fakeDatasets(statements: string[] | null): Promise<string> {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const root = await mkdtemp(join(tmpdir(), "awg-datasets-"));
  await mkdir(join(root, "dist", "silicon-valley"), { recursive: true });
  const body = statements ? `export const statements = ${JSON.stringify(statements)};` : `throw new Error("offline");`;
  await writeFile(join(root, "dist", "silicon-valley", "gql.js"), body);
  return pathToFileURL(root).href;
}

test("the demo's dataset loads into a widget's database once, then the statements demo_graph() adds", async () => {
  const base = await fakeDatasets(["INSERT (:Company {key: 'pied-piper'})", "INSERT (:Person {key: 'richard'})"]);
  const host = fakeModel();
  const view = { ...fakeModel(), host };
  await embed.connect(host);
  const db = created.at(-1)!;
  const before = db.ran.length;
  // Two views of one widget load at once: one load, both wait for it
  await Promise.all([embed.loadDemo(host, ["MATCH (n) SET n.seen = true"], base), embed.loadDemo(view, [], base)]);
  assert.deepEqual(db.ran.slice(before), [
    "INSERT (:Company {key: 'pied-piper'})",
    "INSERT (:Person {key: 'richard'})",
    "MATCH (n) SET n.seen = true",
  ]);
  await embed.loadDemo(host, [], base);
  assert.equal(db.ran.length, before + 3, "drawn again, nothing loads twice");
});

test("a demo load that fails frees the database, so a retry starts from an empty one", async () => {
  const model = fakeModel();
  await embed.connect(model);
  await assert.rejects(embed.loadDemo(model, [], await fakeDatasets(null)), /offline/);
  assert.equal(embed.isConnected(model), false);
  await embed.connect(model);
  const fresh = created.at(-1)!;
  await embed.loadDemo(model, [], await fakeDatasets(["INSERT (:City {key: 'palo-alto'})"]));
  assert.deepEqual(fresh.ran, ["INSERT (:City {key: 'palo-alto'})"]);
});
