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

/** A mapping of graph points into a width x height viewport that shows the box whole, centred (for an empty canvas). */
export function fitBox(box, width, height) {
  const spanX = box.x[1] - box.x[0] || 1, spanY = box.y[1] - box.y[0] || 1;
  const scale = Math.min(width / spanX, height / spanY);
  const offsetX = (width - spanX * scale) / 2, offsetY = (height - spanY * scale) / 2;
  return (point) => ({ x: offsetX + (point.x - box.x[0]) * scale, y: offsetY + (point.y - box.y[0]) * scale });
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

/** The identity of a cross-lane edge. */
export function crossKey(edge) {
  return `${edge.source}|${edge.target}`;
}

/** A stable number in [0, 1) for a text (FNV-1a), for deterministic placement. */
export function hashUnit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Where an appended node goes. With neighbours in other lanes (an element's source nodes): at their mean height,
 * in the middle of its band, so its links run nearly horizontal. Else next to its lane neighbours. Else at a stable
 * spot of the band derived from its id.
 */
export function placeAppended(nodeId, { cross = [], lane = [] }, band) {
  const width = band.x1 - band.x0, height = band.y1 - band.y0;
  const jitter = hashUnit(nodeId) - 0.5;
  if (cross.length) {
    const y = cross.reduce((sum, p) => sum + p.y, 0) / cross.length;
    return { x: band.x0 + width * (0.5 + 0.35 * jitter), y: clamp(y + height * 0.02 * jitter, band.y0, band.y1) };
  }
  if (lane.length) {
    const cx = lane.reduce((sum, p) => sum + p.x, 0) / lane.length;
    const cy = lane.reduce((sum, p) => sum + p.y, 0) / lane.length;
    const angle = 2 * Math.PI * hashUnit(nodeId + "a");
    return { x: clamp(cx + Math.cos(angle) * width * 0.04, band.x0, band.x1), y: clamp(cy + Math.sin(angle) * height * 0.04, band.y0, band.y1) };
  }
  return { x: band.x0 + width * hashUnit(nodeId + "x"), y: band.y0 + height * hashUnit(nodeId + "y") };
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

/** The widget's CSS variables for a host theme ({background, panel, text, muted, border, accent}); empty keys left out. */
export function themeVariables(theme) {
  const variables = {};
  for (const [key, names] of Object.entries(THEME_VARIABLES)) {
    const value = theme?.[key];
    if (typeof value === "string" && value) for (const name of names) variables[name] = value;
  }
  return variables;
}

/** A #rrggbb colour with an alpha, as rgba(); anything else unchanged. */
export function withAlpha(hex, alpha) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!match) return hex;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
