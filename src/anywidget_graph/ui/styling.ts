/**
 * Property-based styling shared by the 2D view (index.js) and the 3D view (canvas3d.js): the color scales, the
 * categorical palette, and how a node's or edge's own fields map to the color, size and label it is drawn with.
 */

import { colorFor } from "./lanes.ts";
import type { GraphEdge, GraphNode, WidgetModel } from "./types.ts";

/** The host per-type colors (the `type_colors` trait): a map for nodes and one for edges. */
export interface TypeColors { nodes?: Record<string, string>; edges?: Record<string, string> }

/** The styling options getStylingOpts reads from the model for one render. */
export interface StylingOpts {
  colorField: string | null;
  colorScale: string;
  colorDomain: number[] | null;
  sizeField: string | null;
  sizeDomain: number[] | null;
  sizeRange: number[];
  edgeColorField: string | null;
  edgeColorScale: string;
  edgeColorDomain: number[] | null;
  edgeSizeField: string | null;
  edgeSizeDomain: number[] | null;
  edgeSizeRange: number[];
  degreeMap: Map<string, number>;
  typeColors: TypeColors;
  levelField: string;
}

// === Color Scales (same as anywidget-vector) ===
export const COLOR_SCALES = {
  viridis: [[0.267,0.004,0.329],[0.282,0.141,0.458],[0.253,0.265,0.530],[0.207,0.372,0.553],[0.164,0.471,0.558],[0.128,0.567,0.551],[0.134,0.658,0.517],[0.267,0.749,0.441],[0.478,0.821,0.318],[0.741,0.873,0.150],[0.993,0.906,0.144]],
  plasma: [[0.050,0.030,0.528],[0.295,0.012,0.615],[0.492,0.012,0.658],[0.654,0.072,0.639],[0.798,0.195,0.561],[0.897,0.329,0.445],[0.963,0.480,0.314],[0.993,0.640,0.186],[0.980,0.807,0.086],[0.940,0.975,0.131],[0.940,0.975,0.131]],
  inferno: [[0.001,0.000,0.014],[0.110,0.066,0.290],[0.280,0.086,0.470],[0.447,0.096,0.460],[0.612,0.140,0.381],[0.762,0.233,0.272],[0.882,0.370,0.170],[0.959,0.551,0.069],[0.977,0.754,0.065],[0.936,0.960,0.309],[0.988,1.000,0.644]],
  magma: [[0.001,0.000,0.014],[0.099,0.068,0.265],[0.232,0.094,0.450],[0.383,0.107,0.520],[0.533,0.137,0.512],[0.683,0.199,0.453],[0.822,0.303,0.369],[0.925,0.452,0.293],[0.975,0.637,0.264],[0.985,0.835,0.361],[0.987,0.991,0.750]],
  cividis: [[0.000,0.135,0.305],[0.074,0.192,0.351],[0.145,0.247,0.382],[0.228,0.302,0.390],[0.310,0.358,0.393],[0.394,0.414,0.390],[0.482,0.470,0.379],[0.575,0.530,0.358],[0.672,0.595,0.325],[0.775,0.666,0.274],[0.880,0.742,0.199]],
  turbo: [[0.190,0.072,0.232],[0.231,0.322,0.745],[0.137,0.572,0.938],[0.069,0.773,0.800],[0.200,0.910,0.510],[0.507,0.979,0.254],[0.775,0.953,0.136],[0.953,0.804,0.098],[0.993,0.561,0.090],[0.914,0.286,0.063],[0.647,0.082,0.033]],
};
export const CATEGORICAL_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6",
];

export const DISPLAY_NAME_FIELDS = ["name", "title", "label", "display", "id"];

