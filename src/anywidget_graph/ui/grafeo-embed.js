/**
 * Grafeo WASM browser-side client (embed mode).
 * Lazy-loads @grafeo-db/wasm from esm.sh on first use.
 */

let wasmDb = null;
let wasmInitialized = false;

/**
 * Initialize Grafeo WASM database in the browser.
 */
export async function connect(model) {
  model.set("connection_status", "connecting");
  model.save_changes();

  try {
    if (!wasmInitialized) {
      const mod = await import("https://esm.sh/@grafeo-db/wasm@0.5.0");
      await mod.default();
      wasmInitialized = true;
      wasmDb = new mod.Database();
    } else if (!wasmDb) {
      const mod = await import("https://esm.sh/@grafeo-db/wasm@0.5.0");
      wasmDb = new mod.Database();
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
    let result;
    if (language && language !== "gql") {
      result = wasmDb.executeWithLanguage(query, language);
    } else {
      result = wasmDb.execute(query);
    }
    model.set("query_running", false);
    model.save_changes();
    return processResult(result);
  } catch (error) {
    model.set("query_running", false);
    model.set("query_error", "Query error: " + error.message);
    model.save_changes();
    return null;
  }
}

/**
 * Fetch schema from the WASM database.
 */
export async function fetchSchema(model) {
  if (!wasmDb) return;

  try {
    const schema = wasmDb.schema();
    const nodeTypes = [];
    const edgeTypes = [];

    if (schema && schema.lpg) {
      (schema.lpg.labels || []).forEach((l) => {
        nodeTypes.push({
          label: typeof l === "string" ? l : l.name || String(l),
          properties: l.properties || [],
        });
      });

      (schema.lpg.edgeTypes || []).forEach((r) => {
        edgeTypes.push({
          type: typeof r === "string" ? r : r.name || String(r),
          properties: r.properties || [],
        });
      });
    }

    model.set("schema_node_types", nodeTypes);
    model.set("schema_edge_types", edgeTypes);
    model.save_changes();
  } catch (err) {
    // Schema fetch is non-critical
  }
}

/**
 * Process WASM execute() result into {nodes, edges}.
 * execute() returns Array<Record<string, unknown>>.
 */
function processResult(result) {
  const nodes = new Map();
  const edges = [];

  if (!Array.isArray(result)) return { nodes: [], edges: [] };

  for (const row of result) {
    for (const val of Object.values(row)) {
      if (val && typeof val === "object") {
        processValue(val, nodes, edges);
      }
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}

/**
 * Process a single value from query results.
 */
function processValue(val, nodes, edges) {
  if (Array.isArray(val)) {
    val.forEach((v) => {
      if (v && typeof v === "object") processValue(v, nodes, edges);
    });
    return;
  }

  if (val.labels && val.id !== undefined) {
    const id = String(val.id);
    if (!nodes.has(id)) {
      const props = val.properties || {};
      nodes.set(id, {
        id,
        label: props.name || props.title || val.labels[0] || id,
        labels: val.labels,
        ...props,
      });
    }
  } else if (val.type && (val.start !== undefined || val.source !== undefined)) {
    const props = val.properties || {};
    edges.push({
      source: String(val.start ?? val.source),
      target: String(val.end ?? val.target),
      label: val.type,
      ...props,
    });
  } else if (val.nodes && val.relationships) {
    (val.nodes || []).forEach((n) => processValue(n, nodes, edges));
    (val.relationships || []).forEach((r) => processValue(r, nodes, edges));
  }
}
