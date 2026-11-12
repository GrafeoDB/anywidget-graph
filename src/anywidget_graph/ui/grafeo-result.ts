import type { GraphEdge, GraphNode } from "./types.ts";

/** Engine value: node, edge, path, or a plain property value. */
type GrafeoValue = any;

/** The accumulator collecting entities while rows are walked. */
export interface GrafeoAccumulator {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  pathNodeIds: Set<string>;
  pathEdgeIds: Set<string>;
}
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

export function isGrafeoNode(val: unknown): val is { _id: unknown; _labels: unknown[] } & Record<string, unknown> {
  return val !== null && typeof val === "object" && "_id" in val && Array.isArray((val as Record<string, unknown>)._labels);
}

export function isGrafeoEdge(val: unknown): val is { _id: unknown; _source: unknown; _target: unknown; _type: string } & Record<string, unknown> {
  return (
    val !== null &&
    typeof val === "object" &&
    "_id" in val &&
    "_source" in val &&
    "_target" in val &&
    typeof (val as Record<string, unknown>)._type === "string"
  );
}

export function isGrafeoPath(val: unknown): val is { nodes: unknown[]; edges: unknown[] } & Record<string, unknown> {
  return (
    val !== null &&
    typeof val === "object" &&
    !("_id" in val) &&
    Array.isArray((val as Record<string, unknown>).nodes) &&
    Array.isArray((val as Record<string, unknown>).edges)
  );
}

function isGrafeoId(val: unknown): val is number | bigint {
  return (typeof val === "number" && Number.isInteger(val) && val >= 0) || typeof val === "bigint";
}

const TAGGED_TEXT_KEYS = new Set(["$date", "$time", "$datetime", "$duration"]);

/** A property value as the widget model holds it (see the module comment). */
export function grafeoValueToWidget(value: unknown): unknown {
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(grafeoValueToWidget);
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as Iterable<number>);
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$decimal") return Number((value as Record<string, unknown>).$decimal);
  if (keys.length === 1 && TAGGED_TEXT_KEYS.has(keys[0])) return String((value as Record<string, unknown>)[keys[0]]);
  const plain: Record<string, unknown> = {};
  for (const key of keys) plain[key] = grafeoValueToWidget((value as Record<string, unknown>)[key]);
  return plain;
}

function userProperties(entity: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    if (!key.startsWith("_")) props[key] = grafeoValueToWidget(value);
  }
  return props;
}

/** Widget node: properties first, so a user property named `id` cannot replace the identity. */
export function grafeoNodeToWidget(node: { _id: unknown; _labels: unknown[] } & Record<string, unknown>): GraphNode {
  const props = userProperties(node);
  const labels = (node._labels as unknown[]).map(String);
  return {
    label: String(props.name ?? props.title ?? labels[0] ?? node._id),
    ...props,
    id: String(node._id),
    labels,
  };
}

/** Widget edge: `source` / `target` always come from the engine, never from properties. */
export function grafeoEdgeToWidget(edge: { _id: unknown; _source: unknown; _target: unknown; _type: string } & Record<string, unknown>): GraphEdge {
  return {
    label: edge._type,
    ...userProperties(edge),
    source: String(edge._source),
    target: String(edge._target),
  };
}

export function createGrafeoAccumulator(): GrafeoAccumulator {
  return { nodes: new Map<string, GraphNode>(), edges: new Map<string, GraphEdge>(), pathNodeIds: new Set<string>(), pathEdgeIds: new Set<string>() };
}

/** Walk one result value, collecting entities and the ids that still need a lookup. */
export function addGrafeoValue(acc: GrafeoAccumulator, val: GrafeoValue): void {
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
export function addGrafeoRows(acc: GrafeoAccumulator, rows: unknown): GrafeoAccumulator {
  if (!Array.isArray(rows)) return acc;
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    for (const val of Array.isArray(row) ? row : Object.values(row)) addGrafeoValue(acc, val);
  }
  return acc;
}

/** Node ids referenced by paths or edge endpoints but not returned as nodes. */
export function missingGrafeoNodeIds(acc: GrafeoAccumulator): string[] {
  const missing = new Set<string>();
  for (const id of acc.pathNodeIds) if (!acc.nodes.has(id)) missing.add(id);
  for (const edge of acc.edges.values()) {
    if (!acc.nodes.has(edge.source)) missing.add(edge.source);
    if (!acc.nodes.has(edge.target)) missing.add(edge.target);
  }
  return [...missing];
}

/** Edge ids referenced by paths but not returned as edges. */
export function missingGrafeoEdgeIds(acc: GrafeoAccumulator): string[] {
  return [...acc.pathEdgeIds].filter((id) => !acc.edges.has(id));
}

/** GQL lookups for ids collected from paths and dangling edges (ids are validated integers). */
export function grafeoNodeLookupQuery(ids: string[]): string {
  return `MATCH (n) WHERE id(n) IN [${ids.join(", ")}] RETURN n`;
}

export function grafeoEdgeLookupQuery(ids: string[]): string {
  return `MATCH ()-[r]->() WHERE id(r) IN [${ids.join(", ")}] RETURN r`;
}

/** Final {nodes, edges}; edges whose endpoints could not be resolved are dropped. */
export function finishGrafeoGraph(acc: GrafeoAccumulator): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const edges = [...acc.edges.values()].filter((e) => acc.nodes.has(e.source) && acc.nodes.has(e.target));
  return { nodes: [...acc.nodes.values()], edges };
}

/**
 * Convert a schema description into the schema panel's node and edge types.
 * WASM schema() and the server's GET /db/{name}/schema both return
 * {labels: [{name, count}], edge_types: [{name, count}], property_keys};
 * the nested {lpg: {labels, edgeTypes}} shape of early WASM builds is accepted too.
 */
export function grafeoSchemaToTypes(schema: any): { nodeTypes: { label: string; properties: string[]; count: number | null }[]; edgeTypes: { type: string; properties: string[]; count: number | null }[] } {
  const source = schema && schema.lpg ? schema.lpg : schema || {};
  const toEntry = (item: any, key: "label" | "type") => ({
    [key]: typeof item === "string" ? item : item.name || String(item),
    properties: (item && item.properties) || [],
    count: item && typeof item.count === "number" ? item.count : null,
  });
  return {
    nodeTypes: (source.labels || []).map((l: unknown) => toEntry(l, "label")),
    edgeTypes: (source.edge_types || source.edgeTypes || []).map((e: unknown) => toEntry(e, "type")),
  };
}

/**
 * Convert result rows into {nodes, edges}, resolving missing entities through
 * `runLookup(gqlQuery) -> rows` (sync or async). Lookup failures are not fatal:
 * the entities that were returned directly are still shown.
 */
export async function grafeoRowsToGraph(rows: unknown, runLookup?: (query: string) => unknown | Promise<unknown>): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
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
