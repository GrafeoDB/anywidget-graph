/**
 * Grafeo WASM browser-side client (embed mode).
 * Lazy-loads @grafeo-db/wasm from the jsDelivr CDN on first use.
 */
import { grafeoRowsToGraph, grafeoSchemaToTypes, nothingToDrawNote } from "./grafeo-result.js";

// The only place the browser engine version is set. Keep it exact and in
// lockstep with the `grafeo` Python extra in pyproject.toml.
export const GRAFEO_WASM_VERSION = "0.6.0";
export const GRAFEO_WASM_CDN = `https://cdn.jsdelivr.net/npm/@grafeo-db/wasm@${GRAFEO_WASM_VERSION}`;

let wasmDb = null;
// The statement lists each database has loaded (see loadStatements)
const loadedStatements = new WeakMap();

// The loaded bindings live on the page, not in this module: a page can hold two copies of the widget's module (a
// notebook that reconnects to a restarted kernel, a cell run again), and they share the one glue module the browser
// caches for the CDN URL. A second instantiation would swap the glue's binary under the first copy's database.
const WASM_BINDINGS_KEY = Symbol.for(`anywidget-graph.grafeo-wasm@${GRAFEO_WASM_VERSION}`);

/**
 * Load the wasm-bindgen bindings once per page.
 *
 * @grafeo-db/wasm is built with `wasm-pack --target bundler`: it has no init
 * function and its entry point imports the .wasm file as an ES module, which
 * browsers cannot do without a bundler (esm.sh does not instantiate it
 * either). So the JS glue is imported directly and the binary is
 * instantiated here, the way wasm-bindgen's bundler entry point does it.
 */
function loadWasmBindings() {
  if (!globalThis[WASM_BINDINGS_KEY]) {
    globalThis[WASM_BINDINGS_KEY] = (async () => {
      const bindings = await import(`${GRAFEO_WASM_CDN}/grafeo_wasm_bg.js`);
      const wasmUrl = `${GRAFEO_WASM_CDN}/grafeo_wasm_bg.wasm`;
      let module;
      try {
        module = await WebAssembly.compileStreaming(fetch(wasmUrl));
      } catch (_) {
        // Fallback for servers or proxies that do not send application/wasm
        const resp = await fetch(wasmUrl);
        if (!resp.ok) throw new Error("Failed to download " + wasmUrl + ": " + resp.status);
        module = await WebAssembly.compile(await resp.arrayBuffer());
      }
      // Every import of the binary is provided by the glue module ("./grafeo_wasm_bg.js")
      const imports = {};
      for (const { module: name } of WebAssembly.Module.imports(module)) imports[name] = bindings;
      const instance = await WebAssembly.instantiate(module, imports);
      bindings.__wbg_set_wasm(instance.exports);
      if (typeof instance.exports.__wbindgen_start === "function") instance.exports.__wbindgen_start();
      return bindings;
    })().catch((err) => {
      delete globalThis[WASM_BINDINGS_KEY]; // allow a retry after a network error
      throw err;
    });
  }
  return globalThis[WASM_BINDINGS_KEY];
}

/**
 * Initialize Grafeo WASM database in the browser.
 */
export async function connect(model) {
  model.set("connection_status", "connecting");
  model.save_changes();

  try {
    if (!wasmDb) {
      const bindings = await loadWasmBindings();
      wasmDb = new bindings.Database();
    }

    model.set("connection_status", "connected");
    model.set("query_error", "");
    model.save_changes();

    await fetchSchema(model);
    return true;
  } catch (error) {
    model.set("connection_status", "error");
    model.set("query_error", "WASM init failed: " + error.message);
    model.save_changes();
    return false;
  }
}

/**
 * Close and disconnect the WASM database.
 */
export async function disconnect(model) {
  if (wasmDb) {
    try {
      wasmDb.close();
      wasmDb.free();
    } catch (_) {
      // ignore close errors
    }
    wasmDb = null;
  }
  model.set("connection_status", "disconnected");
  model.save_changes();
}

/**
 * Check if connected.
 */
export function isConnected() {
  return wasmDb !== null;
}

/**
 * Run one statement and return its rows (array of column-keyed objects).
 */
export function runStatement(db, query, language) {
  if (language && language !== "gql") {
    return db.executeWithLanguage(query, language);
  }
  return db.execute(query);
}

/**
 * Execute a query against the WASM database.
 */
export async function executeQuery(query, language, model) {
  if (!wasmDb) {
    model.set("query_error", "WASM database not initialized");
    model.save_changes();
    return null;
  }

  model.set("query_running", true);
  model.set("query_error", "");
  model.save_changes();

  try {
    const db = wasmDb;
    const rows = runStatement(db, query, language);
    const result = await grafeoRowsToGraph(rows, (lookup) => db.execute(lookup));
    model.set("query_running", false);
    model.set("query_error", nothingToDrawNote(rows, result));
    model.save_changes();
    return result;
  } catch (error) {
    model.set("query_running", false);
    model.set("query_error", "Query error: " + error.message);
    model.save_changes();
    return null;
  }
}

/**
 * Run data-loading statements one at a time (the engine rejects several
 * `;`-separated statements in one call), then refresh the schema panel.
 * Returns the number of statements that failed.
 */
export async function loadStatements(statements, model) {
  if (!wasmDb) return statements.length;

  // The same statements go into a database once: a widget drawn again (a second view of it, a notebook that
  // reconnects) shares the page's database and would otherwise load its data twice
  const key = JSON.stringify(statements);
  const loaded = loadedStatements.get(wasmDb) || new Set();
  loadedStatements.set(wasmDb, loaded);
  if (loaded.has(key)) {
    await fetchSchema(model);
    return 0;
  }
  loaded.add(key);

  let failed = 0;
  for (const stmt of statements) {
    const text = stmt.trim().replace(/;$/, "");
    if (!text) continue;
    try {
      runStatement(wasmDb, text, "gql");
    } catch (err) {
      failed += 1;
      console.warn("Grafeo WASM statement failed:", text, err);
    }
  }
  await fetchSchema(model);
  return failed;
}

/**
 * Fetch schema from the WASM database.
 */
export async function fetchSchema(model) {
  if (!wasmDb) return;

  try {
    const { nodeTypes, edgeTypes } = grafeoSchemaToTypes(wasmDb.schema());
    model.set("schema_node_types", nodeTypes);
    model.set("schema_edge_types", edgeTypes);
    model.save_changes();
  } catch (err) {
    // Schema fetch is non-critical
  }
}