export function getColorFromScale(value: number, scaleName: string, domain?: number[] | null): string {
  const scale = (COLOR_SCALES as Record<string, number[][]>)[scaleName] || COLOR_SCALES.viridis;
  const [min, max] = domain || [0, 1];
  const t = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0.5;
  const idx = t * (scale.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  if (i >= scale.length - 1) {
    const c = scale[scale.length - 1];
    return `rgb(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)})`;
  }
  const c1 = scale[i], c2 = scale[i + 1];
  const r = Math.round((c1[0] + f * (c2[0] - c1[0])) * 255);
  const g = Math.round((c1[1] + f * (c2[1] - c1[1])) * 255);
  const b = Math.round((c1[2] + f * (c2[2] - c1[2])) * 255);
  return `rgb(${r},${g},${b})`;
}

export function getCategoricalColor(value: unknown): string {
  let hash = 0;
  const str = String(value);
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return CATEGORICAL_COLORS[Math.abs(hash) % CATEGORICAL_COLORS.length];
}

export function pointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function computeNodeColor(node: GraphNode, colorField: string | null, colorScale: string, colorDomain: number[] | null, typeColors: Record<string, string> | undefined): string {
  if (node.color) return node.color;
  if (!colorField || node[colorField] === undefined) {
    // Color by node type: the host's colour for it (type_colors), else the palette (matches the filter panel swatches)
    const nodeType = (node.labels && node.labels.length > 0) ? node.labels[0] : (node.label || "");
    return colorFor(node, nodeType, typeColors, nodeType ? getCategoricalColor(nodeType) : "#6366f1");
  }
  const value = node[colorField];
  if (typeof value === "number") return getColorFromScale(value, colorScale, colorDomain);
  return getCategoricalColor(value);
}

export function computeNodeSize(node: GraphNode, sizeField: string | null, sizeDomain: number[] | null, sizeRange: number[], degree?: number): number {
  if (node.size !== undefined) return node.size;
  if (sizeField && node[sizeField] !== undefined && sizeDomain) {
    const [min, max] = sizeDomain;
    const v = node[sizeField];
    const t = max > min && typeof v === "number" ? (v - min) / (max - min) : 0.5;
    return sizeRange[0] + t * (sizeRange[1] - sizeRange[0]);
  }
  // Auto-size by degree: hub nodes get bigger, leaf nodes smaller
  if (degree !== undefined && degree > 0) {
    return Math.max(4, Math.min(30, 4 + Math.sqrt(degree) * 3));
  }
  return 8;
}

export function autoLabel(node: GraphNode): string {
  for (const field of DISPLAY_NAME_FIELDS) {
    const val = node[field];
    if (val != null && String(val)) return String(val);
  }
  // Try labels array (common from Neo4j)
  if (Array.isArray(node.labels) && node.labels.length > 0) return node.labels[0];
  return String(node.id || "");
}

/**
 * The styling options read from the model for a set of nodes and edges: which fields drive color and size, the
 * domains computed from the data when the host leaves them out, the degree map for auto-sizing, and the host's
 * per-type colors and visibility levels.
 */
export function getStylingOpts(model: WidgetModel, nodes: GraphNode[], edges: GraphEdge[]): StylingOpts {
  const colorField = model.get("color_field");
  const colorScale = model.get("color_scale") || "viridis";
  let colorDomain: number[] | null = model.get("color_domain");
  const sizeField = model.get("size_field");
  const sizeRange: number[] = model.get("size_range") || [5, 30];

  // Auto-compute color domain
  if (colorField && !colorDomain) {
    const vals = nodes.map((n) => n[colorField]).filter((v): v is number => typeof v === "number");
    if (vals.length > 0) colorDomain = [Math.min(...vals), Math.max(...vals)];
  }

  // Compute size domain
  let sizeDomain: number[] | null = null;
  if (sizeField) {
    const vals = nodes.map((n) => n[sizeField]).filter((v): v is number => typeof v === "number");
    if (vals.length > 0) sizeDomain = [Math.min(...vals), Math.max(...vals)];
  }

  // Edge styling
  const edgeColorField = model.get("edge_color_field");
  const edgeColorScale = model.get("edge_color_scale") || "viridis";
  let edgeColorDomain: number[] | null = null;
  if (edgeColorField) {
    const vals = edges.map((e) => e[edgeColorField]).filter((v): v is number => typeof v === "number");
    if (vals.length > 0) edgeColorDomain = [Math.min(...vals), Math.max(...vals)];
  }

  const edgeSizeField = model.get("edge_size_field");
  const edgeSizeRange: number[] = model.get("edge_size_range") || [1, 8];
  let edgeSizeDomain: number[] | null = null;
  if (edgeSizeField) {
    const vals = edges.map((e) => e[edgeSizeField]).filter((v): v is number => typeof v === "number");
    if (vals.length > 0) edgeSizeDomain = [Math.min(...vals), Math.max(...vals)];
  }

  // Compute degree map for auto-sizing when no sizeField is set
  const degreeMap = new Map<string, number>();
  if (!sizeField) {
    edges.forEach((e) => {
      degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
    });
  }

  return {
    colorField, colorScale, colorDomain, sizeField, sizeDomain, sizeRange,
    edgeColorField, edgeColorScale, edgeColorDomain,
    edgeSizeField, edgeSizeDomain, edgeSizeRange,
    degreeMap,
    typeColors: (model.get("type_colors") || {}) as TypeColors,
    levelField: model.get("level_field") || "level",
  };
}

/** An edge's color: its own `color`, else the field/scale, else the per-type color, else the default. */
export function computeEdgeColor(edge: GraphEdge, opts: StylingOpts): string {
  let color = colorFor(edge, edge.type || edge.label || "unknown", opts.typeColors?.edges, "#94a3b8");
  if (opts.edgeColorField && edge[opts.edgeColorField] !== undefined) {
    const val = edge[opts.edgeColorField];
    color = typeof val === "number"
      ? getColorFromScale(val, opts.edgeColorScale, opts.edgeColorDomain)
      : getCategoricalColor(val);
  }
  return color;
}
