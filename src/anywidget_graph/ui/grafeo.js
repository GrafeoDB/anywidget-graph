/**
 * Grafeo Server browser-side client (HTTP mode).
 * Mirrors the neo4j.js pattern for connecting to grafeo-server.
 */
import { grafeoRowsToGraph, grafeoSchemaToTypes } from "./grafeo-result.js";

let serverUrl = null;
let authHeaders = {};

/**
 * Connect to a Grafeo server.
 */
export async function connect(url, username, password, model) {
  serverUrl = (url || "http://localhost:7474").replace(/\/+$/, "");
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

async function postQuery(body) {
  const resp = await fetch(serverUrl + "/query", {
    method: "POST",
    headers: authHeaders,
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
  if (!serverUrl) {
    model.set("query_error", "Not connected to Grafeo server");
    model.save_changes();
    return null;
  }

  model.set("query_running", true);
  model.set("query_error", "");
  model.save_changes();

  try {
    // Response: {columns, rows: [[value, ...]], execution_time_ms?, counters?, ...}
    const result = await postQuery(buildQueryBody(query, language, database));
    const graph = await grafeoRowsToGraph(result.rows || [], async (lookup) => {
      const found = await postQuery(buildQueryBody(lookup, "gql", database));
      return found.rows || [];
    });
    model.set("query_running", false);
    model.save_changes();
    return graph;
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
  if (!serverUrl) return;

  try {
    const database = model.get("connection_database") || "default";
    const resp = await fetch(schemaUrl(serverUrl, database), {
      headers: authHeaders,
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
