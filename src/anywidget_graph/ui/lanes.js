// Pure helpers for linked lanes, incremental append, pulse and host theme.
// No DOM and no sigma here: index.js uses them, Node tests cover them (tests/js/lanes.test.mjs).

export const LANE_WIDTH = 1000;
export const LANE_HEIGHT = 1000;
export const LANE_GAP = 400;

/** The lane of a node: its own when it names one of the lanes, else the first lane. */
export function laneOf(node, lanes) {
  const ids = lanes.map((lane) => lane.id);
  return ids.includes(node.lane) ? node.lane : ids[0];
}

/** The band of lane number `index`, left to right with a gap. */
export function laneBand(index, { width = LANE_WIDTH, height = LANE_HEIGHT, gap = LANE_GAP } = {}) {
  const x0 = index * (width + gap);
  return { x0, x1: x0 + width, y0: 0, y1: height };
}

/** The bands of all lanes, left to right with a gap; a lane's `width` is its share of the standard width (default 1). */
export function laneBands(lanes, { width = LANE_WIDTH, height = LANE_HEIGHT, gap = LANE_GAP } = {}) {
  const bands = [];
  let x0 = 0;
  for (const lane of lanes) {
    const share = typeof lane.width === "number" && lane.width > 0 ? lane.width : 1;
    bands.push({ x0, x1: x0 + width * share, y0: 0, y1: height });
    x0 += width * share + gap;
  }
  return bands;
}

/** The part of a band nodes go in: a margin of `share` on every side, so none sits under the title or on the border. */
export function insetBand(band, share = 0.06) {
  const dx = (band.x1 - band.x0) * share, dy = (band.y1 - band.y0) * share;
  return { x0: band.x0 + dx, x1: band.x1 - dx, y0: band.y0 + dy, y1: band.y1 - dy };
}

/** The area the camera frames: every band (nodes or not) and a margin for titles and glyphs. */
export function lanesBBox(bands, margin = 120) {
  return {
    x: [Math.min(...bands.map((band) => band.x0)) - margin, Math.max(...bands.map((band) => band.x1)) + margin],
    y: [Math.min(...bands.map((band) => band.y0)) - margin, Math.max(...bands.map((band) => band.y1)) + margin],
  };
}

/** A column lane: its nodes stacked around the middle of the band, evenly spaced, in the given order. */
export function columnPositions(ids, band) {
  const height = band.y1 - band.y0;
  const spacing = ids.length > 1 ? Math.min(height / ids.length, height * 0.12) : 0;
  const cx = (band.x0 + band.x1) / 2, cy = (band.y0 + band.y1) / 2;
  const placed = {};
  ids.forEach((id, i) => {
    placed[id] = { x: cx, y: cy + (i - (ids.length - 1) / 2) * spacing };
  });
  return placed;
}

/**
 * A mapping of graph points into a width x height viewport that shows the box whole, centred (for an empty canvas).
 * Framed as sigma frames it, so nothing moves when the first node arrives: the smaller side less `padding` on each end
 * (sigma's stagePadding).
 */
export function fitBox(box, width, height, padding = 0) {
  const spanX = box.x[1] - box.x[0] || 1, spanY = box.y[1] - box.y[0] || 1;
  const scale = fitScale(box, width, height, padding);
  const offsetX = (width - spanX * scale) / 2, offsetY = (height - spanY * scale) / 2;
  return (point) => ({ x: offsetX + (point.x - box.x[0]) * scale, y: offsetY + (point.y - box.y[0]) * scale });
}

/** Pixels per graph unit when sigma frames the box whole in a width x height viewport (see fitBox). */
export function fitScale(box, width, height, padding = 0) {
  const spanX = box.x[1] - box.x[0] || 1, spanY = box.y[1] - box.y[0] || 1;
  const side = Math.min(width, height);
  const shrink = side > 0 ? Math.max(0, side - 2 * padding) / side : 0;
  return Math.min(width / spanX, height / spanY) * shrink;
}

/** Label spacing on screen, in pixels: one label line apart in a stack, one label width apart across columns. */
export const LABEL_ROW = 18;
export const LABEL_COLUMN = 120;

/**
 * What an action lane's button shows: the host's `icon` (SVG markup, where currentColor takes the accent, or an image
 * URL), stacked bars for `glyph` colours, else a neutral "open" icon. The widget has no domain icon of its own.
 */
