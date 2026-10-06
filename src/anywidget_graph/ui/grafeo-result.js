/**
 * Conversion of Grafeo query results into widget nodes and edges.
 *
 * Shared by the Grafeo server (HTTP) and WASM backends. Both return the
 * engine's value encoding:
 *   node: {_id, _labels, ...properties}
 *   edge: {_id, _type, _source, _target, ...properties}
 *   path: {nodes: [id | node], edges: [id | edge]} (WASM adds _type: "path")
 * Lists (collect, variable-length edges, nodes(p)) are walked recursively.
 * Paths carry bare ids, and an edge can arrive without its endpoints, so the
 * caller resolves `missingNodeIds` / `missingEdgeIds` with a follow-up lookup.
 */

export function isGrafeoNode(val) {
  return val !== null && typeof val === "object" && "_id" in val && Array.isArray(val._labels);
}

export function isGrafeoEdge(val) {
  return (
    val !== null &&
    typeof val === "object" &&
    "_id" in val &&
    "_source" in val &&
    "_target" in val &&
    typeof val._type === "string"
  );
}

export function isGrafeoPath(val) {
  return (
    val !== null &&
    typeof val === "object" &&
    !("_id" in val) &&
    Array.isArray(val.nodes) &&
    Array.isArray(val.edges)
  );
}

function isGrafeoId(val) {
  return (typeof val === "number" && Number.isInteger(val) && val >= 0) || typeof val === "bigint";
}

function userProperties(entity) {
  const props = {};
  for (const [key, value] of Object.entries(entity)) {
    if (!key.startsWith("_")) props[key] = value;
  }
  return props;
}

/** Widget node: properties first, so a user property named `id` cannot replace the identity. */
export function grafeoNodeToWidget(node) {
  const props = userProperties(node);
  const labels = [...node._labels];
  return {
    label: props.name ?? props.title ?? labels[0] ?? String(node._id),
    ...props,
    id: String(node._id),
    labels,
  };
}

/** Widget edge: `source` / `target` always come from the engine, never from properties. */
export function grafeoEdgeToWidget(edge) {
  return {
    label: edge._type,
    ...userProperties(edge),
    source: String(edge._source),
    target: String(edge._target),
  };
}

export function createGrafeoAccumulator() {
  return { nodes: new Map(), edges: new Map(), pathNodeIds: new Set(), pathEdgeIds: new Set() };
}

/** Walk one result value, collecting entities and the ids that still need a lookup. */
export function addGrafeoValue(acc, val) {
  if (val === null || typeof val !== "object") return;

  if (Array.isArray(val)) {
    for (const item of val) addGrafeoValue(acc, item);
    return;
  }

  if (isGrafeoNode(val)) {
    const id = String(val._id);
    if (!acc.nodes.has(id)) acc.nodes.set(id, grafeoNodeToWidget(val));
    return;
  }

  if (isGrafeoEdge(val)) {
    const id = String(val._id);
    if (!acc.edges.has(id)) acc.edges.set(id, grafeoEdgeToWidget(val));
    return;
  }

  if (isGrafeoPath(val)) {
    for (const n of val.nodes) {
      if (isGrafeoId(n)) acc.pathNodeIds.add(String(n));
      else addGrafeoValue(acc, n);
    }
    for (const e of val.edges) {
      if (isGrafeoId(e)) acc.pathEdgeIds.add(String(e));
      else addGrafeoValue(acc, e);
    }
    return;
  }

  // Plain map: entities may be nested inside it
  for (const nested of Object.values(val)) addGrafeoValue(acc, nested);
}

/** Add every value of every row. Rows can be arrays (server) or objects (WASM). */
export function addGrafeoRows(acc, rows) {
  if (!Array.isArray(rows)) return acc;
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    for (const val of Array.isArray(row) ? row : Object.values(row)) addGrafeoValue(acc, val);
  }
  return acc;
}

/** Node ids referenced by paths or edge endpoints but not returned as nodes. */
export function missingGrafeoNodeIds(acc) {
  const missing = new Set();
  for (const id of acc.pathNodeIds) if (!acc.nodes.has(id)) missing.add(id);
  for (const edge of acc.edges.values()) {
    if (!acc.nodes.has(edge.source)) missing.add(edge.source);
    if (!acc.nodes.has(edge.target)) missing.add(edge.target);
  }
  return [...missing];
}

/** Edge ids referenced by paths but not returned as edges. */
export function missingGrafeoEdgeIds(acc) {
  return [...acc.pathEdgeIds].filter((id) => !acc.edges.has(id));
}

/** GQL lookups for ids collected from paths and dangling edges (ids are validated integers). */
export function grafeoNodeLookupQuery(ids) {
  return `MATCH (n) WHERE id(n) IN [${ids.join(", ")}] RETURN n`;
}

export function grafeoEdgeLookupQuery(ids) {
  return `MATCH ()-[r]->() WHERE id(r) IN [${ids.join(", ")}] RETURN r`;
}

/** Final {nodes, edges}; edges whose endpoints could not be resolved are dropped. */
export function finishGrafeoGraph(acc) {
  const edges = [...acc.edges.values()].filter((e) => acc.nodes.has(e.source) && acc.nodes.has(e.target));
  return { nodes: [...acc.nodes.values()], edges };
}

/**
 * Convert a schema description into the schema panel's node and edge types.
 * WASM schema() and the server's GET /db/{name}/schema both return
 * {labels: [{name, count}], edge_types: [{name, count}], property_keys};
 * the nested {lpg: {labels, edgeTypes}} shape of early WASM builds is accepted too.
 */
export function grafeoSchemaToTypes(schema) {
  const source = schema && schema.lpg ? schema.lpg : schema || {};
  const toEntry = (item, key) => ({
    [key]: typeof item === "string" ? item : item.name || String(item),
    properties: (item && item.properties) || [],
    count: item && typeof item.count === "number" ? item.count : null,
  });
  return {
    nodeTypes: (source.labels || []).map((l) => toEntry(l, "label")),
    edgeTypes: (source.edge_types || source.edgeTypes || []).map((e) => toEntry(e, "type")),
  };
}

/**
 * Convert result rows into {nodes, edges}, resolving missing entities through
 * `runLookup(gqlQuery) -> rows` (sync or async). Lookup failures are not fatal:
 * the entities that were returned directly are still shown.
 */
export async function grafeoRowsToGraph(rows, runLookup) {
  const acc = addGrafeoRows(createGrafeoAccumulator(), rows);

  if (runLookup) {
    try {
      const edgeIds = missingGrafeoEdgeIds(acc);
      if (edgeIds.length > 0) addGrafeoRows(acc, await runLookup(grafeoEdgeLookupQuery(edgeIds)));
      const nodeIds = missingGrafeoNodeIds(acc);
      if (nodeIds.length > 0) addGrafeoRows(acc, await runLookup(grafeoNodeLookupQuery(nodeIds)));
    } catch (err) {
      console.warn("Grafeo entity lookup failed:", err);
    }
  }

  return finishGrafeoGraph(acc);
}
