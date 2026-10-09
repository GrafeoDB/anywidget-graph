/**
 * Main entry point for the anywidget-graph UI.
 * Orchestrates all UI components and graph rendering.
 */
import { TRAIT_DEFAULTS } from "./defaults.js";
import Graph from "https://esm.sh/graphology@0.25.4";
import Sigma from "https://esm.sh/sigma@3.0.0";
import * as d3Force from "https://esm.sh/d3-force@3.0.0";

import { ICONS } from "./icons.js";
import { createToolbar } from "./toolbar.js";
import { createSchemaPanel } from "./schema.js";
import { createSettingsPanel } from "./settings.js";
import { createPropertiesPanel } from "./properties.js";
import { createResultsDrawer } from "./results.js";
import { laneOf, laneBands, lanesBBox, columnPositions, glyphHit, fitBox, LANE_HEIGHT, fitToBand, isCrossEdge, crossKey, placeAppended, hashUnit, curveControl, curveUntil, staggerSchedule, progress, pulseScale, themeVariables, withAlpha, labelColor, nextLaneAction, mergeItems, sameItems, extentBand, crossNeighbours, fitScale, LABEL_ROW, LABEL_COLUMN, laneIcon, applyBatchItems, edgeMatches, insetBand, seededRandom, clampInto, partnerHeights, laneSpacing, labelClear, laneSizeScale, rowOf, rowBands, bigBatch, colorFor, labelsThatFit, shortenLabel } from "./lanes.js";
import * as neo4jBackend from "./neo4j.js";
import * as grafeoBackend from "./grafeo.js";
import * as grafeoEmbedBackend from "./grafeo-embed.js";

// === Color Scales (same as anywidget-vector) ===
const COLOR_SCALES = {
  viridis: [[0.267,0.004,0.329],[0.282,0.141,0.458],[0.253,0.265,0.530],[0.207,0.372,0.553],[0.164,0.471,0.558],[0.128,0.567,0.551],[0.134,0.658,0.517],[0.267,0.749,0.441],[0.478,0.821,0.318],[0.741,0.873,0.150],[0.993,0.906,0.144]],
  plasma: [[0.050,0.030,0.528],[0.295,0.012,0.615],[0.492,0.012,0.658],[0.654,0.072,0.639],[0.798,0.195,0.561],[0.897,0.329,0.445],[0.963,0.480,0.314],[0.993,0.640,0.186],[0.980,0.807,0.086],[0.940,0.975,0.131],[0.940,0.975,0.131]],
  inferno: [[0.001,0.000,0.014],[0.110,0.066,0.290],[0.280,0.086,0.470],[0.447,0.096,0.460],[0.612,0.140,0.381],[0.762,0.233,0.272],[0.882,0.370,0.170],[0.959,0.551,0.069],[0.977,0.754,0.065],[0.936,0.960,0.309],[0.988,1.000,0.644]],
  magma: [[0.001,0.000,0.014],[0.099,0.068,0.265],[0.232,0.094,0.450],[0.383,0.107,0.520],[0.533,0.137,0.512],[0.683,0.199,0.453],[0.822,0.303,0.369],[0.925,0.452,0.293],[0.975,0.637,0.264],[0.985,0.835,0.361],[0.987,0.991,0.750]],
  cividis: [[0.000,0.135,0.305],[0.074,0.192,0.351],[0.145,0.247,0.382],[0.228,0.302,0.390],[0.310,0.358,0.393],[0.394,0.414,0.390],[0.482,0.470,0.379],[0.575,0.530,0.358],[0.672,0.595,0.325],[0.775,0.666,0.274],[0.880,0.742,0.199]],
  turbo: [[0.190,0.072,0.232],[0.231,0.322,0.745],[0.137,0.572,0.938],[0.069,0.773,0.800],[0.200,0.910,0.510],[0.507,0.979,0.254],[0.775,0.953,0.136],[0.953,0.804,0.098],[0.993,0.561,0.090],[0.914,0.286,0.063],[0.647,0.082,0.033]],
};
const CATEGORICAL_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6",
];

const DISPLAY_NAME_FIELDS = ["name", "title", "label", "display", "id"];

/**
 * Find the two positions where a circle of radius r is tangent to circles a and b.
 */
function tangentPositions(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return [];

  const dA = a.r + r;
  const dB = b.r + r;

  // Solve: |P - A| = dA, |P - B| = dB
  // Using intersection of two circles
  const x = (dA * dA - dB * dB + d * d) / (2 * d);
  const yy = dA * dA - x * x;
  if (yy < 0) return [];
  const y = Math.sqrt(yy);

  // Unit vectors along and perpendicular to A->B
  const ux = dx / d, uy = dy / d;
  const vx = -uy, vy = ux;

  return [
    { x: a.x + ux * x + vx * y, y: a.y + uy * x + vy * y },
    { x: a.x + ux * x - vx * y, y: a.y + uy * x - vy * y },
  ];
}