export function laneIcon(lane, accent) {
  const icon = typeof lane.icon === "string" ? lane.icon.trim() : "";
  if (icon.startsWith("<svg")) {
    return { kind: "image", src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon.replaceAll("currentColor", accent))}` };
  }
  if (icon) return { kind: "image", src: icon };
  if (Array.isArray(lane.glyph) && lane.glyph.length) return { kind: "bars", colors: lane.glyph };
  return { kind: "open" };
}

/** Whether a viewport point falls on an action lane's glyph (a square of `half` pixels around its centre). */
export function glyphHit(point, center, half = 24) {
  return Math.abs(point.x - center.x) <= half && Math.abs(point.y - center.y) <= half;
}

/** Positions scaled into a band; a single node sits in the middle. */
export function fitToBand(positions, band) {
  const ids = Object.keys(positions);
  if (!ids.length) return {};
  const xs = ids.map((id) => positions[id].x);
  const ys = ids.map((id) => positions[id].y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1, spanY = Math.max(...ys) - minY || 1;
  const width = band.x1 - band.x0, height = band.y1 - band.y0;
  const placed = {};
  for (const id of ids) {
    placed[id] = ids.length === 1
      ? { x: band.x0 + width / 2, y: band.y0 + height / 2 }
      : { x: band.x0 + ((positions[id].x - minX) / spanX) * width, y: band.y0 + ((positions[id].y - minY) / spanY) * height };
  }
  return placed;
}

/** True when an edge joins two lanes: marked `cross`, or its ends sit in different known lanes. */
export function isCrossEdge(edge, laneById) {
  if (edge.cross) return true;
  const a = laneById.get(edge.source), b = laneById.get(edge.target);
  return a !== undefined && b !== undefined && a !== b;
}

/** The partners in other lanes of the given nodes, through the cross-lane links either way (for a search). */
export function crossNeighbours(ids, cross) {
  const partners = new Set();
  for (const edge of cross) {
    if (ids.has(edge.source)) partners.add(edge.target);
    if (ids.has(edge.target)) partners.add(edge.source);
  }
  return partners;
}

/** The identity of a cross-lane edge. */
export function crossKey(edge) {
  return `${edge.source}|${edge.target}`;
}

/**
 * A stable number in [0, 1) for a text (FNV-1a), for deterministic placement. The final mix (murmur3's fmix32)
 * spreads ids that differ only at the end (y1, y2, ...), which FNV alone maps to nearly the same number.
 */
export function hashUnit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Where an appended node goes. With neighbours in other lanes (an element's source nodes): at their mean height,
 * in the middle of its band, so its links run nearly horizontal. Else next to its lane neighbours. Else at a stable
 * spot of the band derived from its id. When its label would cover an `occupied` node's label (`unit`: one label
 * width across, one label line down, in graph units), it takes the nearest free row or column instead. A band with no
 * room left gives the spot itself, marked `crowded`.
 */
export function placeAppended(nodeId, { cross = [], lane = [], occupied = [], unit }, band) {
  const width = band.x1 - band.x0, height = band.y1 - band.y0;
  let spot;
  if (cross.length) {
    // In the middle of the band at their height: nodes of the same neighbours stack there as rows
    const y = cross.reduce((sum, p) => sum + p.y, 0) / cross.length;
    spot = { x: band.x0 + width / 2, y: clamp(y, band.y0, band.y1) };
  } else if (lane.length) {
    const cx = lane.reduce((sum, p) => sum + p.x, 0) / lane.length;
    const cy = lane.reduce((sum, p) => sum + p.y, 0) / lane.length;
    const angle = 2 * Math.PI * hashUnit(nodeId + "a");
    spot = { x: clamp(cx + Math.cos(angle) * width * 0.04, band.x0, band.x1), y: clamp(cy + Math.sin(angle) * height * 0.04, band.y0, band.y1) };
  } else {
    spot = { x: band.x0 + width * hashUnit(nodeId + "x"), y: band.y0 + height * hashUnit(nodeId + "y") };
  }
  return freeSpot(spot, occupied, band, unit || { x: width * 0.04, y: height * 0.04 });
}

/**
 * The first spot whose label box (unit.x wide, unit.y high) is clear of every occupied one: `spot` itself, else the
 * rows above and below it, then the next columns (a column costs three rows; on a tie the column goes first), inside
 * the band. The occupied spots are bucketed by label box, so each try looks at its nine neighbouring buckets only.
 */
function freeSpot(spot, occupied, band, unit) {
  const cell = (p) => [Math.floor(p.x / unit.x), Math.floor(p.y / unit.y)];
  const buckets = new Map();
  for (const o of occupied) {
    const key = cell(o).join(",");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  }
  const clear = (p) => {
    const [cx, cy] = cell(p);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const o of buckets.get(`${cx + dx},${cy + dy}`) || []) {
          // A hair under one unit still counts as a full row or column (rows are sums of fractional units)
          if (Math.abs(o.x - p.x) < unit.x * 0.999 && Math.abs(o.y - p.y) < unit.y * 0.999) return false;
        }
      }
    }
    return true;
  };
  if (clear(spot)) return spot;
  const rows = Math.ceil((band.y1 - band.y0) / unit.y), columns = Math.ceil((band.x1 - band.x0) / unit.x);
  for (let cost = 1; cost <= rows + 3 * columns; cost++) {
    for (let col = Math.floor(cost / 3); col >= 0; col--) {
      const row = cost - 3 * col;
      for (const j of col ? [col, -col] : [0]) {
        for (const i of row ? [row, -row] : [0]) {
          const p = { x: spot.x + j * unit.x, y: spot.y + i * unit.y };
          if (p.x < band.x0 || p.x > band.x1 || p.y < band.y0 || p.y > band.y1) continue;
          if (clear(p)) return p;
        }
      }
    }
  }
  // No room left: the spot itself, marked so its label is left to sigma's culling
  return { ...spot, crowded: true };
}

/** Control point of a soft curve from a to b (bows to one side by a share of the distance). */
export function curveControl(a, b, bend = 0.18) {
  return { x: (a.x + b.x) / 2 - (b.y - a.y) * bend, y: (a.y + b.y) / 2 + (b.x - a.x) * bend };
}

/** Point at t on the quadratic curve a, c, b. */
export function curvePoint(a, c, b, t) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/** The first part of the curve, up to t, as its own quadratic (control and end; de Casteljau split). */
export function curveUntil(a, c, b, t) {
  return { control: { x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t }, end: curvePoint(a, c, b, t) };
}

/** Start offsets (ms) for the n items of a batch, `stagger` apart, the whole batch under `maxTotal`. */
export function staggerSchedule(n, stagger, maxTotal = 1500) {
  if (n <= 0) return [];
  const step = n > 1 ? Math.min(stagger, maxTotal / (n - 1)) : 0;
  return Array.from({ length: n }, (_, i) => Math.round(i * step));
}

/** Eased progress (ease-out cubic) of an animation that starts at `start` and lasts `duration`, at `now`. */
export function progress(start, now, duration) {
  const t = Math.min(1, Math.max(0, (now - start) / duration));
  return 1 - Math.pow(1 - t, 3);
}

/** Size factor of a pulsing node at time t (ms): a soft breath between 1 and 1 + amplitude. */
export function pulseScale(t, period = 1400, amplitude = 0.35) {
  return 1 + amplitude * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period));
}

const THEME_VARIABLES = {
  background: ["--awg-bg", "--awg-graph-bg", "--awg-input-bg"],
  panel: ["--awg-bg-secondary", "--awg-bg-tertiary"],
  text: ["--awg-text"],
  muted: ["--awg-text-secondary", "--awg-text-muted"],
  border: ["--awg-border", "--awg-input-border"],
  accent: ["--awg-accent", "--awg-accent-hover"],
};

/**
 * The widget's CSS variables for a host theme ({background, panel, text, muted, border, accent}). A key the theme
 * leaves out maps to "", which removes the variable, so the widget's light or dark colour shows again.
 */
export function themeVariables(theme) {
  const variables = {};
  for (const [key, names] of Object.entries(THEME_VARIABLES)) {
    const value = theme?.[key];
    for (const name of names) variables[name] = typeof value === "string" ? value : "";
  }
  return variables;
}

/** The label colour: the host theme's text colour, else the light or dark default. */
export function labelColor(theme, dark) {
  return theme?.text || (dark ? "#e0e0e0" : "#333");
}

/** The next lane_action for a click on a lane's glyph; it counts on from the model's value, which every view shares. */
export function nextLaneAction(lane, current) {
  return { lane, seq: (Number(current?.seq) || 0) + 1 };
}

/** The identity of an edge among the drawn data: its ends and its label. */
export function edgeKey(edge) {
  return `${edge.source}|${edge.target}|${edge.label || ""}`;
}

/**
 * The drawn data with nodes and edges merged in: a node by id (its properties updated), an edge once per ends and
 * label. Without `items`, the host's lists as they are (parallel edges kept). Returns new data; `items` is unchanged.
 */
export function mergeItems(items, nodes = [], edges = []) {
  const merged = { nodes: new Map(items?.nodes), edges: [...(items?.edges || [])] };
  for (const node of nodes) merged.nodes.set(node.id, { ...merged.nodes.get(node.id), ...node });
  if (!items) {
    merged.edges.push(...edges);
    return merged;
  }
  const keys = new Set(merged.edges.map(edgeKey));
  for (const edge of edges) {
    if (keys.has(edgeKey(edge))) continue;
    keys.add(edgeKey(edge));
    merged.edges.push(edge);
  }
  return merged;
}

/** Whether an edge is the one a removal names: the same ends, and the same label when the removal gives one. */
export function edgeMatches(edge, spec) {
  if (edge.source !== spec.source || edge.target !== spec.target) return false;
  return spec.label === undefined || spec.label === null || (edge.label || "") === spec.label;
}

/** The drawn data without the given nodes (and every edge touching them) and edges. Returns new data. */
export function removeItems(items, remove = {}) {
  const ids = new Set(remove.nodes || []);
  const specs = remove.edges || [];
  const gone = (edge) => ids.has(edge.source) || ids.has(edge.target) || specs.some((spec) => edgeMatches(edge, spec));
  return { nodes: new Map([...items.nodes].filter(([id]) => !ids.has(id))), edges: items.edges.filter((edge) => !gone(edge)) };
}

/** The drawn data after a batch: its removals first, then its nodes and edges merged in. */
export function applyBatchItems(items, batch) {
  return mergeItems(removeItems(items, batch.remove), batch.nodes || [], batch.edges || []);
}

/** Whether the host's lists hold exactly the drawn items (the same node ids, the same edges): a copy, not new data. */
export function sameItems(items, nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== items.nodes.size || [...ids].some((id) => !items.nodes.has(id))) return false;
  if (edges.length !== items.edges.length) return false;
  const counts = new Map();
  for (const edge of items.edges) counts.set(edgeKey(edge), (counts.get(edgeKey(edge)) || 0) + 1);
  for (const edge of edges) {
    const left = counts.get(edgeKey(edge));
    if (!left) return false;
    counts.set(edgeKey(edge), left - 1);
  }
  return true;
}

/**
 * The area the drawn nodes cover, as a band to place appended nodes in when there are no lanes (so sigma's camera
 * keeps its scale). A flat or single-node graph gets an area as high as it is wide (or LANE_WIDTH around it).
 */
export function extentBand(points) {
  if (!points.length) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const size = Math.max(x1 - x0, y1 - y0) || LANE_WIDTH;
  if (x1 - x0 < size / 1e6) [x0, x1] = [(x0 + x1 - size) / 2, (x0 + x1 + size) / 2];
  if (y1 - y0 < size / 1e6) [y0, y1] = [(y0 + y1 - size) / 2, (y0 + y1 + size) / 2];
  return { x0, x1, y0, y1 };
}

/**
 * Type counts (Map of type to count in the drawn data) with the host's totals ({"<type>": n}): sorted by count, a
 * type with a total gets it, and a type the host lists that the drawn data lacks shows with count 0. The host
 * supplies totals (it may hold far more than it sends); the widget never makes them up.
 */
export function withTotals(counts, totals) {
  const rows = [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => (totals && name in totals ? { name, count, total: totals[name] } : { name, count }));
  if (totals) {
    for (const [name, total] of Object.entries(totals)) if (!counts.has(name)) rows.push({ name, count: 0, total });
  }
  return rows;
}

/** "shown / total" (with thousands separators), or the count alone without a total. */
export function shownOf(count, total) {
  if (total === undefined || total === null) return String(count);
  return `${Number(count).toLocaleString("en-US")} / ${Number(total).toLocaleString("en-US")}`;
}

/** A node's type as the schema panel groups it: its first label, else its label, else "Unlabeled". */
export function nodeType(node) {
  return node.labels && node.labels.length > 0 ? node.labels[0] : node.label || "Unlabeled";
}

/** An edge's type as the schema panel groups it: its type, else its label, else "unknown". */
export function edgeType(edge) {
  return edge.type || edge.label || "unknown";
}

/**
 * The total behind the shown items: the host's per-type totals, plus the shown items of a type it gives no total
 * for (a type the host shows in full). Undefined when the host gives no totals.
 */
export function totalShown(items, typeOf, group) {
  const totals = Object.entries(group || {}).filter(([, n]) => Number.isFinite(Number(n)));
  if (!totals.length) return undefined;
  const listed = new Set(totals.map(([type]) => type));
  return totals.reduce((sum, [, n]) => sum + Number(n), 0) + items.filter((item) => !listed.has(typeOf(item))).length;
}

/** A #rrggbb colour with an alpha, as rgba(); anything else unchanged. */
export function withAlpha(hex, alpha) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!match) return hex;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
