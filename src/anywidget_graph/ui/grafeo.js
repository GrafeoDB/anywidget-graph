/**
 * Grafeo Server browser-side client (HTTP mode).
 * Mirrors the neo4j.js pattern for connecting to grafeo-server.
 */

let serverUrl = null;
let authHeaders = {};

/**
 * Connect to a Grafeo server.
 */
export async function connect(url, username, password, model) {
  serverUrl = url || "http://localhost:7474";
  authHeaders = { "Content-Type": "application/json" };

  if (username && password) {
    authHeaders["Authorization"] = "Basic " + btoa(username + ":" + password);
  }

  model.set("connection_status", "connecting");
  model.save_changes();

  try {
    const resp = await fetch(serverUrl + "/health", { headers: authHeaders });
    if (!resp.ok) throw new Error("Server returned " + resp.status);

    model.set("connection_status", "connected");
    model.set("query_error", "");
    model.save_changes();

    await fetchSchema(model);
    return true;
  } catch (error) {
    model.set("connection_status", "error");
    model.set("query_error", "Connection failed: " + error.message);
    model.save_changes();
    serverUrl = null;
    return false;
  }
}

/**
 * Disconnect from Grafeo server.
 */
export async function disconnect(model) {
  serverUrl = null;
  authHeaders = {};
  model.set("connection_status", "disconnected");
  model.save_changes();
}

/**
 * Check if connected.
 */
export function isConnected() {
  return serverUrl !== null;
}

/**
 * Execute a query against Grafeo server.
 */
export async function executeQuery(query, language, database, model) {
  if (!serverUrl) {
    model.set("query_error", "Not connected to Grafeo server");
    model.save_changes();
    return null;
  }

  model.set("query_running", true);
  model.set("query_error", "");
  model.save_changes();

  try {
    const body = { query, language: language || "gql" };
    if (database && database !== "default") {
      body.database = database;
    }

    const resp = await fetch(serverUrl + "/query", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(errText || "Query failed with status " + resp.status);
    }

    const result = await resp.json();
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
 * Fetch schema from Grafeo server.
 */
export async function fetchSchema(model) {
  if (!serverUrl) return;

  try {
    const database = model.get("connection_database") || "default";
    const resp = await fetch(serverUrl + "/databases/" + database + "/schema", {
      headers: authHeaders,
    });
    if (!resp.ok) return;

    const schema = await resp.json();
    const nodeTypes = (schema.labels || []).map((l) => ({
      label: typeof l === "string" ? l : l.name || l,
      properties: l.properties || [],
      count: l.count || null,
    }));
    const edgeTypes = (schema.edge_types || schema.relationships || []).map((e) => ({
      type: typeof e === "string" ? e : e.name || e,
      properties: e.properties || [],
      count: e.count || null,
    }));

    model.set("schema_node_types", nodeTypes);
    model.set("schema_edge_types", edgeTypes);
    model.save_changes();
  } catch (err) {
    // Schema fetch is non-critical; silently fail
  }
}

/**
 * Process Grafeo server result into {nodes, edges}.
 */
function processResult(result) {
  const nodes = new Map();
  const edges = [];
  const rows = result.rows || result.data || [];
  const columns = result.columns || [];

  for (const row of rows) {
    // Row can be an array (positional) or object (named)
    const values = Array.isArray(row) ? row : columns.map((c) => row[c]);

    for (const val of values) {
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

  // Detect node: has labels and id
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
  }
  // Detect edge: has type and start/end (or source/target)
  else if (val.type && (val.start !== undefined || val.source !== undefined)) {
    const props = val.properties || {};
    edges.push({
      source: String(val.start ?? val.source),
      target: String(val.end ?? val.target),
      label: val.type,
      ...props,
    });
  }
  // Detect path: has nodes and relationships arrays
  else if (val.nodes && val.relationships) {
    (val.nodes || []).forEach((n) => processValue(n, nodes, edges));
    (val.relationships || []).forEach((r) => processValue(r, nodes, edges));
  }
}
