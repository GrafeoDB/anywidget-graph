/**
 * Grafeo WASM browser-side client (embed mode).
 * Lazy-loads @grafeo-db/wasm from the jsDelivr CDN on first use.
 */
import { grafeoRowsToGraph, grafeoSchemaToTypes } from "./grafeo-result.ts";
import type { GraphEdge, GraphNode, WidgetModel } from "./types.ts";
import { deleteGlobalSymbol, errorText, globalSymbol, setGlobalSymbol } from "./types.ts";

// The only place the browser engine version is set. Keep it exact and in
// lockstep with the `grafeo` Python extra in pyproject.toml.
export const GRAFEO_WASM_VERSION = "0.6.3";
export const GRAFEO_WASM_CDN = `https://cdn.jsdelivr.net/npm/@grafeo-db/wasm@${GRAFEO_WASM_VERSION}`;
// The demo's dataset (grafeo's Silicon Valley demo dataset), exact and in lockstep with the `demo` Python extra
export const GRAFEO_DATASETS_VERSION = "0.6.3";
export const GRAFEO_DATASETS_CDN = `https://cdn.jsdelivr.net/npm/@grafeo-db/datasets@${GRAFEO_DATASETS_VERSION}`;

// Each widget's in-browser database, keyed by its host model: every view of a widget shares it, and two widgets on a
// page each have their own (the engine itself is loaded once per page, see loadWasmBindings)
/** The slice of the @grafeo-db/wasm Database the widget uses. */
export interface WasmDatabase { close(): void; free(): void; execute(q: string): unknown; executeWithLanguage(q: string, lang: string): unknown; schema(): unknown }
type WasmBindings = { Database: new () => WasmDatabase } & Record<string, unknown>;
const wasmDatabases = new WeakMap<object, WasmDatabase>();

function databaseOf(model: WidgetModel): WasmDatabase | null {
  return wasmDatabases.get(model.host ?? model) ?? null;
}

// The loaded bindings live on the page, not in this module: a page can hold two copies of the widget's module (a
// notebook that reconnects to a restarted kernel, a cell run again) or another widget on the same engine
// (anywidget-vector), and they all share the one glue module the browser caches for its URL. A second instantiation
// would swap the glue's binary under the first one's databases, so the key is the glue's URL, as anywidget-vector's.
const WASM_BINDINGS_KEY = Symbol.for(`grafeo-wasm:${GRAFEO_WASM_CDN}/grafeo_wasm_bg.js`);

/**
 * Load the wasm-bindgen bindings once per page.
 *
 * @grafeo-db/wasm is built with `wasm-pack --target bundler`: it has no init
 * function and its entry point imports the .wasm file as an ES module, which
 * browsers cannot do without a bundler (esm.sh does not instantiate it
 * either). So the JS glue is imported directly and the binary is
 * instantiated here, the way wasm-bindgen's bundler entry point does it.
 */
function loadWasmBindings(): Promise<WasmBindings> {
  if (!globalSymbol<Promise<WasmBindings>>(WASM_BINDINGS_KEY)) {
    setGlobalSymbol(WASM_BINDINGS_KEY, (async () => {
      const bindings = await import(`${GRAFEO_WASM_CDN}/grafeo_wasm_bg.js`);
      const wasmUrl = `${GRAFEO_WASM_CDN}/grafeo_wasm_bg.wasm`;
      let module: WebAssembly.Module;
      try {
        module = await WebAssembly.compileStreaming(fetch(wasmUrl));
      } catch (_) {
        // Fallback for servers or proxies that do not send application/wasm
        const resp = await fetch(wasmUrl);
        if (!resp.ok) throw new Error("Failed to download " + wasmUrl + ": " + resp.status);
        module = await WebAssembly.compile(await resp.arrayBuffer());
      }
      // Every import of the binary is provided by the glue module ("./grafeo_wasm_bg.js")
      const imports: Record<string, unknown> = {};
      for (const { module: name } of WebAssembly.Module.imports(module)) imports[name] = bindings;
      const instance = (await WebAssembly.instantiate(module, imports as WebAssembly.Imports)) as WebAssembly.Instance;
      (bindings as any).__wbg_set_wasm(instance.exports);
      const start = (instance.exports as Record<string, unknown>).__wbindgen_start;
      if (typeof start === "function") (start as () => void)();
      return bindings;
    })().catch((err: unknown) => {
      deleteGlobalSymbol(WASM_BINDINGS_KEY);
      throw err;
    }));
  }
  return globalSymbol<Promise<WasmBindings>>(WASM_BINDINGS_KEY)!;
}