function getColorFromScale(value, scaleName, domain) {
  const scale = COLOR_SCALES[scaleName] || COLOR_SCALES.viridis;
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

function getCategoricalColor(value) {
  let hash = 0;
  const str = String(value);
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return CATEGORICAL_COLORS[Math.abs(hash) % CATEGORICAL_COLORS.length];
}

function pointInPolygon(x, y, polygon) {
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

function computeNodeColor(node, colorField, colorScale, colorDomain, typeColors) {
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

function computeNodeSize(node, sizeField, sizeDomain, sizeRange, degree) {
  if (node.size !== undefined) return node.size;
  if (sizeField && node[sizeField] !== undefined && sizeDomain) {
    const [min, max] = sizeDomain;
    const t = max > min ? (node[sizeField] - min) / (max - min) : 0.5;
    return sizeRange[0] + t * (sizeRange[1] - sizeRange[0]);
  }
  // Auto-size by degree: hub nodes get bigger, leaf nodes smaller
  if (degree !== undefined && degree > 0) {
    return Math.max(4, Math.min(30, 4 + Math.sqrt(degree) * 3));
  }
  return 8;
}

function autoLabel(node) {
  for (const field of DISPLAY_NAME_FIELDS) {
    const val = node[field];
    if (val != null && String(val)) return String(val);
  }
  // Try labels array (common from Neo4j)
  if (Array.isArray(node.labels) && node.labels.length > 0) return node.labels[0];
  return String(node.id || "");
}

function getStylingOpts(model, nodes, edges) {
  const colorField = model.get("color_field");
  const colorScale = model.get("color_scale") || "viridis";
  let colorDomain = model.get("color_domain");
  const sizeField = model.get("size_field");
  const sizeRange = model.get("size_range") || [5, 30];

  // Auto-compute color domain
  if (colorField && !colorDomain) {
    const vals = nodes.map(n => n[colorField]).filter(v => typeof v === "number");
    if (vals.length > 0) colorDomain = [Math.min(...vals), Math.max(...vals)];
  }

  // Compute size domain
  let sizeDomain = null;
  if (sizeField) {
    const vals = nodes.map(n => n[sizeField]).filter(v => typeof v === "number");
    if (vals.length > 0) sizeDomain = [Math.min(...vals), Math.max(...vals)];
  }

  // Edge styling
  const edgeColorField = model.get("edge_color_field");
  const edgeColorScale = model.get("edge_color_scale") || "viridis";
  let edgeColorDomain = null;
  if (edgeColorField) {
    const vals = edges.map(e => e[edgeColorField]).filter(v => typeof v === "number");
    if (vals.length > 0) edgeColorDomain = [Math.min(...vals), Math.max(...vals)];
  }

  const edgeSizeField = model.get("edge_size_field");
  const edgeSizeRange = model.get("edge_size_range") || [1, 8];
  let edgeSizeDomain = null;
  if (edgeSizeField) {
    const vals = edges.map(e => e[edgeSizeField]).filter(v => typeof v === "number");
    if (vals.length > 0) edgeSizeDomain = [Math.min(...vals), Math.max(...vals)];
  }

  // Compute degree map for auto-sizing when no sizeField is set
  const degreeMap = new Map();
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
    typeColors: model.get("type_colors") || {},
  };
}

function buildNodeAttrs(node, opts) {
  return {
    label: autoLabel(node),
    // Store the primary type for filtering
    nodeType: (node.labels && node.labels.length > 0) ? node.labels[0] : (node.label || "Unlabeled"),
    x: node.x ?? Math.random() * 100,
    y: node.y ?? Math.random() * 100,
    size: computeNodeSize(node, opts.sizeField, opts.sizeDomain, opts.sizeRange, opts.degreeMap.get(node.id)),
    color: computeNodeColor(node, opts.colorField, opts.colorScale, opts.colorDomain, opts.typeColors.nodes),
  };
}

function buildEdgeAttrs(edge, opts) {
  let color = colorFor(edge, edge.type || edge.label || "unknown", opts.typeColors?.edges, "#94a3b8");
  if (opts.edgeColorField && edge[opts.edgeColorField] !== undefined) {
    const val = edge[opts.edgeColorField];
    color = typeof val === "number"
      ? getColorFromScale(val, opts.edgeColorScale, opts.edgeColorDomain)
      : getCategoricalColor(val);
  }

  let size = edge.size || 2;
  if (opts.edgeSizeField && edge[opts.edgeSizeField] !== undefined && opts.edgeSizeDomain) {
    const [min, max] = opts.edgeSizeDomain;
    const t = max > min ? (edge[opts.edgeSizeField] - min) / (max - min) : 0.5;
    size = opts.edgeSizeRange[0] + t * (opts.edgeSizeRange[1] - opts.edgeSizeRange[0]);
  }

  return {
    label: edge.label || "",
    edgeType: edge.type || edge.label || "unknown",
    size,
    color,
  };
}

/**
 * Execute a query based on the current backend and connection mode.
 */
async function executeQuery(model) {
  const backend = model.get("database_backend");
  const query = model.get("query");
  const mode = model.get("grafeo_connection_mode");
  const language = model.get("query_language") || "cypher";

  if (!query.trim()) {
    model.set("query_error", "Please enter a query");
    model.save_changes();
    return;
  }

  const start = performance.now();

  if (backend === "neo4j") {
    // Browser-side Neo4j driver
    const result = await neo4jBackend.executeQuery(
      query,
      model.get("connection_database"),
      model
    );
    if (result) {
      model.set("query_time", performance.now() - start);
      model.set("nodes", result.nodes);
      model.set("edges", result.edges);
      model.save_changes();
    }
  } else if (backend === "grafeo" && mode === "server") {
    // Browser-side Grafeo server HTTP
    const result = await grafeoBackend.executeQuery(
      query,
      language,
      model.get("connection_database"),
      model
    );
    if (result) {
      model.set("query_time", performance.now() - start);
      model.set("nodes", result.nodes);
      model.set("edges", result.edges);
      model.save_changes();
    }
  } else if (backend === "grafeo" && mode === "wasm") {
    // Browser-side Grafeo WASM
    const result = await grafeoEmbedBackend.executeQuery(query, language, model);
    if (result) {
      model.set("query_time", performance.now() - start);
      model.set("nodes", result.nodes);
      model.set("edges", result.edges);
      model.save_changes();
    }
  } else {
    // Python-side backends (grafeo-embedded, ladybug, arango, cosmosdb)
    // Timing is handled on the Python side
    model.set("_execute_query", model.get("_execute_query") + 1);
    model.save_changes();
  }
}

/**
 * The host's model, where a setting the host left out (an app without Python) reads as the widget's default.
 */
function withDefaults(host) {
  return {
    get: (name) => {
      const value = host.get(name);
      if (value !== undefined || !(name in TRAIT_DEFAULTS)) return value;
      const fallback = TRAIT_DEFAULTS[name];
      return fallback !== null && typeof fallback === "object" ? structuredClone(fallback) : fallback;
    },
    set: (...args) => host.set(...args),
    on: (...args) => host.on(...args),
    off: (...args) => host.off(...args),
    save_changes: (...args) => host.save_changes(...args),
    send: (...args) => host.send(...args),
  };
}

/**
 * Main render function for the anywidget.
 */
function render({ model: host, el }) {
  const model = withDefaults(host);
  const wrapper = document.createElement("div");
  wrapper.className = "awg-wrapper";
  // fill: take the host element's size and follow it; otherwise the fixed width and height
  function applySize() {
    const fill = model.get("fill");
    wrapper.style.width = fill ? "100%" : model.get("width") + "px";
    wrapper.style.height = fill ? "100%" : model.get("height") + "px";
    wrapper.style.maxHeight = fill ? "" : model.get("height") + "px";
  }
  applySize();
  model.on("change:fill", applySize);

  // Renderer reference (set after Sigma init, used by theme/filter callbacks)
  let rendererRef = null;

  // Auto-detect host theme (Tailwind dark/dark-theme class, data-theme, or prefers-color-scheme)
  function detectHostDark() {
    const html = document.documentElement;
    if (html.classList.contains("dark") || html.classList.contains("dark-theme")) return true;
    if (html.dataset.theme === "dark") return true;
    if (document.body?.classList.contains("dark") || document.body?.classList.contains("dark-theme")) return true;
    if (document.body?.dataset.theme === "dark") return true;
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return true;
    return false;
  }

  // Host theme: the host's colours win over the widget's light and dark defaults
  function applyHostTheme() {
    // A key the theme leaves out is "" and removes its variable: the widget's light or dark colour shows again
    const variables = themeVariables(model.get("theme"));
    for (const [name, value] of Object.entries(variables)) wrapper.style.setProperty(name, value);
    rendererRef?.setSetting("labelColor", { color: labelColor(model.get("theme"), model.get("dark_mode")) });
    rendererRef?.refresh();
  }
  model.on("change:theme", applyHostTheme);

  function updateTheme() {
    const dark = model.get("dark_mode");
    wrapper.classList.toggle("awg-dark", dark);
    rendererRef?.setSetting("labelColor", { color: labelColor(model.get("theme"), dark) });
    rendererRef?.refresh();
  }

  // Always auto-detect and observe theme changes
  let autoTheme = true;
  model.set("dark_mode", detectHostDark());
  model.save_changes();
  updateTheme();

  const themeObserver = new MutationObserver(() => {
    if (!autoTheme) return;
    const dark = detectHostDark();
    if (model.get("dark_mode") !== dark) {
      model.set("dark_mode", dark);
      model.save_changes();
      updateTheme();
    }
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
  if (document.body) {
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
  }
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (!autoTheme) return;
      const dark = detectHostDark();
      if (model.get("dark_mode") !== dark) {
        model.set("dark_mode", dark);
        model.save_changes();
        updateTheme();
      }
    });
  }

  // Manual toggle from settings panel disables auto-theme
  model.on("change:dark_mode", () => {
    autoTheme = false;
    updateTheme();
  });

  // Create query executor callback
  const onExecuteQuery = () => executeQuery(model);

  // Filter state (shared with node/edge reducers)
  let hiddenNodeTypes = new Set();
  let hiddenEdgeTypes = new Set();
  let typeColorOverrides = new Map(); // custom colors from filter panel

  function onFilterChange(nodeTypes, edgeTypes) {
    hiddenNodeTypes = nodeTypes;
    hiddenEdgeTypes = edgeTypes;
    rendererRef?.refresh();
  }

  function onColorChange(colorMap) {
    typeColorOverrides = colorMap;
    // Update node colors in the graph
    graph.forEachNode((id, attrs) => {
      const override = typeColorOverrides.get(attrs.nodeType);
      if (override) graph.setNodeAttribute(id, "color", override);
    });
    // Update edge colors in the graph
    graph.forEachEdge((id, attrs) => {
      const override = typeColorOverrides.get(attrs.edgeType);
      if (override) graph.setEdgeAttribute(id, "color", override);
    });
    rendererRef?.refresh();
  }

  // Create panels first (all collapsed by default)
  function refreshLayout() {
    applyLayout(model.get("layout") || "spring");
    rendererRef?.refresh();
    rendererRef?.getCamera().animatedReset({ duration: 300 });
  }

  const schema = createSchemaPanel(model, onExecuteQuery, null, onFilterChange, onColorChange, refreshLayout);
  const properties = createPropertiesPanel(model);
  const settings = model.get("show_settings")
    ? createSettingsPanel(model)
    : null;

  // Panel references for mutual exclusion
  const panels = { schema, settings, properties };

  // Search state (shared with nodeReducer/edgeReducer)
  let searchTerm = "";
  let searchDirectMatches = new Set(); // nodes that directly match the term
  let searchVisibleNodes = new Set();  // direct matches + first-degree neighbors
  let searchVisibleEdges = new Set();  // edges connecting direct matches to their neighbors

  function onSearch(term) {
    searchTerm = (term || "").toLowerCase().trim();
    searchDirectMatches.clear();
    searchVisibleNodes.clear();
    searchVisibleEdges.clear();

    if (searchTerm) {
      // Find nodes that directly match the search term
      graph.forEachNode((id, attrs) => {
        const label = (attrs.label || "").toLowerCase();
        const nodeId = String(id).toLowerCase();
        if (label.includes(searchTerm) || nodeId.includes(searchTerm)) {
          searchDirectMatches.add(id);
          searchVisibleNodes.add(id);
        }
      });

      // Add first-degree neighbors and their connecting edges
      searchDirectMatches.forEach((nodeId) => {
        graph.forEachEdge(nodeId, (edgeId, edgeAttrs, source, target) => {
          searchVisibleEdges.add(edgeId);
          searchVisibleNodes.add(source);
          searchVisibleNodes.add(target);
        });
      });

      // With lanes, a match's partners in the other lanes are its neighbours too (their curves show with them)
      for (const id of crossNeighbours(searchDirectMatches, laneState.cross)) searchVisibleNodes.add(id);
    }
    rendererRef?.refresh();
  }

  // Create toolbar if enabled
  if (model.get("show_toolbar")) {
    const toolbar = createToolbar(model, onExecuteQuery, panels, onSearch);
    wrapper.appendChild(toolbar);
  }

  // Main content area (schema + graph + settings/properties)
  const content = document.createElement("div");
  content.className = "awg-content";

  // Schema sidebar (left)
  content.appendChild(schema.element);

  // Graph container (flex: 1 fills available space)
  const container = document.createElement("div");
  container.className = "awg-graph-container";
  content.appendChild(container);

  // Properties panel (right)
  content.appendChild(properties.element);

  // Settings panel (right, overlaps with properties via mutual exclusion)
  if (settings) {
    content.appendChild(settings.element);
  }

  wrapper.appendChild(content);

  // Results drawer (bottom, hidden by default with lip toggle)
  const results = createResultsDrawer(model);
  wrapper.appendChild(results.element);

  el.appendChild(wrapper);

  // Initialize Graphology graph (multi: true allows parallel edges)
  const graph = new Graph({ multi: true });

  // Linked lanes, append, pulse and theme: shared state (empty unless the host sets lanes, batches, pulse or theme)
  // A batch already in the model when this view renders is in its nodes and edges (Graph.append keeps them there)
  const laneState = { lanes: [], bands: [], laneById: new Map(), cross: [], appear: new Map(), edgeAppear: new Map(), crossAppear: new Map(), vanish: new Map(), edgeVanish: new Map(), sizeScale: new Map(), rows: new Map(), move: new Map(), labelled: new Map(), labelText: new Map(), quietLanes: new Set(), hoverNode: null, pulse: new Set(), lastSeq: Number(model.get("append_batch")?.seq) || 0, hoverAction: null };
  model.set("_features", ["lanes", "append", "pulse", "theme", "lane_widths", "column_lanes", "lane_actions", "lane_icons", "action_edges", "remove", "totals", "force_layout", "lane_rows", "relayout", "type_colors", "lane_labels"]);
  model.save_changes();

  // The data drawn: the host's nodes and edges with the appended batches merged in. A redraw (new lanes, a style)
  // keeps appended items; new nodes or edges from the host replace them, unless they are a copy of what is drawn.
  let drawn = mergeItems(undefined, model.get("nodes") || [], model.get("edges") || []);

  // An edge end that is no node but an action lane's id: the edge ends at that lane's button (connect nodes to an action)
  function actionLaneIndex(id) {
    if (graph.hasNode(id)) return -1;
    return laneState.lanes.findIndex((lane) => lane.action && lane.id === id);
  }
  const drawable = (id) => graph.hasNode(id) || actionLaneIndex(id) >= 0;
  const overlayEdge = (edge) => actionLaneIndex(edge.source) >= 0 || actionLaneIndex(edge.target) >= 0 || isCrossEdge(edge, laneState.laneById);

  // Add initial nodes and edges with property-based styling
  function rebuildGraph() {
    graph.clear();
    laneState.vanish.clear();
    laneState.edgeVanish.clear();
    laneState.move.clear();
    laneState.lanes = model.get("lanes") || [];
    laneState.laneById = new Map();
    laneState.cross = [];
    const nodes = [...drawn.nodes.values()];
    const edges = drawn.edges;
    const opts = getStylingOpts(model, nodes, edges);

    nodes.forEach((node) => {
      // Graphology throws on duplicate keys and on edges to unknown nodes,
      // which would leave the widget blank; skip such entries instead.
      if (graph.hasNode(node.id)) return;
      const attrs = buildNodeAttrs(node, opts);
      if (laneState.lanes.length) {
        attrs.lane = laneOf(node, laneState.lanes);
        laneState.laneById.set(node.id, attrs.lane);
      }
      graph.addNode(node.id, attrs);
    });

    addEdges(edges, opts);
  }

  function addEdges(edges, opts) {
    edges.forEach((edge) => {
      if (!drawable(edge.source) || !drawable(edge.target)) return;
      // Cross-lane edges (and edges into an action lane) are drawn on the overlay, not by sigma, and take no part in the layout
      if (laneState.lanes.length && overlayEdge(edge)) {
        laneState.cross.push({ source: edge.source, target: edge.target, key: crossKey(edge) });
        return;
      }
      graph.addEdge(edge.source, edge.target, buildEdgeAttrs(edge, opts));
    });
  }

  // The same items again (maybe with new properties): restyle them where they are, without a layout
  function restyle() {
    const nodes = [...drawn.nodes.values()];
    const opts = getStylingOpts(model, nodes, drawn.edges);
    for (const node of nodes) {
      if (!graph.hasNode(node.id)) continue;
      const { x, y, ...rest } = buildNodeAttrs(node, opts);
      graph.mergeNodeAttributes(node.id, rest);
    }
    graph.clearEdges();
    laneState.cross = [];
    addEdges(drawn.edges, opts);
    // New labels have new widths: choose a lane's labels again
    pickLaneLabels();
  }

  rebuildGraph();

  // Layout application (preserves pinned positions, respects filters)
  function applyLayout(layoutName) {
    // Lanes get their bands and framing also while empty: a live run starts from nothing, action glyphs show at once
    if (laneState.lanes.length) {
      layoutLanes();
      frameLanes();
      return;
    }
    frameLanes();
    if (graph.order === 0) return;
    const pinned = model.get("pinned_nodes") || {};

    // Save pinned positions before layout
    const savedPositions = {};
    Object.keys(pinned).forEach((id) => {
      if (graph.hasNode(id)) {
        savedPositions[id] = { x: graph.getNodeAttribute(id, "x"), y: graph.getNodeAttribute(id, "y") };
      }
    });

    // Build a set of visible nodes (respecting type filters and search)
    const visibleNodes = new Set();
    graph.forEachNode((id, attrs) => {
      if (hiddenNodeTypes.size > 0 && hiddenNodeTypes.has(attrs.nodeType)) return;
      if (searchTerm && !searchVisibleNodes.has(id)) return;
      visibleNodes.add(id);
    });

    switch (layoutName) {
      case "circular":
        circular.assign(graph);
        break;
      case "random":
        random.assign(graph);
        break;
      case "cluster": {
        // Step 1: Group visible nodes by type
        const nodes = [...drawn.nodes.values()];
        const labelGroups = new Map();
        nodes.forEach((node) => {
          if (!visibleNodes.has(node.id)) return;
          const label = (node.labels && node.labels[0]) || node.label || "__other";
          if (!labelGroups.has(label)) labelGroups.set(label, []);
          labelGroups.get(label).push(node.id);
        });

        const clusterLabels = [...labelGroups.entries()].filter(([, g]) => g.length >= 2);
        if (clusterLabels.length < 2) {
          applyLayout("force");
          return;
        }

        const singleNodes = [...labelGroups.entries()]
          .filter(([, g]) => g.length < 2)
          .flatMap(([, g]) => g);
        const allGroups = [...clusterLabels];
        if (singleNodes.length > 0) {
          allGroups.push(["__other", singleNodes]);
        }

        // Step 2: Mini-force per cluster (organic internal layout)
        // Build a subgraph for each cluster, run ForceAtlas2, store relative positions
        const clusterLayouts = new Map(); // clusterLabel -> { nodeId: {x, y} }
        const clusterSizes = new Map();   // clusterLabel -> nodeCount

        allGroups.forEach(([clusterLabel, nodeIds]) => {
          clusterSizes.set(clusterLabel, nodeIds.length);
          const nodeSet = new Set(nodeIds);
          const subGraph = new Graph({ multi: true });

          // Add cluster nodes
          nodeIds.forEach((id) => {
            if (graph.hasNode(id)) {
              subGraph.addNode(id, { x: Math.random() * 10, y: Math.random() * 10, size: 1 });
            }
          });

          // Add intra-cluster edges only
          graph.forEachEdge((edgeId, attrs, source, target) => {
            if (nodeSet.has(source) && nodeSet.has(target) && subGraph.hasNode(source) && subGraph.hasNode(target)) {
              subGraph.addEdge(source, target);
            }
          });

          // Run force on subgraph
          if (subGraph.order > 1) {
            forceAtlas2.assign(subGraph, {
              iterations: Math.min(100, Math.max(30, nodeIds.length * 3)),
              settings: {
                gravity: 1,
                scalingRatio: 10,
                barnesHutOptimize: nodeIds.length > 30,
                adjustSizes: true,
                slowDown: 1,
              },
            });
          }

          // Store positions (centered at origin)
          const positions = {};
          let sumX = 0, sumY = 0, count = 0;
          subGraph.forEachNode((id, attrs) => {
            sumX += attrs.x;
            sumY += attrs.y;
            count++;
          });
          const avgX = count > 0 ? sumX / count : 0;
          const avgY = count > 0 ? sumY / count : 0;
          subGraph.forEachNode((id, attrs) => {
            positions[id] = { x: attrs.x - avgX, y: attrs.y - avgY };
          });
          clusterLayouts.set(clusterLabel, positions);
        });

        // Step 3: Circle packing for cluster positioning
        // Each cluster gets a circle with radius proportional to sqrt(nodeCount)
        // Packed tightly without overlap using a deterministic front-chain algorithm
        const padding = 8; // gap between clusters
        const radiusScale = 6; // multiplier for cluster circle radius

        // Build circles sorted largest first (greedy packing works best this way)
        const circles = allGroups
          .map(([clusterLabel, nodeIds]) => ({
            label: clusterLabel,
            r: Math.sqrt(nodeIds.length) * radiusScale + padding,
          }))
          .sort((a, b) => b.r - a.r);

        // Place circles using a simple spiral packing algorithm
        // First circle at origin, second tangent to first, rest packed against existing
        const placed = []; // { x, y, r, label }

        circles.forEach((circle, i) => {
          if (i === 0) {
            placed.push({ x: 0, y: 0, r: circle.r, label: circle.label });
            return;
          }
          if (i === 1) {
            placed.push({
              x: placed[0].r + circle.r,
              y: 0,
              r: circle.r,
              label: circle.label,
            });
            return;
          }

          // Find the best position tangent to two already-placed circles
          let bestX = 0, bestY = 0, bestDist = Infinity;

          for (let a = 0; a < placed.length; a++) {
            for (let b = a + 1; b < placed.length; b++) {
              // Find positions tangent to circles a and b
              const candidates = tangentPositions(placed[a], placed[b], circle.r);
              for (const pos of candidates) {
                // Check no overlap with any placed circle
                let valid = true;
                for (const p of placed) {
                  const dx = pos.x - p.x;
                  const dy = pos.y - p.y;
                  if (Math.sqrt(dx * dx + dy * dy) < circle.r + p.r - 1) {
                    valid = false;
                    break;
                  }
                }
                if (valid) {
                  const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
                  if (dist < bestDist) {
                    bestDist = dist;
                    bestX = pos.x;
                    bestY = pos.y;
                  }
                }
              }
            }
          }

          placed.push({ x: bestX, y: bestY, r: circle.r, label: circle.label });
        });

        // Step 4: Compose final positions
        // Place each cluster's mini-force layout at the packed circle center
        placed.forEach(({ x: cx, y: cy, r, label }) => {
          const positions = clusterLayouts.get(label);
          if (!positions) return;
          const size = clusterSizes.get(label);
          // Scale internal layout to fit within the cluster circle
          // Find the max extent of the internal layout
          let maxExt = 0;
          Object.values(positions).forEach(({ x, y }) => {
            const ext = Math.sqrt(x * x + y * y);
            if (ext > maxExt) maxExt = ext;
          });
          // Scale so nodes fill ~80% of the circle radius (minus padding)
          const usableR = r - padding;
          const scale = maxExt > 0 ? (usableR * 0.8) / maxExt : 1;

          Object.entries(positions).forEach(([nodeId, pos]) => {
            if (graph.hasNode(nodeId)) {
              graph.setNodeAttribute(nodeId, "x", cx + pos.x * scale);
              graph.setNodeAttribute(nodeId, "y", cy + pos.y * scale);
            }
          });
        });
        break;
      }
      case "force": {
        // Build temp subgraph with visible nodes only
        const tempGraph = new Graph({ multi: true });
        graph.forEachNode((id, attrs) => {
          if (visibleNodes.has(id)) tempGraph.addNode(id, { ...attrs });
        });
        graph.forEachEdge((edgeId, attrs, source, target) => {
          if (visibleNodes.has(source) && visibleNodes.has(target)) {
            tempGraph.addEdge(source, target, { ...attrs });
          }
        });

        const n = tempGraph.order;
        if (n === 0) break;
        const iterations = Math.min(400, Math.max(100, n * 3));
        const gravity = n < 20 ? 0.3 : n < 100 ? 0.1 : 0.05;
        const scalingRatio = n < 20 ? 20 : n < 100 ? 15 : 10;
        forceAtlas2.assign(tempGraph, {
          iterations,
          settings: {
            gravity,
            scalingRatio,
            barnesHutOptimize: n > 50,
            strongGravityMode: false,
            linLogMode: true,
            adjustSizes: true,
            slowDown: 1,
          },
        });

        // Copy positions back
        tempGraph.forEachNode((id, attrs) => {
          if (graph.hasNode(id)) {
            graph.setNodeAttribute(id, "x", attrs.x);
            graph.setNodeAttribute(id, "y", attrs.y);
          }
        });
        break;
      }
      case "spring": {
        // d3-force spring layout: produces clean hub-spoke rings for hierarchical data
        const n = visibleNodes.size || graph.order;

        // Build node and link arrays for d3 (visible nodes only)
        const d3Nodes = [];
        const nodeIndexMap = new Map();
        let idx = 0;
        graph.forEachNode((id, attrs) => {
          if (!visibleNodes.has(id)) return;
          nodeIndexMap.set(id, idx);
          d3Nodes.push({ id, x: attrs.x, y: attrs.y, size: attrs.size || 8 });
          idx++;
        });

        const d3Links = [];
        graph.forEachEdge((edgeId, attrs, source, target) => {
          if (nodeIndexMap.has(source) && nodeIndexMap.has(target)) {
            d3Links.push({ source: nodeIndexMap.get(source), target: nodeIndexMap.get(target) });
          }
        });

        // Configure forces: generous spacing so hub-spoke rings are clear
        const linkDistance = n < 30 ? 80 : n < 100 ? 60 : 45;
        const chargeStrength = n < 30 ? -400 : n < 100 ? -300 : -200;

        const simulation = d3Force.forceSimulation(d3Nodes)
          .force("link", d3Force.forceLink(d3Links).distance(linkDistance).strength(0.4))
          .force("charge", d3Force.forceManyBody().strength(chargeStrength))
          .force("center", d3Force.forceCenter(0, 0))
          .force("collide", d3Force.forceCollide().radius((d) => d.size * 2 + 4).strength(0.8))
          .stop();

        // Run simulation synchronously
        const ticks = Math.min(300, Math.max(100, n * 2));
        for (let i = 0; i < ticks; i++) simulation.tick();

        // Write positions back to graphology
        d3Nodes.forEach((d) => {
          if (graph.hasNode(d.id)) {
            graph.setNodeAttribute(d.id, "x", d.x);
            graph.setNodeAttribute(d.id, "y", d.y);
          }
        });
        break;
      }
    }

    // Restore pinned positions after layout
    Object.entries(savedPositions).forEach(([id, pos]) => {
      if (graph.hasNode(id)) {
        graph.setNodeAttribute(id, "x", pos.x);
        graph.setNodeAttribute(id, "y", pos.y);
      }
    });
  }

  // Bands of all lanes; their height follows the canvas's shape (within limits) so the lanes fill it
  function computeBands() {
    const width = container.offsetWidth, height = container.offsetHeight;
    let bandHeight = LANE_HEIGHT;
    if (width > 0 && height > 0 && laneState.lanes.length) {
      const span = laneBands(laneState.lanes).reduce((right, band) => Math.max(right, band.x1), 0);
      bandHeight = Math.min(LANE_HEIGHT * 2.2, Math.max(LANE_HEIGHT, (span + 240) / (width / height) - 240));
    }
    laneState.bands = laneBands(laneState.lanes, { height: bandHeight });
  }

  // The camera frames every band, also the ones without nodes (an action lane's glyph)
  function frameLanes() {
    if (!rendererRef) return;
    rendererRef.setCustomBBox(laneState.lanes.length && laneState.bands.length ? laneFrame() : null);
  }

  // A column lane's nodes stacked in the middle of its band (in their order in the graph)
  function arrangeColumn(lane, index) {
    const ids = [];
    graph.forEachNode((node, attrs) => {
      if (attrs.lane === lane.id) ids.push(node);
    });
    return columnPositions(ids, insetBand(laneState.bands[index]));
  }

  // Lanes are laid out left to right, each inside its band (so the lanes stay distinct graphs); pinned nodes stay.
  // A column lane stacks its nodes, an action lane holds none. A lane with `layout: "force"` (or with `rows`) gets the
  // force layout, which also pulls a node towards its partners in the lanes laid out before it; any other lane is laid
  // out with forceAtlas2 scaled into its band, as before.
  function layoutLanes() {
    computeBands();
    const placed = new Map();
    laneState.lanes.forEach((lane, index) => {
      for (const [node, position] of layoutLane(lane, index, placed)) graph.mergeNodeAttributes(node, position);
      graph.forEachNode((node, attrs) => {
        if (attrs.lane === lane.id) placed.set(node, { x: attrs.x, y: attrs.y });
      });
    });
    pickLaneLabels();
  }

  // A lane uses the force layout when it asks for it; rows need it (each node is kept inside its row)
  const forceLaid = (lane) => lane?.layout === "force" || Boolean(lane?.rows);

  // The part of a lane a node goes in: its row when the lane has rows, else the lane's band less its margin
  function nodeBand(lane, index, node) {
    const rows = laneState.rows.get(lane.id);
    if (!rows) return insetBand(laneState.bands[index]);
    return (rows[rowOf(node || {}, lane.rows)] || rows.at(-1)).band;
  }

  // New positions for one lane's nodes (pinned ones stay); `placed` holds the nodes of the lanes laid out before it
  function layoutLane(lane, index, placed) {
    const pinned = model.get("pinned_nodes") || {};
    const positions = new Map();
    if (lane.action || !laneState.bands[index]) return positions;
    if (lane.arrange === "column") {
      for (const [node, position] of Object.entries(arrangeColumn(lane, index))) if (!pinned[node]) positions.set(node, position);
      return positions;
    }
    const ids = graph.filterNodes((node, attrs) => attrs.lane === lane.id && !laneState.vanish.has(node));
    const band = insetBand(laneState.bands[index]);
    if (!forceLaid(lane)) {
      laneState.sizeScale.delete(lane.id);
      laneState.rows.delete(lane.id);
      const sub = new Graph({ multi: true });
      for (const id of ids) sub.addNode(id, { x: hashUnit(id + "x"), y: hashUnit(id + "y") });
      graph.forEachEdge((edge, attrs, source, target) => {
        if (sub.hasNode(source) && sub.hasNode(target)) sub.addEdge(source, target);
      });
      if (sub.order === 0) return positions;
      if (sub.order > 1) forceAtlas2.assign(sub, { iterations: 150, settings: { ...forceAtlas2.inferSettings(sub), gravity: 1 } });
      const raw = {};
      sub.forEachNode((node, attrs) => {
        raw[node] = { x: attrs.x, y: attrs.y };
      });
      // Into the band less a margin, so no node sits under the lane's title or on its border
      for (const [node, position] of Object.entries(fitToBand(raw, band))) if (!pinned[node]) positions.set(node, position);
      return positions;
    }
    // Rows: the band split top to bottom by the values of the lane's field, by node count
    if (lane.rows) {
      const counts = new Array(lane.rows.order.length + 1).fill(0);
      for (const id of ids) counts[rowOf(drawn.nodes.get(id) || {}, lane.rows)]++;
      laneState.rows.set(lane.id, rowBands(band, lane.rows.order, counts, 0.12, 0.1, LABEL_ROW / laneScale()));
    } else {
      laneState.rows.delete(lane.id);
    }
    const bandOf = (id) => nodeBand(lane, index, drawn.nodes.get(id));
    // A crowded lane draws its nodes smaller, so the layout has room (see the node reducer)
    const shrink = laneSizeScale(ids.map((id) => graph.getNodeAttribute(id, "size") || 5), band, laneScale());
    laneState.sizeScale.set(lane.id, shrink);
    const start = (id) => {
      const own = bandOf(id);
      return { x: own.x0 + (own.x1 - own.x0) * hashUnit(id + "x"), y: own.y0 + (own.y1 - own.y0) * hashUnit(id + "y") };
    };
    return forceLane(lane.id, ids, band, {
      bandOf,
      shrink,
      start,
      fixed: (id) => (pinned[id] ? graph.getNodeAttributes(id) : null),
      partners: partnerHeights(ids, laneState.cross, placed),
      ticks: 300,
    });
  }

  // The lanes' framing. When the rightmost lane is an action lane (its button and caption at the right edge), it
  // leaves room on the right for the zoom controls over the canvas; other views are framed as before.
  function laneFrame() {
    const box = lanesBBox(laneState.bands);
    if (!laneState.lanes.at(-1)?.action) return box;
    const scale = fitScale(box, container.offsetWidth, container.offsetHeight, rendererRef?.getSetting("stagePadding") ?? 30);
    const controls = (wrapper.querySelector(".awg-zoom-controls")?.offsetWidth || 100) + 20;
    return scale > 0 ? lanesBBox(laneState.bands, 120, controls / scale) : box;
  }

  // Pixels per graph unit at the lanes' framed view (a fallback before the container has a size)
  function laneScale() {
    const scale = fitScale(laneFrame(), container.offsetWidth, container.offsetHeight, rendererRef?.getSetting("stagePadding") ?? 30);
    return scale > 0 ? scale : 0.3;
  }

  // Lanes with `labels: {count}` show the labels of their largest nodes at the default zoom, where each label has room
  const labelMeasure = document.createElement("canvas").getContext("2d");
  // A lane label is at most this wide; a longer name is shortened with an ellipsis (the full name shows on hover)
  const LANE_LABEL_MAX = 110;
  function pickLaneLabels() {
    laneState.labelled = new Map();
    laneState.labelText = new Map();
    laneState.quietLanes = new Set(laneState.lanes.filter((lane) => Number(lane.labels?.count) > 0).map((lane) => lane.id));
    if (!laneState.lanes.some((lane) => Number(lane.labels?.count) > 0)) return;
    const scale = laneScale();
    // Label boxes in graph units: each label's own width in the label font, one line high, 3 px from its node
    const size = rendererRef?.getSetting("labelSize") ?? 12;
    labelMeasure.font = `${rendererRef?.getSetting("labelWeight") ?? "500"} ${size}px ${rendererRef?.getSetting("labelFont") ?? "Arial"}`;
    const fit = { height: (size + 4) / scale, gap: 3 / scale, margin: 2 / scale };
    laneState.lanes.forEach((lane, index) => {
      const count = Number(lane.labels?.count) || 0;
      if (count <= 0 || !laneState.bands[index]) return;
      const shrink = laneState.sizeScale.get(lane.id) ?? 1;
      const nodes = graph.filterNodes((node, attrs) => attrs.lane === lane.id && !laneState.vanish.has(node)).map((node) => {
        const attrs = graph.getNodeAttributes(node);
        const at = laneState.move.get(node)?.to || attrs;
        const text = shortenLabel(attrs.label || "", LANE_LABEL_MAX, (t) => labelMeasure.measureText(t).width);
        if (text !== attrs.label) laneState.labelText.set(node, text);
        const width = labelMeasure.measureText(text).width / scale;
        return { id: node, x: at.x, y: at.y, size: ((attrs.size || 0) * shrink) / scale, degree: graph.degree(node), width };
      });
      // A row's name (drawn in 10 px type at its top left) is taken space
      labelMeasure.font = "500 10px system-ui, -apple-system, sans-serif";
      const band = laneState.bands[index];
      const taken = (laneState.rows.get(lane.id) || []).filter((row) => row.label).map((row) => ({
        x0: band.x0, x1: band.x0 + (labelMeasure.measureText(row.label).width + 6) / scale, y0: row.y1 - 16 / scale, y1: row.y1,
      }));
      labelMeasure.font = `${rendererRef?.getSetting("labelWeight") ?? "500"} ${size}px ${rendererRef?.getSetting("labelFont") ?? "Arial"}`;
      for (const { id, side } of labelsThatFit(nodes, count, { ...fit, band, taken })) laneState.labelled.set(id, side);
    });
  }

  // Force strengths: charge and link length relative to the lane's natural spacing, the collision gap in pixels.
  // Tuned on a 233-node intermediate graph with a tight core and 66 linked elements (Deriva's linked view).
  const LANE_FORCES = { charge: 0.008, reach: 6, collideGap: 3, link: 0.8, linkStrength: 0.6, center: 0.04, partner: 0.12 };

  // A d3-force simulation of one lane's nodes: repulsion scaled to the lane's natural spacing (so the nodes spread over
  // it), collision by node size, springs for the edges inside the lane, a pull to the middle that follows the shape of
  // the node's band (its row, or the lane), and a pull to its partner height. Every step clamps each node into its
  // band. Seeded, so the same lane gives the same picture. `fixed(id)` gives a position for a node that must not move
  // (pinned, or the older nodes while appended ones settle). Returns the free nodes' positions.
  function forceLane(laneId, ids, band, { start, fixed, partners, ticks, alpha = 1, shrink = 1, bandOf = () => band }) {
    const f = LANE_FORCES;
    if (!ids.length) return new Map();
    const pxToUnits = 1 / laneScale();
    const spacing = laneSpacing(ids.length, band);
    const width = band.x1 - band.x0;
    const nodes = ids.map((id) => {
      const pin = fixed(id);
      const at = pin || start(id);
      const own = bandOf(id);
      const node = { id, x: at.x, y: at.y, band: own, radius: ((graph.getNodeAttribute(id, "size") || 5) * shrink + f.collideGap) * pxToUnits };
      // The pull to the middle follows the band's shape (stronger across a narrow side), so the graph takes that shape
      node.tall = Math.min(4, Math.max(0.25, (own.y1 - own.y0) / width));
      // The partner height, mapped into the node's row the way it sits in the lane (a node in a row keeps its partners'
      // order without piling up on the row's edge)
      if (partners.has(id)) {
        const mapped = own.y0 + ((partners.get(id) - band.y0) / (band.y1 - band.y0 || 1)) * (own.y1 - own.y0);
        node.partner = Math.min(own.y1, Math.max(own.y0, mapped));
      }
      if (pin) Object.assign(node, { fx: pin.x, fy: pin.y });
      return node;
    });
    const members = new Set(ids), degree = new Map();
    const links = [];
    graph.forEachEdge((edge, attrs, source, target) => {
      if (source === target || !members.has(source) || !members.has(target)) return;
      links.push({ source, target });
      degree.set(source, (degree.get(source) || 0) + 1);
      degree.set(target, (degree.get(target) || 0) + 1);
    });
    const midX = (band.x0 + band.x1) / 2;
    const laneTall = Math.min(4, Math.max(0.25, (band.y1 - band.y0) / width));
    const simulation = d3Force.forceSimulation(nodes)
      .randomSource(seededRandom(laneId))
      .alpha(alpha)
      .stop()
      .force("charge", d3Force.forceManyBody().strength(-f.charge * spacing * spacing).distanceMax(spacing * f.reach))
      .force("collide", d3Force.forceCollide().radius((d) => d.radius).strength(0.9).iterations(2))
      .force("link", d3Force.forceLink(links).id((d) => d.id).distance(spacing * f.link)
        .strength((link) => f.linkStrength / Math.min(degree.get(link.source.id) || 1, degree.get(link.target.id) || 1)))
      .force("x", d3Force.forceX(midX).strength(f.center * laneTall))
      .force("y", d3Force.forceY((d) => d.partner ?? (d.band.y0 + d.band.y1) / 2).strength((d) => (d.partner !== undefined ? f.partner : f.center / d.tall)));
    for (let i = 0; i < ticks; i++) {
      simulation.tick();
      for (const node of nodes) if (node.fx === undefined) clampInto(node, node.band);
    }
    return new Map(nodes.filter((node) => node.fx === undefined).map((node) => [node.id, { x: node.x, y: node.y }]));
  }

  // Apply initial layout
  applyLayout(model.get("layout") || "spring");

  // Initialize Sigma renderer with LOD settings
  const nodeCount = graph.order;
  const renderer = new Sigma(graph, container, {
    renderLabels: model.get("show_labels"),
    renderEdgeLabels: model.get("show_edge_labels"),
    defaultNodeColor: "#6366f1",
    defaultEdgeColor: "#94a3b8",
    labelColor: { color: labelColor(model.get("theme"), model.get("dark_mode")) },
    labelSize: 12,
    labelWeight: "500",
    // LOD: only show labels for nodes above this rendered-size threshold
    labelRenderedSizeThreshold: nodeCount > 200 ? 8 : nodeCount > 50 ? 5 : 2,
    // Limit label density to reduce clutter on large graphs
    labelDensity: nodeCount > 200 ? 0.5 : nodeCount > 50 ? 1 : 2,
    // Smoother edges
    defaultEdgeType: "line",
    // Enable edge interaction events (click, hover)
    enableEdgeEvents: true,
    // A host may mount the widget in a hidden or not yet sized container (a closed panel, a tab)
    allowInvalidContainer: true,
  });
  rendererRef = renderer;
  // A lane's chosen labels (labels: {count}) sit on a soft backing in the canvas colour, so they read cleanly over the
  // smaller nodes they may cover, on the left of their node when they would cross the lane's right edge; any other
  // label is drawn as sigma draws it
  const drawSigmaLabel = renderer.getSetting("defaultDrawNodeLabel");
  renderer.setSetting("defaultDrawNodeLabel", (context, data, settings) => {
    if (!data.labelBacking || !data.label) return drawSigmaLabel(context, data, settings);
    context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
    const width = context.measureText(data.label).width;
    const x = data.labelSide === "left" ? data.x - data.size - 3 - width : data.x + data.size + 3;
    context.fillStyle = withAlpha(getComputedStyle(wrapper).getPropertyValue("--awg-graph-bg").trim() || "#ffffff", 0.82);
    context.beginPath();
    context.roundRect(x - 3, data.y - settings.labelSize / 2 - 3, width + 6, settings.labelSize + 6, 4);
    context.fill();
    context.fillStyle = settings.labelColor.attribute ? data[settings.labelColor.attribute] || settings.labelColor.color || "#000" : settings.labelColor.color;
    context.fillText(data.label, x, data.y + settings.labelSize / 3);
  });
  frameLanes();
  applyHostTheme();

  // Overlay for lane titles and cross-lane curves (2D canvas above sigma, redrawn after every sigma frame)
  const overlay = document.createElement("canvas");
  overlay.className = "awg-lanes-overlay";
  container.appendChild(overlay);

  function sizeOverlay() {
    const dpr = window.devicePixelRatio || 1;
    const width = container.offsetWidth, height = container.offsetHeight;
    overlay.width = Math.max(1, Math.round(width * dpr));
    overlay.height = Math.max(1, Math.round(height * dpr));
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
  }

  function drawOverlay() {
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, overlay.width / dpr, overlay.height / dpr);
    if (!laneState.lanes.length) return;
    // The widget's own colours: its light or dark defaults, or the host theme (applyHostTheme sets these variables)
    const css = getComputedStyle(wrapper);
    const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const accent = color("--awg-accent", "#0880ea"), muted = color("--awg-text-muted", "#9ca3af");
    const panel = color("--awg-bg-secondary", "#f8f9fa"), border = color("--awg-border", "#e2e8f0");
    const now = performance.now();

    // Lane titles above each band; a column or action lane's title is centred over it
    ctx.font = "600 12px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = muted;
    laneState.lanes.forEach((lane, index) => {
      const band = laneState.bands[index];
      if (!band) return;
      const narrow = lane.action || lane.arrange === "column";
      const corners = [laneToViewport({ x: band.x0, y: band.y0 }), laneToViewport({ x: band.x0, y: band.y1 })];
      const top = Math.min(corners[0].y, corners[1].y);
      const x = narrow ? laneToViewport({ x: (band.x0 + band.x1) / 2, y: band.y0 }).x : corners[0].x;
      ctx.textAlign = narrow ? "center" : "left";
      ctx.fillText(lane.title || lane.id, x, top - 14);
    });
    ctx.textAlign = "left";

    // Rows (a lane's `rows`): the value's name at each row's top left, a faint dashed line between rows
    ctx.font = "500 10px system-ui, -apple-system, sans-serif";
    laneState.lanes.forEach((lane, index) => {
      const rows = laneState.rows.get(lane.id), band = laneState.bands[index];
      if (!rows || !band) return;
      const left = laneToViewport({ x: band.x0, y: band.y0 }).x, right = laneToViewport({ x: band.x1, y: band.y0 }).x;
      rows.forEach((row, i) => {
        const top = Math.min(laneToViewport({ x: band.x0, y: row.y0 }).y, laneToViewport({ x: band.x0, y: row.y1 }).y);
        if (i > 0) {
          ctx.save();
          ctx.strokeStyle = border;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(left, top);
          ctx.lineTo(right, top);
          ctx.stroke();
          ctx.restore();
        }
        if (row.label) {
          ctx.fillStyle = muted;
          ctx.fillText(row.label, left + 2, top + 12);
        }
      });
    });
    ctx.font = "600 12px system-ui, -apple-system, sans-serif";

    // Cross-lane curves (under the buttons, so a curve into an action lane ends at its button's edge); an appearing
    // one is drawn up to its progress
    const focus = new Set([model.get("selected_node")?.id, model.get("hovered_node")?.id, laneState.hoverAction].filter(Boolean));
    const endPoint = (id) => {
      // A node hidden by a filter or a search (or not yet appeared) hides its curves too
      if (graph.hasNode(id)) return renderer.getNodeDisplayData(id)?.hidden ? null : renderer.graphToViewport(graph.getNodeAttributes(id));
      const index = actionLaneIndex(id);
      return index >= 0 && laneState.bands[index] ? actionCenter(index) : null;
    };
    for (const edge of laneState.cross) {
      const a = endPoint(edge.source), b = endPoint(edge.target);
      if (!a || !b) continue;
      const start = laneState.crossAppear.get(edge.key);
      const t = start === undefined ? 1 : progress(start, now, 450);
      if (t <= 0) continue;
      const lit = focus.has(edge.source) || focus.has(edge.target);
      ctx.strokeStyle = withAlpha(accent, lit ? 0.9 : 0.32);
      ctx.lineWidth = lit ? 1.8 : 1.1;
      const part = curveUntil(a, curveControl(a, b), b, t);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(part.control.x, part.control.y, part.end.x, part.end.y);
      ctx.stroke();
    }

    // Action lanes: a button in the middle of the band with the host's icon, glyph bars, or a neutral "open" icon
    laneState.lanes.forEach((lane, index) => {
      if (!lane.action || !laneState.bands[index]) return;
      const center = actionCenter(index);
      const hover = laneState.hoverAction === lane.id;
      ctx.fillStyle = panel;
      ctx.strokeStyle = hover ? accent : border;
      ctx.lineWidth = hover ? 1.6 : 1;
      ctx.beginPath();
      ctx.roundRect(center.x - 24, center.y - 24, 48, 48, 9);
      ctx.fill();
      ctx.stroke();
      drawLaneIcon(ctx, laneIcon(lane, accent), center, accent);
      if (lane.caption) {
        ctx.font = "500 11px system-ui, -apple-system, sans-serif";
        ctx.fillStyle = hover ? accent : muted;
        ctx.textAlign = "center";
        ctx.fillText(lane.caption, center.x, center.y + 40);
        ctx.textAlign = "left";
        ctx.font = "600 12px system-ui, -apple-system, sans-serif";
      }
    });
  }

  // An action lane's icon inside its 48 px button: an image (loaded once, then redrawn), stacked bars, or "open"
  const iconImages = new Map();
  const OPEN_ICON = [new Path2D("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"), new Path2D("M15 3h6v6"), new Path2D("M10 14 21 3")];
  function drawLaneIcon(ctx, icon, center, accent) {
    if (icon.kind === "image") {
      let image = iconImages.get(icon.src);
      if (!image) {
        image = new Image();
        image.onload = image.onerror = () => renderer.refresh();
        image.src = icon.src;
        iconImages.set(icon.src, image);
      }
      if (!image.complete) return;  // drawn once it has loaded
      try {
        // An SVG without a width or height has no natural size, but draws fine
        ctx.drawImage(image, center.x - 16, center.y - 16, 32, 32);
        return;
      } catch {
        icon = { kind: "open" };  // it did not load: the neutral icon instead
      }
    }
    if (icon.kind === "bars") {
      const barHeight = 7, gap = 4, total = icon.colors.length * barHeight + (icon.colors.length - 1) * gap;
      icon.colors.forEach((color, i) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(center.x - 14, center.y - total / 2 + i * (barHeight + gap), 28, barHeight, 2.5);
        ctx.fill();
      });
      return;
    }
    // The neutral "open" icon (a box with an arrow out of it), on a 24-unit grid scaled to 24 px
    ctx.save();
    ctx.translate(center.x - 12, center.y - 12);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const path of OPEN_ICON) ctx.stroke(path);
    ctx.restore();
  }

  // A lane point in viewport pixels; sigma leaves its transform stale on an empty graph, so the overlay fits the lanes itself then
  function laneToViewport(point) {
    if (graph.order > 0 || !laneState.bands.length) return renderer.graphToViewport(point);
    return fitBox(laneFrame(), container.offsetWidth, container.offsetHeight, renderer.getSetting("stagePadding"))(point);
  }

  // The middle of an action lane's band, in viewport pixels
  function actionCenter(index) {
    const band = laneState.bands[index];
    return laneToViewport({ x: (band.x0 + band.x1) / 2, y: (band.y0 + band.y1) / 2 });
  }

  // The action lane under a viewport point, if any
  function actionAt(point) {
    const index = laneState.lanes.findIndex((lane, i) => lane.action && laneState.bands[i] && glyphHit(point, actionCenter(i)));
    return index >= 0 ? laneState.lanes[index] : null;
  }

  // Hovering a glyph shows it can be clicked
  container.addEventListener("mousemove", (event) => {
    if (!laneState.lanes.some((lane) => lane.action)) return;
    const rect = container.getBoundingClientRect();
    const lane = actionAt({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    const id = lane ? lane.id : null;
    if (id === laneState.hoverAction) return;
    laneState.hoverAction = id;
    container.style.cursor = id ? "pointer" : "";
    renderer.refresh();
  });

  renderer.on("afterRender", drawOverlay);
  sizeOverlay();

  // One requestAnimationFrame loop while something appears or pulses; sigma's refresh redraws the overlay too
  let animating = false;
  function animate() {
    const now = performance.now();
    // Nodes of a lane laid out again glide to their new places
    for (const [node, move] of laneState.move) {
      if (!graph.hasNode(node)) {
        laneState.move.delete(node);
        continue;
      }
      const t = progress(move.start, now, 700);
      graph.mergeNodeAttributes(node, { x: move.from.x + (move.to.x - move.from.x) * t, y: move.from.y + (move.to.y - move.from.y) * t });
      if (t >= 1) laneState.move.delete(node);
    }
    // Removed items leave the graph once they have faded out
    for (const [key, start] of laneState.edgeVanish) {
      if (now - start < 450) continue;
      if (graph.hasEdge(key)) graph.dropEdge(key);
      laneState.edgeVanish.delete(key);
    }
    for (const [id, start] of laneState.vanish) {
      if (now - start < 450) continue;
      if (graph.hasNode(id)) graph.dropNode(id);
      laneState.laneById.delete(id);
      laneState.vanish.delete(id);
    }
    const appearing = laneState.vanish.size > 0 || laneState.edgeVanish.size > 0 || laneState.move.size > 0
      || [...laneState.appear.values(), ...laneState.edgeAppear.values(), ...laneState.crossAppear.values()].some((start) => now - start < 450);
    renderer.refresh();
    if (appearing || laneState.pulse.size) {
      requestAnimationFrame(animate);
      return;
    }
    animating = false;
    laneState.appear.clear();
    laneState.edgeAppear.clear();
    laneState.crossAppear.clear();
  }
  function startAnimating() {
    if (animating) return;
    animating = true;
    requestAnimationFrame(animate);
  }

  // Node reducer for type filtering, search filtering, selection, and pinned indicator
  renderer.setSetting("nodeReducer", (node, data) => {
    const selectedNodes = model.get("selected_nodes") || [];
    const pinnedNodes = model.get("pinned_nodes") || {};
    const res = { ...data };

    // Hide nodes whose type is filtered out
    if (hiddenNodeTypes.size > 0 && hiddenNodeTypes.has(data.nodeType)) {
      res.hidden = true;
      return res;
    }

    // Hide non-visible nodes when search is active
    if (searchTerm && !searchVisibleNodes.has(node)) {
      res.hidden = true;
      return res;
    }

    // Dim first-degree neighbors (not direct matches) during search
    if (searchTerm && searchVisibleNodes.has(node) && !searchDirectMatches.has(node)) {
      res.color = data.color + "80";
    }

    // Dim unselected nodes when there is an active selection
    if (selectedNodes.length > 0 && !selectedNodes.includes(node)) {
      res.color = (res.color || data.color) + "40";
      res.label = "";
    }

    // Show ring on pinned nodes
    if (pinnedNodes[node]) {
      res.borderColor = "#f59e0b";
      res.borderSize = 2;
    }

    // A crowded lane's nodes are drawn smaller (relative sizes kept)
    const shrink = data.lane === undefined ? undefined : laneState.sizeScale.get(data.lane);
    if (shrink !== undefined && shrink < 1) res.size = (res.size || data.size) * shrink;

    // Appearing (append) and pulsing (pulse_nodes) nodes
    const appearAt = laneState.appear.get(node);
    if (appearAt !== undefined) {
      const t = progress(appearAt, performance.now(), 450);
      if (t <= 0) res.hidden = true;
      res.size = (res.size || data.size) * t;
    }
    const vanishAt = laneState.vanish.get(node);
    if (vanishAt !== undefined) {
      const t = progress(vanishAt, performance.now(), 450);
      if (t >= 1) res.hidden = true;
      res.size = (res.size || data.size) * (1 - t);
    }
    if (laneState.pulse.has(node)) {
      res.size = (res.size || data.size) * pulseScale(performance.now());
      res.forceLabel = true;
    }
    // An appended node placed with room for its label shows it, also where sigma's label grid would drop it
    // (rows one label line apart share a grid cell); zoomed out the rows close up, and the grid decides again
    if (data.labelRoom && renderer.getCamera().ratio <= 1) res.forceLabel = true;
    // A lane's largest nodes (its `labels: {count}`) show their labels, where they have room; at the default zoom the
    // lane shows only those (and the hovered or selected node), so sigma's own label grid does not draw over them
    const zoom = renderer.getCamera().ratio;
    if (laneState.labelled.has(node) && zoom <= 1) {
      res.forceLabel = true;
      res.labelSide = laneState.labelled.get(node);
      res.labelBacking = true;
      if (laneState.labelText.has(node) && node !== laneState.hoverNode) res.label = laneState.labelText.get(node);
    }
    else if (laneState.quietLanes.has(data.lane) && zoom >= 1 - 1e-6 && node !== laneState.hoverNode && !selectedNodes.includes(node)) res.label = "";

    return res;
  });

  // Sigma runs the reducers on a refresh, not on a zoom: crossing the default view's scale refreshes, so labelRoom labels
  // give way to the label grid when zoomed out and come back when zoomed in again
  let zoomBand = 0;  // -1 zoomed in, 0 the default view, 1 zoomed out
  renderer.getCamera().on("updated", (state) => {
    const band = state.ratio > 1 + 1e-6 ? 1 : state.ratio < 1 - 1e-6 ? -1 : 0;
    if (band === zoomBand) return;
    zoomBand = band;
    renderer.refresh();
  });

  // Edge reducer for type filtering and search filtering
  renderer.setSetting("edgeReducer", (edge, data) => {
    const res = { ...data };

    // Hide edges whose type is filtered out
    if (hiddenEdgeTypes.size > 0 && hiddenEdgeTypes.has(data.edgeType)) {
      res.hidden = true;
      return res;
    }

    // Hide edges connected to hidden node types
    if (hiddenNodeTypes.size > 0) {
      const [source, target] = graph.extremities(edge);
      const sourceType = graph.getNodeAttribute(source, "nodeType");
      const targetType = graph.getNodeAttribute(target, "nodeType");
      if (hiddenNodeTypes.has(sourceType) || hiddenNodeTypes.has(targetType)) {
        res.hidden = true;
        return res;
      }
    }

    // Hide edges not in search results
    if (searchTerm && !searchVisibleEdges.has(edge)) {
      res.hidden = true;
    }

    const appearAt = laneState.edgeAppear.get(edge);
    if (appearAt !== undefined) {
      const t = progress(appearAt, performance.now(), 450);
      if (t <= 0) res.hidden = true;
      res.size = (res.size || data.size) * t;
    }
    if (laneState.edgeVanish.size || laneState.vanish.size) {
      const [source, target] = graph.extremities(edge);
      const starts = [laneState.edgeVanish.get(edge), laneState.vanish.get(source), laneState.vanish.get(target)].filter((start) => start !== undefined);
      if (starts.length) {
        const t = progress(Math.min(...starts), performance.now(), 450);
        if (t >= 1) res.hidden = true;
        res.size = (res.size || data.size) * (1 - t);
      }
    }

    return res;
  });

  // Incremental append: merge new nodes and edges without moving what is drawn; new items appear one after another
  function applyBatch(batch) {
    laneState.lastSeq = batch.seq;
    const nodes = batch.nodes || [], edges = batch.edges || [];
    drawn = applyBatchItems(drawn, batch);
    const opts = getStylingOpts(model, nodes, edges);
    const animated = model.get("append_animation") !== "none";
    // Per lane: its nodes before this batch, and how many the batch removes (for a lane's `relayout`)
    const before = new Map(), dropped = new Map();
    graph.forEachNode((node, attrs) => {
      if (attrs.lane !== undefined && !laneState.vanish.has(node)) before.set(attrs.lane, (before.get(attrs.lane) || 0) + 1);
    });
    for (const id of (batch.remove || {}).nodes || []) {
      if (!graph.hasNode(id) || laneState.vanish.has(id)) continue;
      const lane = graph.getNodeAttribute(id, "lane");
      if (lane !== undefined) dropped.set(lane, (dropped.get(lane) || 0) + 1);
    }
    const removed = removeDrawn(batch.remove || {}, animated);
    const schedule = staggerSchedule(nodes.length + edges.length, model.get("append_stagger_ms") ?? 60);
    const t0 = performance.now();
    const lanes = laneState.lanes;
    // Without lanes, new nodes go inside the area already drawn, so sigma's camera keeps its scale and nothing moves
    const extent = lanes.length ? null : extentBand(graph.mapNodes((node, attrs) => ({ x: attrs.x, y: attrs.y })));
    // Spots taken per lane (one group without lanes), so appended nodes do not land on one another
    const occupied = new Map();
    const taken = (lane) => occupied.get(lane ?? "") || occupied.set(lane ?? "", []).get(lane ?? "");
    graph.forEachNode((node, attrs) => {
      if (!removed.has(node)) taken(attrs.lane).push({ x: attrs.x, y: attrs.y });
    });
    // A label's room in graph units, at the framed view (the lanes, or the drawn area without lanes)
    const frame = lanes.length ? laneFrame() : extent && { x: [extent.x0, extent.x1], y: [extent.y0, extent.y1] };
    const scale = frame ? fitScale(frame, container.offsetWidth, container.offsetHeight, renderer.getSetting("stagePadding")) : 0;
    const unit = scale > 0 ? { x: LABEL_COLUMN / scale, y: LABEL_ROW / scale } : undefined;
    let item = 0;
    const added = new Map();  // lane id -> ids of the nodes this batch adds to it

    nodes.forEach((node) => {
      const at = t0 + schedule[item++];
      if (graph.hasNode(node.id)) {
        laneState.vanish.delete(node.id);  // removed and sent again (a re-sample): it stays
        const { x, y, ...rest } = buildNodeAttrs(node, opts);
        graph.mergeNodeAttributes(node.id, rest);  // properties update, position stays
        return;
      }
      const lane = lanes.length ? laneOf(node, lanes) : undefined;
      const laneIndex = lanes.length ? lanes.findIndex((l) => l.id === lane) : 0;
      const band = !lanes.length ? extent || laneBands([{ id: "" }])[0]
        : laneState.bands[laneIndex] ? nodeBand(lanes[laneIndex], laneIndex, node) : insetBand(laneBands(lanes)[laneIndex]);
      const cross = [], laneNeighbours = [];
      for (const edge of edges) {
        const other = edge.source === node.id ? edge.target : edge.target === node.id ? edge.source : null;
        if (!other || !graph.hasNode(other)) continue;
        const position = graph.getNodeAttributes(other);
        (lane && laneState.laneById.get(other) !== lane ? cross : laneNeighbours).push({ x: position.x, y: position.y });
      }
      const spot = placeAppended(node.id, { cross, lane: laneNeighbours, occupied: taken(lane), unit }, band);
      taken(lane).push(spot);
      // labelRoom: placed with its label clear of every other one, so the label shows (see the node reducer)
      graph.addNode(node.id, { ...buildNodeAttrs(node, opts), x: spot.x, y: spot.y, lane, labelRoom: Boolean(unit) && !spot.crowded });
      if (lane) laneState.laneById.set(node.id, lane);
      if (lane && !lanes[laneIndex]?.arrange) (added.get(lane) || added.set(lane, []).get(lane)).push(node.id);
      if (lanes[laneIndex]?.arrange === "column") {
        for (const [id, position] of Object.entries(arrangeColumn(lanes[laneIndex], laneIndex))) graph.mergeNodeAttributes(id, position);
      }
      if (animated) laneState.appear.set(node.id, at);
    });

    edges.forEach((edge) => {
      const at = t0 + schedule[item++];
      if (!drawable(edge.source) || !drawable(edge.target)) return;
      if (lanes.length && overlayEdge(edge)) {
        const key = crossKey(edge);
        if (laneState.cross.some((c) => c.key === key)) return;
        laneState.cross.push({ source: edge.source, target: edge.target, key });
        if (animated) laneState.crossAppear.set(key, at);
        return;
      }
      const label = edge.label || "";
      const existing = graph.edges(edge.source, edge.target).find((key) => (graph.getEdgeAttribute(key, "label") || "") === label);
      if (existing !== undefined) {
        laneState.edgeVanish.delete(existing);  // removed and sent again: it stays
        return;
      }
      const key = graph.addEdge(edge.source, edge.target, buildEdgeAttrs(edge, opts));
      if (animated) laneState.edgeAppear.set(key, at);
    });

    // A lane with `relayout` (a share) lays out again when this batch removes or adds more than that share of its nodes
    // (its older nodes glide to their new places); a lane with the force layout lets its new nodes settle
    const settle = new Map();
    for (const laneId of new Set([...added.keys(), ...dropped.keys()])) {
      const index = lanes.findIndex((lane) => lane.id === laneId);
      const lane = lanes[index];
      if (!lane || lane.action || lane.arrange === "column") continue;
      const fresh = added.get(laneId) || [];
      if (lane.relayout > 0 && bigBatch(before.get(laneId) || 0, dropped.get(laneId) || 0, fresh.length, lane.relayout)) {
        relayoutLane(lane, index, new Set(fresh), animated);
      } else if (forceLaid(lane) && fresh.length) {
        settle.set(laneId, fresh);
      }
    }
    settleAppended(settle, unit);
    pickLaneLabels();

    if (animated) startAnimating();
    else renderer.refresh();
  }

  // Appended nodes settle with the lane's forces from where they were placed: they spread over the lane while the
  // older nodes stay fixed (they push, but do not move). A label is shown where its spot has room (labelRoom).
  function settleAppended(added, unit) {
    if (!added.size) return;
    const positions = new Map(graph.mapNodes((node, attrs) => [node, { x: attrs.x, y: attrs.y }]));
    for (const [laneId, fresh] of added) {
      const index = laneState.lanes.findIndex((lane) => lane.id === laneId);
      if (index < 0 || !laneState.bands[index]) continue;
      const freshIds = new Set(fresh);
      const ids = graph.filterNodes((node, attrs) => attrs.lane === laneId && !laneState.vanish.has(node));
      const settled = forceLane(laneId, ids, insetBand(laneState.bands[index]), {
        bandOf: (id) => nodeBand(laneState.lanes[index], index, drawn.nodes.get(id)),
        start: (id) => positions.get(id),
        fixed: (id) => (freshIds.has(id) ? null : positions.get(id)),
        partners: partnerHeights(fresh, laneState.cross, positions),
        shrink: laneState.sizeScale.get(laneId) ?? 1,
        ticks: 120,
        alpha: 0.5,
      });
      for (const [id, spot] of settled) positions.set(id, spot);
      for (const [id, spot] of settled) {
        const others = ids.filter((other) => other !== id).map((other) => positions.get(other));
        graph.mergeNodeAttributes(id, { ...spot, labelRoom: Boolean(unit) && labelClear(spot, others, unit) });
      }
    }
  }

  // One lane laid out again after a big batch: its new nodes go straight to their places, the older ones glide there
  // (at once without animation). The other lanes stay as they are. Labels are left to sigma's label grid again.
  function relayoutLane(lane, index, fresh, animated) {
    const placed = new Map(graph.filterNodes((node, attrs) => attrs.lane !== lane.id).map((node) => [node, graph.getNodeAttributes(node)]));
    const start = performance.now();
    for (const [node, to] of layoutLane(lane, index, placed)) {
      if (!animated || fresh.has(node)) {
        graph.mergeNodeAttributes(node, { ...to, labelRoom: false });
        laneState.move.delete(node);
      } else {
        graph.setNodeAttribute(node, "labelRoom", false);
        laneState.move.set(node, { from: { x: graph.getNodeAttribute(node, "x"), y: graph.getNodeAttribute(node, "y") }, to, start });
      }
    }
  }

  // A batch's removals: the nodes (with their edges and cross-lane curves) and edges fade out, then leave the graph
  // (at once without animation). Nothing is laid out again. Returns the ids of the removed nodes.
  function removeDrawn(remove, animated) {
    const ids = new Set((remove.nodes || []).filter((id) => graph.hasNode(id)));
    const specs = remove.edges || [];
    const edgeKeys = [];
    for (const spec of specs) {
      if (!graph.hasNode(spec.source) || !graph.hasNode(spec.target)) continue;
      for (const key of graph.edges(spec.source, spec.target)) {
        if (edgeMatches({ ...spec, label: graph.getEdgeAttribute(key, "label") }, spec)) edgeKeys.push(key);
      }
    }
    laneState.cross = laneState.cross.filter((c) => !ids.has(c.source) && !ids.has(c.target) && !specs.some((spec) => spec.source === c.source && spec.target === c.target));
    if (!ids.size && !edgeKeys.length) return ids;
    // Without lanes sigma frames the drawn extent: keep that framing, so the rest does not move when these leave
    if (!laneState.lanes.length) renderer.setCustomBBox(renderer.getBBox());
    const start = performance.now();
    for (const key of edgeKeys) {
      if (animated) laneState.edgeVanish.set(key, start);
      else graph.dropEdge(key);
    }
    for (const id of ids) {
      laneState.appear.delete(id);
      if (animated) {
        laneState.vanish.set(id, start);
      } else {
        graph.dropNode(id);
        laneState.laneById.delete(id);
      }
    }
    // A removed node leaves the selection (else everything else stays dimmed)
    const selected = model.get("selected_nodes") || [];
    if (selected.some((id) => ids.has(id))) model.set("selected_nodes", selected.filter((id) => !ids.has(id)));
    if (ids.has(model.get("selected_node")?.id)) model.set("selected_node", null);
    model.save_changes();
    return ids;
  }

  // Pulsing nodes: a soft breath on the ids in pulse_nodes, until the list is empty
  function applyPulse() {
    laneState.pulse = new Set((model.get("pulse_nodes") || []).filter((id) => graph.hasNode(id)));
    if (laneState.pulse.size) startAnimating();
    else renderer.refresh();
  }
  applyPulse();

  model.on("change:selected_nodes", () => { renderer.refresh(); });
  model.on("change:pinned_nodes", () => { renderer.refresh(); });

  // === Node Dragging ===
  let draggedNode = null;
  let isDragging = false;
  let justDragged = false;

  renderer.on("downNode", ({ node }) => {
    const selMode = model.get("selection_mode");
    if (selMode === "box" || selMode === "lasso") return;
    draggedNode = node;
    isDragging = false;
    renderer.getCamera().disable();
    container.style.cursor = "grabbing";
  });

  renderer.getMouseCaptor().on("mousemovebody", (e) => {
    if (!draggedNode) return;
    isDragging = true;
    const pos = renderer.viewportToGraph(e);
    graph.setNodeAttribute(draggedNode, "x", pos.x);
    graph.setNodeAttribute(draggedNode, "y", pos.y);
  });

  renderer.getMouseCaptor().on("mouseup", () => {
    if (!draggedNode) return;
    if (isDragging) {
      justDragged = true;
      // Pin the node after drag
      const pinned = { ...(model.get("pinned_nodes") || {}) };
      pinned[draggedNode] = true;
      model.set("pinned_nodes", pinned);
      model.save_changes();
    }
    draggedNode = null;
    isDragging = false;
    renderer.getCamera().enable();
    container.style.cursor = "default";
  });

  // Zoom controls (bottom-right floating buttons)
  const zoomControls = document.createElement("div");
  zoomControls.className = "awg-zoom-controls";

  const zoomInBtn = document.createElement("button");
  zoomInBtn.className = "awg-zoom-btn";
  zoomInBtn.innerHTML = ICONS.zoomIn;
  zoomInBtn.title = "Zoom in";
  zoomInBtn.addEventListener("click", () => {
    renderer.getCamera().animatedZoom({ duration: 200 });
  });

  const zoomOutBtn = document.createElement("button");
  zoomOutBtn.className = "awg-zoom-btn";
  zoomOutBtn.innerHTML = ICONS.zoomOut;
  zoomOutBtn.title = "Zoom out";
  zoomOutBtn.addEventListener("click", () => {
    renderer.getCamera().animatedUnzoom({ duration: 200 });
  });

  const zoomFitBtn = document.createElement("button");
  zoomFitBtn.className = "awg-zoom-btn";
  zoomFitBtn.innerHTML = ICONS.zoomFit;
  zoomFitBtn.title = "Fit to view";
  zoomFitBtn.addEventListener("click", () => {
    renderer.getCamera().animatedReset({ duration: 200 });
  });

  // Layout selector
  const layoutSelect = document.createElement("select");
  layoutSelect.className = "awg-layout-select";
  layoutSelect.title = "Layout algorithm";
  [["spring", "Default"], ["force", "Force"], ["cluster", "Cluster"], ["circular", "Circular"], ["random", "Random"]].forEach(([val, text]) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = text;
    if (val === (model.get("layout") || "spring")) opt.selected = true;
    layoutSelect.appendChild(opt);
  });
  layoutSelect.addEventListener("change", () => {
    model.set("layout", layoutSelect.value);
    model.save_changes();
  });
  model.on("change:layout", () => { layoutSelect.value = model.get("layout"); });

  // Mode switcher
  const modeGroup = document.createElement("div");
  modeGroup.className = "awg-mode-group";

  const clickModeBtn = document.createElement("button");
  clickModeBtn.className = "awg-zoom-btn awg-mode-btn awg-mode-active";
  clickModeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>`;
  clickModeBtn.title = "Click select";

  const boxModeBtn = document.createElement("button");
  boxModeBtn.className = "awg-zoom-btn awg-mode-btn";
  boxModeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="4 2"/></svg>`;
  boxModeBtn.title = "Box select";

  const lassoModeBtn = document.createElement("button");
  lassoModeBtn.className = "awg-zoom-btn awg-mode-btn";
  lassoModeBtn.innerHTML = ICONS.lasso;
  lassoModeBtn.title = "Lasso select";

  function updateModeButtons() {
    const mode = model.get("selection_mode");
    clickModeBtn.classList.toggle("awg-mode-active", mode === "click");
    boxModeBtn.classList.toggle("awg-mode-active", mode === "box");
    lassoModeBtn.classList.toggle("awg-mode-active", mode === "lasso");
  }
  updateModeButtons();

  clickModeBtn.addEventListener("click", () => {
    model.set("selection_mode", "click");
    model.save_changes();
  });
  boxModeBtn.addEventListener("click", () => {
    model.set("selection_mode", "box");
    model.save_changes();
  });
  lassoModeBtn.addEventListener("click", () => {
    model.set("selection_mode", "lasso");
    model.save_changes();
  });
  model.on("change:selection_mode", updateModeButtons);

  modeGroup.appendChild(clickModeBtn);
  modeGroup.appendChild(boxModeBtn);
  modeGroup.appendChild(lassoModeBtn);

  zoomControls.appendChild(zoomFitBtn);
  zoomControls.appendChild(zoomInBtn);
  zoomControls.appendChild(zoomOutBtn);
  zoomControls.appendChild(layoutSelect);
  zoomControls.appendChild(modeGroup);
  container.appendChild(zoomControls);

  // Selection overlay (for box select)
  const selectionOverlay = document.createElement("div");
  selectionOverlay.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;z-index:15;";
  selectionOverlay.style.pointerEvents = "none";
  container.appendChild(selectionOverlay);

  const selectionRect = document.createElement("div");
  selectionRect.className = "awg-selection-rect";
  container.appendChild(selectionRect);

  // Lasso SVG overlay for drawing the freeform path
  const lassoSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  lassoSvg.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;z-index:16;display:none;pointer-events:none;";
  container.appendChild(lassoSvg);

  const lassoPathEl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  lassoPathEl.setAttribute("fill", "rgba(99, 102, 241, 0.1)");
  lassoPathEl.setAttribute("stroke", "#6366f1");
  lassoPathEl.setAttribute("stroke-width", "2");
  lassoPathEl.setAttribute("stroke-dasharray", "4 2");
  lassoSvg.appendChild(lassoPathEl);

  function updateSelectionMode() {
    const mode = model.get("selection_mode");
    const active = mode === "box" || mode === "lasso";
    selectionOverlay.style.pointerEvents = active ? "auto" : "none";
    selectionOverlay.style.cursor = active ? "crosshair" : "default";
    lassoSvg.style.display = "none";
  }
  updateSelectionMode();
  model.on("change:selection_mode", updateSelectionMode);

  let boxStart = null;
  let isLassoing = false;
  let lassoCoords = [];

  selectionOverlay.addEventListener("mousedown", (e) => {
    const mode = model.get("selection_mode");
    const rect = container.getBoundingClientRect();

    if (mode === "box") {
      boxStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      selectionRect.style.display = "block";
      selectionRect.style.left = boxStart.x + "px";
      selectionRect.style.top = boxStart.y + "px";
      selectionRect.style.width = "0px";
      selectionRect.style.height = "0px";
    } else if (mode === "lasso") {
      e.preventDefault();
      isLassoing = true;
      lassoCoords = [[e.clientX - rect.left, e.clientY - rect.top]];
      lassoSvg.style.display = "block";
      lassoPathEl.setAttribute("points", "");
    }
  });

  selectionOverlay.addEventListener("mousemove", (e) => {
    const rect = container.getBoundingClientRect();

    if (boxStart) {
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const x = Math.min(boxStart.x, cx);
      const y = Math.min(boxStart.y, cy);
      const w = Math.abs(cx - boxStart.x);
      const h = Math.abs(cy - boxStart.y);
      selectionRect.style.left = x + "px";
      selectionRect.style.top = y + "px";
      selectionRect.style.width = w + "px";
      selectionRect.style.height = h + "px";
    } else if (isLassoing) {
      lassoCoords.push([e.clientX - rect.left, e.clientY - rect.top]);
      lassoPathEl.setAttribute("points", lassoCoords.map(([x, y]) => `${x},${y}`).join(" "));
    }
  });

  selectionOverlay.addEventListener("mouseup", (e) => {
    const rect = container.getBoundingClientRect();

    if (boxStart) {
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const x1 = Math.min(boxStart.x, cx);
      const y1 = Math.min(boxStart.y, cy);
      const x2 = Math.max(boxStart.x, cx);
      const y2 = Math.max(boxStart.y, cy);
      boxStart = null;
      selectionRect.style.display = "none";

      // Find nodes inside the box
      const selected = [];
      graph.forEachNode((id, attrs) => {
        const pos = renderer.graphToViewport({ x: attrs.x, y: attrs.y });
        if (pos.x >= x1 && pos.x <= x2 && pos.y >= y1 && pos.y <= y2) {
          selected.push(id);
        }
      });
      model.set("selected_nodes", selected);
      model.save_changes();
    } else if (isLassoing) {
      isLassoing = false;
      lassoSvg.style.display = "none";

      if (lassoCoords.length < 3) { lassoCoords = []; return; }

      // Close the polygon
      lassoCoords.push(lassoCoords[0]);

      // Find nodes inside the lasso
      const selected = [];
      graph.forEachNode((id, attrs) => {
        const pos = renderer.graphToViewport({ x: attrs.x, y: attrs.y });
        if (pointInPolygon(pos.x, pos.y, lassoCoords)) {
          selected.push(id);
        }
      });
      model.set("selected_nodes", selected);
      model.save_changes();
      lassoCoords = [];
    }
  });

  // Tooltip element
  const tooltip = document.createElement("div");
  tooltip.className = "awg-tooltip";
  container.appendChild(tooltip);

  function showTooltip(event, data) {
    if (!model.get("show_tooltip")) return;
    const fields = model.get("tooltip_fields") || ["label", "id"];
    let html = "";
    fields.forEach((f) => {
      if (data[f] !== undefined) {
        let val = data[f];
        if (typeof val === "number") val = val.toFixed(3);
        if (Array.isArray(val)) val = val.join(", ");
        html += `<div class="awg-tooltip-row"><span class="awg-tooltip-key">${f}:</span><span class="awg-tooltip-value">${val}</span></div>`;
      }
    });
    if (!html) return;
    tooltip.innerHTML = html;
    tooltip.style.display = "block";
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left + 15;
    const y = event.clientY - rect.top + 15;
    tooltip.style.left = Math.min(x, rect.width - 180) + "px";
    tooltip.style.top = Math.min(y, rect.height - 60) + "px";
  }

  function hideTooltip() {
    tooltip.style.display = "none";
  }

  // Node hover handler
  renderer.on("enterNode", ({ node, event }) => {
    // A quiet lane (labels: {count}) shows the hovered node's label: its cached display data needs a refresh
    laneState.hoverNode = node;
    if (laneState.quietLanes.has(graph.getNodeAttribute(node, "lane"))) renderer.refresh();
    const nodeData = graph.getNodeAttributes(node);
    const data = { id: node, ...nodeData };
    model.set("hovered_node", data);
    model.save_changes();
    showTooltip(event.original, data);
    container.style.cursor = "pointer";
  });

  renderer.on("leaveNode", ({ node }) => {
    laneState.hoverNode = null;
    if (graph.hasNode(node) && laneState.quietLanes.has(graph.getNodeAttribute(node, "lane"))) renderer.refresh();
    model.set("hovered_node", null);
    model.save_changes();
    hideTooltip();
    container.style.cursor = "default";
  });

  // Edge hover handler
  renderer.on("enterEdge", ({ edge, event }) => {
    const edgeData = graph.getEdgeAttributes(edge);
    const [source, target] = graph.extremities(edge);
    const data = { source, target, ...edgeData };
    model.set("hovered_edge", data);
    model.save_changes();
    showTooltip(event.original, data);
  });

  renderer.on("leaveEdge", () => {
    model.set("hovered_edge", null);
    model.save_changes();
    hideTooltip();
  });

  // ResizeObserver for responsive sizing
  const resizeObserver = new ResizeObserver(() => {
    // Hidden or collapsed: nothing to draw until the container has a size again
    if (!container.offsetWidth || !container.offsetHeight) return;
    renderer.resize();
    sizeOverlay();
    // Lanes whose height no longer fits the canvas's shape are laid out again
    if (laneState.lanes.length && laneState.bands.length) {
      const saved = laneState.bands;
      computeBands();
      if (Math.abs(laneState.bands[0].y1 - saved[0].y1) > saved[0].y1 * 0.1) {
        layoutLanes();
        frameLanes();
      } else {
        laneState.bands = saved;
      }
    }
    renderer.refresh();
  });
  resizeObserver.observe(container);

  // Node click handler (with multi-select support)
  renderer.on("clickNode", ({ node, event }) => {
    // Skip click if this was a drag
    if (justDragged) { justDragged = false; return; }
    const nodeData = graph.getNodeAttributes(node);
    model.set("selected_node", { id: node, ...nodeData });

    const mode = model.get("selection_mode") || "click";
    const current = model.get("selected_nodes") || [];
    if (mode === "multi" || (event && event.original && event.original.shiftKey)) {
      if (current.includes(node)) {
        model.set("selected_nodes", current.filter((id) => id !== node));
      } else {
        model.set("selected_nodes", [...current, node]);
      }
    } else {
      model.set("selected_nodes", [node]);
    }
    model.save_changes();
  });

  // Edge click handler
  renderer.on("clickEdge", ({ edge }) => {
    const edgeData = graph.getEdgeAttributes(edge);
    const [source, target] = graph.extremities(edge);
    model.set("selected_edge", { source, target, ...edgeData });
    model.save_changes();
  });

  // Stage click (deselect)
  renderer.on("clickStage", (payload) => {
    const lane = payload?.event ? actionAt({ x: payload.event.x, y: payload.event.y }) : null;
    if (lane) {
      model.set("lane_action", nextLaneAction(lane.id, model.get("lane_action")));
      model.save_changes();
      return;
    }
    model.set("selected_node", null);
    model.set("selected_edge", null);
    model.set("selected_nodes", []);
    model.set("selected_edges", []);
    model.save_changes();
  });

  // Keyboard shortcuts
  wrapper.tabIndex = 0;
  wrapper.style.outline = "none";
  wrapper.addEventListener("keydown", (e) => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      renderer.getCamera().animatedReset({ duration: 200 });
    } else if (e.key === "Escape") {
      model.set("selected_node", null);
      model.set("selected_edge", null);
      model.set("selected_nodes", []);
      model.set("selected_edges", []);
      model.save_changes();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const selected = model.get("selected_nodes") || [];
      if (selected.length === 0) return;
      e.preventDefault();
      const removeSet = new Set(selected);
      // From the drawn data, so appended items the host's lists may not hold stay
      const nodes = [...drawn.nodes.values()].filter(n => !removeSet.has(n.id));
      const edges = drawn.edges.filter(
        edge => !removeSet.has(edge.source) && !removeSet.has(edge.target)
      );
      model.set("nodes", nodes);
      model.set("edges", edges);
      model.set("selected_node", null);
      model.set("selected_edge", null);
      model.set("selected_nodes", []);
      model.set("selected_edges", []);
      model.save_changes();
    }
  });

  // Double-click node: unpin if pinned, otherwise expand (fetch neighbors)
  renderer.on("doubleClickNode", ({ node }) => {
    const pinned = { ...(model.get("pinned_nodes") || {}) };
    if (pinned[node]) {
      delete pinned[node];
      model.set("pinned_nodes", pinned);
    } else {
      model.set("_expand_request", { node_id: node, timestamp: Date.now() });
    }
    model.save_changes();
  });

  // What the host changes together (lanes, nodes and edges, a style, a batch, pulses) is drawn once, in this order,
  // after it has all arrived: a host that sets lanes, nodes and edges one by one gets one layout, not three
  const pending = new Set();
  function queueSync(kind) {
    if (!pending.size) queueMicrotask(sync);
    pending.add(kind);
  }

  function sync() {
    const changed = new Set(pending);
    pending.clear();
    // The widget's own write-back of what it draws: nothing to do
    if (written && model.get("nodes") === written.nodes && model.get("edges") === written.edges) changed.delete("data");
    const batch = model.get("append_batch") || {};
    const fresh = batch.seq > laneState.lastSeq ? batch : null;
    let redraw = changed.has("lanes") || changed.has("style");
    if (changed.has("data")) {
      const nodes = model.get("nodes") || [], edges = model.get("edges") || [];
      // Graph.append sends its merged lists with the batch: a copy of what is drawn plus the batch, nothing to lay out
      if (!sameItems(fresh ? applyBatchItems(drawn, fresh) : drawn, nodes, edges)) {
        drawn = mergeItems(undefined, nodes, edges);
        redraw = true;
      } else if (!fresh) {
        // The same items, maybe with new properties
        drawn = mergeItems(undefined, nodes, edges);
        if (!redraw) {
          restyle();
          renderer.refresh();
        }
      }
    }
    if (changed.has("colors") && !redraw) {
      restyle();
      renderer.refresh();
    }
    if (redraw) redrawAll();
    if (fresh) {
      applyBatch(fresh);
      writeBack();
    }
    // An active search takes in the redrawn or appended nodes
    if ((redraw || fresh) && searchTerm) onSearch(searchTerm);
    if (redraw || fresh || changed.has("pulse")) applyPulse();
  }

  // The model's nodes and edges hold what is drawn. After a batch the host has not merged into them itself (as
  // Graph.append does), the widget writes the merged lists back, so the node count, the results table, the schema
  // panel and the host see the appended items too.
  let written = null;
  function writeBack() {
    if (sameItems(drawn, model.get("nodes") || [], model.get("edges") || [])) return;
    written = { nodes: [...drawn.nodes.values()], edges: [...drawn.edges] };
    model.set("nodes", written.nodes);
    model.set("edges", written.edges);
    model.save_changes();
  }

  // Redraw from the drawn data: rebuild, lay out, fit the camera
  function redrawAll() {
    rebuildGraph();
    applyLayout(model.get("layout") || "spring");

    // Update LOD thresholds based on new graph size
    const n = graph.order;
    renderer.setSetting("labelRenderedSizeThreshold", n > 200 ? 8 : n > 50 ? 5 : 2);
    renderer.setSetting("labelDensity", n > 200 ? 0.5 : n > 50 ? 1 : 2);

    renderer.refresh();
    // Auto-fit camera to show all nodes after layout
    renderer.getCamera().animatedReset({ duration: 300 });
  }

  model.on("change:nodes", () => queueSync("data"));
  model.on("change:edges", () => queueSync("data"));
  model.on("change:lanes", () => queueSync("lanes"));
  model.on("change:append_batch", () => queueSync("batch"));
  model.on("change:pulse_nodes", () => queueSync("pulse"));
  model.on("change:type_colors", () => queueSync("colors"));
  for (const name of ["color_field", "color_scale", "color_domain", "size_field", "size_range", "edge_color_field", "edge_color_scale", "edge_size_field", "edge_size_range"]) {
    model.on(`change:${name}`, () => queueSync("style"));
  }

  // Layout change handler
  model.on("change:layout", refreshLayout);

  // === Demo Mode: auto-init WASM and populate data ===
  if (model.get("_demo_mode")) {
    (async () => {
      try {
        const demoDataStr = model.get("_demo_data");
        if (demoDataStr && (await grafeoEmbedBackend.connect(model))) {
          await grafeoEmbedBackend.loadStatements(JSON.parse(demoDataStr), model);
        }
      } catch (err) {
        console.warn("Demo WASM init:", err.message);
      }
    })();
  }

  // Cleanup on destroy
  return () => {
    resizeObserver.disconnect();
    renderer.kill();
  };
}

export default { render };
