/**
 * Query execution for the toolbar's run button and the schema panel, shared by the 2D view (index.js) and the 3D
 * view (index3d.js): browser-side backends (Neo4j driver, Grafeo server, Grafeo WASM) run here; Python-side backends
 * are triggered through the _execute_query trait and answer by replacing nodes/edges.
 */

import { capQueryResult, queryResultNote } from "./defaults.ts";
import type { WidgetModel } from "./types.ts";
import * as neo4jBackend from "./neo4j.ts";
import * as grafeoBackend from "./grafeo.ts";
import * as grafeoEmbedBackend from "./grafeo-embed.ts";

// The newest browser-side query of each model: an older one that finishes later must not replace its result
const latestQuery = new WeakMap<object, number>();

/**
 * A browser-side mode connects with the configured settings on its first query, so the query box works without
 * pressing Connect in the settings panel first. False when the connection failed (its message is in query_error).
 */
async function connectForQuery(model: WidgetModel, backend: string, mode: string): Promise<boolean> {
  if (backend === "neo4j" && !neo4jBackend.isConnected(model)) {
    return neo4jBackend.connect(model.get("connection_uri"), model.get("connection_username"), model.get("connection_password"), model);
  }
  if (backend === "grafeo" && mode === "server" && !grafeoBackend.isConnected(model)) {
    return grafeoBackend.connect(model.get("grafeo_server_url"), model.get("connection_username"), model.get("connection_password"), model);
  }
  if (backend === "grafeo" && mode === "wasm" && !grafeoEmbedBackend.isConnected(model)) {
    return grafeoEmbedBackend.connect(model);
  }
  return true;
}

/**
 * Execute a query based on the current backend and connection mode.
 */
export async function executeQuery(model: WidgetModel): Promise<void> {
  const backend = model.get("database_backend");
  const query = model.get("query");
  const mode = model.get("grafeo_connection_mode");
  const language = model.get("query_language") || "cypher";

  if (!query.trim()) {
    model.set("query_error", "Please enter a query");
    model.save_changes();
    return;
  }

  // Every view of a widget shares one count, so a view's older query cannot replace another view's newer result
  const key = model.host ?? model;
  const ticket = (latestQuery.get(key) || 0) + 1;
  latestQuery.set(key, ticket);
  model.set("query_note", "");
  if (!(await connectForQuery(model, backend, mode))) return;
  const start = performance.now();
  let result: any;

  if (backend === "neo4j") {
    // Browser-side Neo4j driver
    result = await neo4jBackend.executeQuery(query, model.get("connection_database"), model);
  } else if (backend === "grafeo" && mode === "server") {
    // Browser-side Grafeo server HTTP
    result = await grafeoBackend.executeQuery(query, language, model.get("connection_database"), model);
  } else if (backend === "grafeo" && mode === "wasm") {
    // Browser-side Grafeo WASM
    result = await grafeoEmbedBackend.executeQuery(query, language, model);
  } else {
    // Python-side backends (grafeo-embedded, ladybug, arango, cosmosdb): the kernel runs queries one at a time
    // and times them itself
    model.set("_execute_query", model.get("_execute_query") + 1);
    model.save_changes();
    return;
  }

  if (!result || latestQuery.get(key) !== ticket) return;
  model.set("query_time", performance.now() - start);
  const note = queryResultNote(result.rows, result);
  // A result without nodes or edges keeps what is drawn; one past max_query_nodes is cut, and the note says so
  if (note) {
    model.set("query_note", note);
  } else {
    const capped = capQueryResult(result, model.get("max_query_nodes"));
    model.set("query_note", capped.note);
    model.set("nodes", capped.graph.nodes);
    model.set("edges", capped.graph.edges);
  }
  model.save_changes();
}