/**
 * Initialize Grafeo WASM database in the browser.
 */
export async function connect(model: WidgetModel): Promise<boolean> {
  model.set("connection_status", "connecting");
  model.save_changes();

  try {
    if (!databaseOf(model)) {
      const bindings = await loadWasmBindings();
      wasmDatabases.set(model.host ?? model, new bindings.Database());
    }

    model.set("connection_status", "connected");
    model.set("query_error", "");
    model.save_changes();

    await fetchSchema(model);
    return true;
  } catch (error) {
    model.set("connection_status", "error");
    model.set("query_error", "WASM init failed: " + errorText(error));
    model.save_changes();
    return false;
  }
}

/**
 * Close and disconnect the WASM database.
 */
export async function disconnect(model: WidgetModel): Promise<void> {
  const db = databaseOf(model);
  if (db) {
    try {
      db.close();
      db.free();
    } catch (_) {
      // ignore close errors
    }
    wasmDatabases.delete(model.host ?? model);
  }
  model.set("connection_status", "disconnected");
  model.save_changes();
}

/**
 * Check if connected.
 */
export function isConnected(model: WidgetModel): boolean {
  return databaseOf(model) !== null;
}

/**
 * Run one statement and return its rows (array of column-keyed objects).
 */
export function runStatement(db: WasmDatabase, query: string, language: string): unknown {
  if (language && language !== "gql") {
    return db.executeWithLanguage(query, language);
  }
  return db.execute(query);
}

/**
 * Execute a query against the WASM database.
 */
export async function executeQuery(query: string, language: string, model: WidgetModel): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; rows: number } | null> {
  const db = databaseOf(model);
  if (!db) {
    model.set("query_error", "WASM database not initialized");
    model.save_changes();
    return null;
  }

  model.set("query_running", true);
  model.set("query_error", "");
  model.save_changes();

  try {
    const rows = (runStatement(db, query, language) || []) as unknown[];
    const result = await grafeoRowsToGraph(rows, (lookup) => db.execute(lookup));
    model.set("query_running", false);
    model.save_changes();
    return { ...result, rows: rows.length };
  } catch (error) {
    model.set("query_running", false);
    model.set("query_error", "Query error: " + errorText(error));
    model.save_changes();
    return null;
  }
}

// The demo load of each database (see loadDemo)
const demoLoads = new WeakMap<WasmDatabase, Promise<void>>();

/**
 * Load the Silicon Valley demo dataset into the widget's database, then run `extra` (statements demo_graph() adds),
 * once per database: later calls, also from another view of the widget, wait for the same load. A load that fails
 * partway disconnects the database, so a retry starts from an empty one instead of adding the nodes twice.
 *
 * `baseUrl` exists for tests, which load a local copy of the package.
 */
export function loadDemo(model: WidgetModel, extra: string[] = [], baseUrl: string = GRAFEO_DATASETS_CDN): Promise<void> {
  const db = databaseOf(model);
  if (!db) return Promise.reject(new Error("WASM database not initialized"));
  let loading = demoLoads.get(db);
  if (!loading) {
    loading = (async () => {
      try {
        const { statements } = (await import(`${baseUrl}/dist/silicon-valley/gql.js`)) as { statements: string[] };
        for (const statement of [...statements, ...extra]) runStatement(db, statement, "gql");
      } catch (err) {
        demoLoads.delete(db);
        await disconnect(model);
        throw err;
      }
    })();
    demoLoads.set(db, loading);
  }
  return loading.then(() => fetchSchema(model));
}

/**
 * Fetch schema from the WASM database.
 */
export async function fetchSchema(model: WidgetModel): Promise<void> {
  const db = databaseOf(model);
  if (!db) return;

  try {
    const { nodeTypes, edgeTypes } = grafeoSchemaToTypes(db.schema());
    model.set("schema_node_types", nodeTypes);
    model.set("schema_edge_types", edgeTypes);
    model.save_changes();
  } catch (err) {
    // Schema fetch is non-critical
  }
}
