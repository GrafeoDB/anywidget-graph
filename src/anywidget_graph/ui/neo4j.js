/**
 * Neo4j database connection and query execution (browser-side).
 */
import neo4j from "https://cdn.jsdelivr.net/npm/neo4j-driver@5.28.0/lib/browser/neo4j-web.esm.min.js";

let driver = null;

/**
 * Connect to a Neo4j database.
 */
export async function connect(uri, username, password, model) {
  if (driver) {
    await driver.close();
    driver = null;
  }

  model.set("connection_status", "connecting");
  model.save_changes();

  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
    await driver.verifyConnectivity();
    model.set("connection_status", "connected");
    model.set("query_error", "");
    model.save_changes();

    await fetchSchema(model);
    return true;
  } catch (error) {
    model.set("connection_status", "error");
    model.set("query_error", "Connection failed: " + error.message);
    model.save_changes();
    driver = null;
    return false;
  }
}

/**
 * Disconnect from Neo4j database.
 */
export async function disconnect(model) {
  if (driver) {
    await driver.close();
    driver = null;
  }
  model.set("connection_status", "disconnected");
  model.save_changes();
}

/**
 * Check if connected to Neo4j.
 */
export function isConnected() {
  return driver !== null;
}

/**
 * Fetch database schema (labels and relationship types).
 */
export async function fetchSchema(model) {
  if (!driver) return;

  const database = model.get("connection_database") || "neo4j";
  const session = driver.session({ database });

  try {
    // Fetch node labels and their properties
    const labelsResult = await session.run("CALL db.labels()");
    const nodeTypes = [];

    for (const record of labelsResult.records) {
      const label = record.get(0);
      const propsResult = await session.run(
        `MATCH (n:\`${label}\`) UNWIND keys(n) AS key RETURN DISTINCT key LIMIT 20`
      );
      const properties = propsResult.records.map((r) => r.get(0));
      nodeTypes.push({ label, properties, count: null });
    }

    // Fetch relationship types and their properties
    const relTypesResult = await session.run("CALL db.relationshipTypes()");
    const edgeTypes = [];

    for (const record of relTypesResult.records) {
      const type = record.get(0);
      const propsResult = await session.run(
        `MATCH ()-[r:\`${type}\`]->() UNWIND keys(r) AS key RETURN DISTINCT key LIMIT 20`
      );
      const properties = propsResult.records.map((r) => r.get(0));
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
export async function executeQuery(query, database, model) {
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
    return processRecords(result.records);
  } catch (error) {
    model.set("query_running", false);
    model.set("query_error", "Query error: " + error.message);
    model.save_changes();
    return null;
  } finally {
    await session.close();
  }
}

/**
 * Process Neo4j records into nodes and edges.
 */
function processRecords(records) {
  const nodes = new Map();
  const edges = [];

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
function processValue(value, nodes, edges) {
  if (!value) return;

  if (neo4j.isNode(value)) {
    const nodeId = value.elementId || value.identity.toString();
    if (!nodes.has(nodeId)) {
      const props = {};
      for (const [k, v] of Object.entries(value.properties)) {
        props[k] = neo4j.isInt(v) ? v.toNumber() : v;
      }
      nodes.set(nodeId, {
        id: nodeId,
        label: props.name || props.title || value.labels[0] || nodeId,
        labels: value.labels,
        ...props,
      });
    }
  } else if (neo4j.isRelationship(value)) {
    const props = {};
    for (const [k, v] of Object.entries(value.properties)) {
      props[k] = neo4j.isInt(v) ? v.toNumber() : v;
    }
    edges.push({
      source: value.startNodeElementId || value.start.toString(),
      target: value.endNodeElementId || value.end.toString(),
      label: value.type,
      ...props,
    });
  } else if (neo4j.isPath(value)) {
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
