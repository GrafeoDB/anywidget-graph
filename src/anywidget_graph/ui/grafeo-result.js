/**
 * Conversion of Grafeo query results into widget nodes and edges.
 *
 * Shared by the Grafeo server (HTTP) and WASM backends. Both return the
 * engine's value encoding:
 *   node: {_id, _labels, ...properties}
 *   edge: {_id, _type, _source, _target, ...properties}
 *   path: {nodes: [node], edges: [edge]} (WASM adds _type: "path"); engines
 *         before 0.6 put bare ids there, which are still accepted
 * Lists and maps (collect, variable-length edges, nodes(p), [n, 1], {k: n})
 * are walked recursively. An edge can arrive without its endpoints (and an
 * older path with bare ids), so the caller resolves `missingNodeIds` /
 * `missingEdgeIds` with a follow-up lookup.
 *
 * Property values are made plain for the widget model: an exact decimal
 * ({$decimal: "1.50"}, grafeo 0.6) becomes a number, so styling by a
 * property and the tooltips treat it as one; the server's tagged temporal
 * values ({$date: "..."} and the like) become their text; an integer past
 * 2^53 (a BigInt from WASM) becomes its text, which the model can sync;
 * vectors and bytes (typed arrays) become plain arrays.
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

const TAGGED_TEXT_KEYS = new Set(["$date", "$time", "$datetime", "$duration"]);

/** A property value as the widget model holds it (see the module comment). */
export function grafeoValueToWidget(value) {
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(grafeoValueToWidget);
  if (ArrayBuffer.isView(value)) return Array.from(value);
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$decimal") return Number(value.$decimal);
  if (keys.length === 1 && TAGGED_TEXT_KEYS.has(keys[0])) return String(value[keys[0]]);
  const plain = {};
  for (const key of keys) plain[key] = grafeoValueToWidget(value[key]);
  return plain;
}

function userProperties(entity) {
  const props = {};
  for (const [key, value] of Object.entries(entity)) {
    if (!key.startsWith("_")) props[key] = grafeoValueToWidget(value);
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
 * A note for a result whose rows hold no node, edge or path (the drawing then empties), or "" when there is
 * something to draw or no rows at all (a write).
 */
export function nothingToDrawNote(rows, graph) {
  const count = Array.isArray(rows) ? rows.length : 0;
  if (count === 0 || graph.nodes.length > 0 || graph.edges.length > 0) return "";
  const what = count === 1 ? "1 row" : `${count} rows`;
  return `The query returned ${what} without nodes, edges or paths, so there is nothing to draw. Return graph elements (for example RETURN n, r, m) to see them.`;
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
