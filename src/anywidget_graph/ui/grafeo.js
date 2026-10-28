/**
 * Grafeo Server browser-side client (HTTP mode).
 * Mirrors the neo4j.js pattern for connecting to grafeo-server.
 */
import { grafeoRowsToGraph, grafeoSchemaToTypes } from "./grafeo-result.js";

// Each widget's server: {url, headers}, keyed by its host model, so every view of a widget shares it and two widgets
// on a page can use different servers
const serverConnections = new WeakMap();

function serverOf(model) {
  return serverConnections.get(model.host ?? model) ?? null;
}

/**
 * Connect to a Grafeo server.
 */
export async function connect(url, username, password, model) {
  const server = { url: (url || "http://localhost:7474").replace(/\/+$/, ""), headers: { "Content-Type": "application/json" } };
  if (username && password) {
    server.headers["Authorization"] = "Basic " + btoa(username + ":" + password);
  }
  serverConnections.set(model.host ?? model, server);

  model.set("connection_status", "connecting");
  model.save_changes();

  try {
    const resp = await fetch(server.url + "/health", { headers: server.headers });
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
    serverConnections.delete(model.host ?? model);
    return false;
  }
}

/**
 * Disconnect from Grafeo server.
 */
export async function disconnect(model) {
  serverConnections.delete(model.host ?? model);
  model.set("connection_status", "disconnected");
  model.save_changes();
}

/**
 * Check if connected.
 */
export function isConnected(model) {
  return serverOf(model) !== null;
}

/**
 * Build the POST /query body. The server defaults to the "default" database.
 */
export function buildQueryBody(query, language, database) {
  const body = { query, language: language || "gql" };
  if (database && database !== "default") {
    body.database = database;
  }
  return body;
}

/**
 * Turn a failed response body into a readable message.
 * grafeo-server sends {"error": code, "detail": message}.
 */
export function errorMessage(status, text) {
  try {
    const body = JSON.parse(text);
    if (body && (body.detail || body.error)) return body.detail || body.error;
  } catch (_) {
    // not JSON
  }
  return text || "Query failed with status " + status;
}

async function postQuery(server, body) {
  const resp = await fetch(server.url + "/query", {
    method: "POST",
    headers: server.headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(errorMessage(resp.status, await resp.text()));
  }
  return resp.json();
}

/**
 * Execute a query against Grafeo server.
 */
export async function executeQuery(query, language, database, model) {
  const server = serverOf(model);
  if (!server) {
    model.set("query_error", "Not connected to Grafeo server");
    model.save_changes();
    return null;
  }

  model.set("query_running", true);
  model.set("query_error", "");
  model.save_changes();

  try {
    // Response: {columns, rows: [[value, ...]], execution_time_ms?, counters?, ...}
    const result = await postQuery(server, buildQueryBody(query, language, database));
    const rows = result.rows || [];
    const graph = await grafeoRowsToGraph(rows, async (lookup) => {
      const found = await postQuery(server, buildQueryBody(lookup, "gql", database));
      return found.rows || [];
    });
    model.set("query_running", false);
    model.save_changes();
    return { ...graph, rows: rows.length };
  } catch (error) {
    model.set("query_running", false);
    model.set("query_error", "Query error: " + error.message);
    model.save_changes();
    return null;
  }
}

/**
 * Schema endpoint for a database: GET /db/{name}/schema.
 */
export function schemaUrl(baseUrl, database) {
  return baseUrl + "/db/" + encodeURIComponent(database || "default") + "/schema";
}

/**
 * Fetch schema from Grafeo server.
 */
export async function fetchSchema(model) {
  const server = serverOf(model);
  if (!server) return;

  try {
    const database = model.get("connection_database") || "default";
    const resp = await fetch(schemaUrl(server.url, database), {
      headers: server.headers,
    });
    if (!resp.ok) return;

    // Response: {name, labels: [{name, count}], edge_types: [{name, count}], property_keys}
    const { nodeTypes, edgeTypes } = grafeoSchemaToTypes(await resp.json());
    model.set("schema_node_types", nodeTypes);
    model.set("schema_edge_types", edgeTypes);
    model.save_changes();
  } catch (err) {
    // Schema fetch is non-critical; silently fail
  }
}
