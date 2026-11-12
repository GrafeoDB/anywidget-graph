/**
 * Neo4j database connection and query execution (browser-side).
 */
import type { GraphEdge, GraphNode, WidgetModel } from "./types.ts";
import { errorText } from "./types.ts";

// The driver loads when a Neo4j connection is made, so the widget itself needs no CDN
const NEO4J_DRIVER_URL = "https://cdn.jsdelivr.net/npm/neo4j-driver@5.28.3/lib/browser/neo4j-web.esm.min.js";

interface Neo4jRecord { keys: string[]; get(key: string | number): unknown }
interface Neo4jResult { records: Neo4jRecord[] }
interface Neo4jSession { run(query: string): Promise<Neo4jResult>; close(): Promise<void> }
interface Neo4jDriver { close(): Promise<void>; verifyConnectivity(): Promise<void>; session(opts?: { database?: string }): Neo4jSession }
interface Neo4jNode { elementId?: string; identity: { toString(): string }; properties: Record<string, unknown>; labels: string[] }
interface Neo4jRelationship { startNodeElementId?: string; start: { toString(): string }; endNodeElementId?: string; end: { toString(): string }; type: string; properties: Record<string, unknown> }
interface Neo4jPath { segments: { start: unknown; end: unknown; relationship: unknown }[] }
interface Neo4jModule {
  driver(uri: string, auth: unknown): Neo4jDriver;
  auth: { basic(username: string, password: string): unknown };
  isNode(v: unknown): v is Neo4jNode;
  isRelationship(v: unknown): v is Neo4jRelationship;
  isPath(v: unknown): v is Neo4jPath;
  isInt(v: unknown): v is { toNumber(): number };
}
let neo4j: Neo4jModule | null = null;
// Each widget's driver, keyed by its host model: every view of a widget shares it, two widgets connect on their own
const neo4jDrivers = new WeakMap<object, Neo4jDriver>();

function driverOf(model: WidgetModel): Neo4jDriver | null {
  return neo4jDrivers.get(model.host ?? model) ?? null;
}

async function loadDriver(): Promise<Neo4jModule> {
  if (!neo4j) neo4j = (await import(NEO4J_DRIVER_URL)).default as unknown as Neo4jModule;
  return neo4j;
}

/**
 * Connect to a Neo4j database.
 */
export async function connect(uri: string, username: string, password: string, model: WidgetModel): Promise<boolean> {
  const previous = driverOf(model);
  if (previous) {
    neo4jDrivers.delete(model.host ?? model);
    await previous.close();
  }

  model.set("connection_status", "connecting");
  model.save_changes();

  try {
    const neo4j = await loadDriver();
    const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
    neo4jDrivers.set(model.host ?? model, driver);
    await driver.verifyConnectivity();
    model.set("connection_status", "connected");
    model.set("query_error", "");
    model.save_changes();

    await fetchSchema(model);
    return true;
  } catch (error) {
    model.set("connection_status", "error");
    model.set("query_error", "Connection failed: " + errorText(error));
    model.save_changes();
    neo4jDrivers.delete(model.host ?? model);
    return false;
  }
}

/**
 * Disconnect from Neo4j database.
 */
export async function disconnect(model: WidgetModel): Promise<void> {
  const driver = driverOf(model);
  if (driver) {
    neo4jDrivers.delete(model.host ?? model);
    await driver.close();
  }
  model.set("connection_status", "disconnected");
  model.save_changes();
}

/**
 * Check if connected to Neo4j.
 */
export function isConnected(model: WidgetModel): boolean {
  return driverOf(model) !== null;
}

/**
 * Fetch database schema (labels and relationship types).
 */
export async function fetchSchema(model: WidgetModel): Promise<void> {
  const driver = driverOf(model);
  if (!driver) return;

  const database = model.get("connection_database") || "neo4j";
  const session = driver.session({ database });

  try {
    // Fetch node labels and their properties
    const labelsResult = await session.run("CALL db.labels()");
    const nodeTypes: { label: string; properties: string[]; count: null }[] = [];

    for (const record of labelsResult.records) {
      const label = String(record.get(0));
      const propsResult = await session.run(
        `MATCH (n:\`${label}\`) UNWIND keys(n) AS key RETURN DISTINCT key LIMIT 20`
      );
      const properties = propsResult.records.map((r) => String(r.get(0)));
      nodeTypes.push({ label, properties, count: null });
    }

    // Fetch relationship types and their properties
    const relTypesResult = await session.run("CALL db.relationshipTypes()");
    const edgeTypes: { type: string; properties: string[]; count: null }[] = [];

    for (const record of relTypesResult.records) {
      const type = String(record.get(0));
      const propsResult = await session.run(
        `MATCH ()-[r:\`${type}\`]->() UNWIND keys(r) AS key RETURN DISTINCT key LIMIT 20`
      );
      const properties = propsResult.records.map((r) => String(r.get(0)));
      edgeTypes.push({ type, properties, count: null });
    }

    model.set("schema_node_types", nodeTypes);
    model.set("schema_edge_types", edgeTypes);
    model.save_changes();
  } catch (error) {
    console.error("Failed to fetch schema:", error);
  } finally {
    await session.close();
  }
}

/**
 * Execute a Cypher query.
 */
export async function executeQuery(query: string, database: string, model: WidgetModel): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; rows: number } | null> {
  const driver = driverOf(model);
  if (!driver) {
    model.set("query_error", "Not connected to database");
    model.save_changes();
    return null;
  }

  model.set("query_running", true);
  model.set("query_error", "");
  model.save_changes();

  const session = driver.session({ database: database || "neo4j" });

  try {
    const result = await session.run(query);
    model.set("query_running", false);
    model.save_changes();
    return { ...processRecords(result.records), rows: result.records.length };
  } catch (error) {
    model.set("query_running", false);
    model.set("query_error", "Query error: " + errorText(error));
    model.save_changes();
    return null;
  } finally {
    await session.close();
  }
}

/**
 * Process Neo4j records into nodes and edges.
 */
function processRecords(records: Neo4jRecord[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const record of records) {
    for (const key of record.keys) {
      const value = record.get(key);
      processValue(value, nodes, edges);
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}

/**
 * Process a single Neo4j value (node, relationship, path, or array).
 */
function processValue(value: unknown, nodes: Map<string, GraphNode>, edges: GraphEdge[]): void {
  if (!value) return;
  const n4j = neo4j;
  if (!n4j) return;

  if (n4j.isNode(value)) {
    const nodeId = value.elementId || value.identity.toString();
    if (!nodes.has(nodeId)) {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value.properties)) {
        props[k] = n4j.isInt(v) ? v.toNumber() : v;
      }
      nodes.set(nodeId, {
        id: nodeId,
        label: String(props.name || props.title || value.labels[0] || nodeId),
        labels: value.labels,
        ...props,
      });
    }
  } else if (n4j.isRelationship(value)) {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value.properties)) {
      props[k] = n4j.isInt(v) ? v.toNumber() : v;
    }
    edges.push({
      source: value.startNodeElementId || value.start.toString(),
      target: value.endNodeElementId || value.end.toString(),
      label: value.type,
      ...props,
    });
  } else if (n4j.isPath(value)) {
    for (const segment of value.segments) {
      processValue(segment.start, nodes, edges);
      processValue(segment.end, nodes, edges);
      processValue(segment.relationship, nodes, edges);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      processValue(item, nodes, edges);
    }
  }
}
