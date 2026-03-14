/**
 * Main entry point for the anywidget-graph UI.
 * Orchestrates all UI components and graph rendering.
 */
import Graph from "https://esm.sh/graphology@0.25.4";
import Sigma from "https://esm.sh/sigma@3.0.0";

import { createToolbar } from "./toolbar.js";
import { createSchemaPanel } from "./schema.js";
import { createSettingsPanel } from "./settings.js";
import { createPropertiesPanel } from "./properties.js";
import { createResultsDrawer } from "./results.js";
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

function computeNodeColor(node, colorField, colorScale, colorDomain) {
  if (node.color) return node.color;
  if (!colorField || node[colorField] === undefined) return "#6366f1";
  const value = node[colorField];
  if (typeof value === "number") return getColorFromScale(value, colorScale, colorDomain);
  return getCategoricalColor(value);
}

function computeNodeSize(node, sizeField, sizeDomain, sizeRange) {
  if (node.size !== undefined) return node.size;
  if (!sizeField || node[sizeField] === undefined || !sizeDomain) return 10;
  const [min, max] = sizeDomain;
  const t = max > min ? (node[sizeField] - min) / (max - min) : 0.5;
  return sizeRange[0] + t * (sizeRange[1] - sizeRange[0]);
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

  return {
    colorField, colorScale, colorDomain, sizeField, sizeDomain, sizeRange,
    edgeColorField, edgeColorScale, edgeColorDomain,
    edgeSizeField, edgeSizeDomain, edgeSizeRange,
  };
}

function buildNodeAttrs(node, opts) {
  return {
    label: autoLabel(node),
    x: node.x ?? Math.random() * 100,
    y: node.y ?? Math.random() * 100,
    size: computeNodeSize(node, opts.sizeField, opts.sizeDomain, opts.sizeRange),
    color: computeNodeColor(node, opts.colorField, opts.colorScale, opts.colorDomain),
  };
}

function buildEdgeAttrs(edge, opts) {
  let color = edge.color || "#94a3b8";
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

  return { label: edge.label || "", size, color };
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
 * Main render function for the anywidget.
 */
function render({ model, el }) {
  const wrapper = document.createElement("div");
  wrapper.className = "awg-wrapper";
  wrapper.style.width = model.get("width") + "px";

  // Apply dark mode
  function updateTheme() {
    wrapper.classList.toggle("awg-dark", model.get("dark_mode"));
  }
  updateTheme();
  model.on("change:dark_mode", updateTheme);

  // Create query executor callback
  const onExecuteQuery = () => executeQuery(model);

  // Create panels first (all collapsed by default)
  const schema = createSchemaPanel(model, onExecuteQuery);
  const properties = createPropertiesPanel(model);
  const settings = model.get("show_settings")
    ? createSettingsPanel(model)
    : null;

  // Panel references for mutual exclusion
  const panels = { schema, settings, properties };

  // Search state (shared with nodeReducer)
  let searchTerm = "";
  let searchMatches = new Set();

  function onSearch(term) {
    searchTerm = (term || "").toLowerCase().trim();
    searchMatches.clear();
    if (searchTerm) {
      graph.forEachNode((id, attrs) => {
        const label = (attrs.label || "").toLowerCase();
        const nodeId = String(id).toLowerCase();
        if (label.includes(searchTerm) || nodeId.includes(searchTerm)) {
          searchMatches.add(id);
        }
      });
    }
    renderer.refresh();
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

  // Graph container (flex: 1 fills available width)
  const container = document.createElement("div");
  container.className = "awg-graph-container";
  container.style.height = model.get("height") + "px";
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

  // Initialize Graphology graph
  const graph = new Graph();

  // Add initial nodes and edges with property-based styling
  function rebuildGraph() {
    graph.clear();
    const nodes = model.get("nodes") || [];
    const edges = model.get("edges") || [];
    const opts = getStylingOpts(model, nodes, edges);

    nodes.forEach((node) => {
      graph.addNode(node.id, buildNodeAttrs(node, opts));
    });

    edges.forEach((edge) => {
      graph.addEdge(edge.source, edge.target, buildEdgeAttrs(edge, opts));
    });
  }

  rebuildGraph();

  // Layout application (preserves pinned node positions)
  function applyLayout(layoutName) {
    if (graph.order === 0) return;
    const pinned = model.get("pinned_nodes") || {};

    // Save pinned positions before layout
    const savedPositions = {};
    Object.keys(pinned).forEach((id) => {
      if (graph.hasNode(id)) {
        savedPositions[id] = { x: graph.getNodeAttribute(id, "x"), y: graph.getNodeAttribute(id, "y") };
      }
    });

    switch (layoutName) {
      case "circular":
        circular.assign(graph);
        break;
      case "random":
        random.assign(graph);
        break;
      case "cluster": {
        // Group nodes by first label, arrange clusters in a circle
        const nodes = model.get("nodes") || [];
        const labelGroups = new Map();
        nodes.forEach((node) => {
          const label = (node.labels && node.labels[0]) || node.label || "__other";
          if (!labelGroups.has(label)) labelGroups.set(label, []);
          labelGroups.get(label).push(node.id);
        });

        const clusterLabels = [...labelGroups.entries()].filter(([, g]) => g.length >= 2);
        const useClusters = clusterLabels.length >= 2;

        if (!useClusters) {
          // Not enough clusters, fall back to force
          applyLayout("force");
          return;
        }

        // Collect all labels (clusters with 2+ nodes first, then singles)
        const singleNodes = [...labelGroups.entries()]
          .filter(([, g]) => g.length < 2)
          .flatMap(([, g]) => g);
        const allGroups = [...clusterLabels];
        if (singleNodes.length > 0) {
          allGroups.push(["__other", singleNodes]);
        }

        const cx = 50, cy = 50;
        const clusterRadius = 40;

        allGroups.forEach(([, nodeIds], clusterIdx) => {
          const clusterAngle = (2 * Math.PI * clusterIdx) / allGroups.length;
          const clusterCx = cx + clusterRadius * Math.cos(clusterAngle);
          const clusterCy = cy + clusterRadius * Math.sin(clusterAngle);
          const innerRadius = Math.max(5, Math.min(20, nodeIds.length * 2));

          nodeIds.forEach((nodeId, nodeIdx) => {
            if (!graph.hasNode(nodeId)) return;
            const innerAngle = (2 * Math.PI * nodeIdx) / nodeIds.length;
            graph.setNodeAttribute(nodeId, "x", clusterCx + innerRadius * Math.cos(innerAngle));
            graph.setNodeAttribute(nodeId, "y", clusterCy + innerRadius * Math.sin(innerAngle));
          });
        });
        break;
      }
      case "force": {
        const n = graph.order;
        // Scale layout parameters to graph size for good spreading
        const iterations = Math.min(300, Math.max(100, n * 3));
        const gravity = n < 20 ? 0.3 : n < 100 ? 0.5 : 1;
        const scalingRatio = n < 20 ? 20 : n < 100 ? 10 : 5;
        forceAtlas2.assign(graph, {
          iterations,
          settings: {
            gravity,
            scalingRatio,
            barnesHutOptimize: n > 50,
            strongGravityMode: false,
            adjustSizes: true,
            slowDown: 1,
          },
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

  // Apply initial layout
  applyLayout(model.get("layout") || "force");

  // Initialize Sigma renderer
  const renderer = new Sigma(graph, container, {
    renderLabels: model.get("show_labels"),
    renderEdgeLabels: model.get("show_edge_labels"),
    defaultNodeColor: "#6366f1",
    defaultEdgeColor: "#94a3b8",
    labelColor: { color: "#333" },
    labelSize: 12,
    labelWeight: "500",
  });

  // Node reducer for selection highlighting, search filtering, and pinned indicator
  renderer.setSetting("nodeReducer", (node, data) => {
    const selectedNodes = model.get("selected_nodes") || [];
    const pinnedNodes = model.get("pinned_nodes") || {};
    const res = { ...data };

    // Dim unselected nodes when there is an active selection
    if (selectedNodes.length > 0 && !selectedNodes.includes(node)) {
      res.color = data.color + "40";
      res.label = "";
    }

    // Dim non-matching nodes when search is active
    if (searchTerm && !searchMatches.has(node)) {
      res.color = data.color + "20";
      res.label = "";
    }

    // Show ring on pinned nodes
    if (pinnedNodes[node]) {
      res.borderColor = "#f59e0b";
      res.borderSize = 2;
    }

    return res;
  });

  model.on("change:selected_nodes", () => { renderer.refresh(); });
  model.on("change:pinned_nodes", () => { renderer.refresh(); });

  // === Node Dragging ===
  let draggedNode = null;
  let isDragging = false;
  let justDragged = false;

  renderer.on("downNode", ({ node }) => {
    if (model.get("selection_mode") === "box") return;
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
  [["force", "Force"], ["cluster", "Cluster"], ["circular", "Circular"], ["random", "Random"]].forEach(([val, text]) => {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = text;
    if (val === (model.get("layout") || "force")) opt.selected = true;
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

  function updateModeButtons() {
    const mode = model.get("selection_mode");
    clickModeBtn.classList.toggle("awg-mode-active", mode !== "box");
    boxModeBtn.classList.toggle("awg-mode-active", mode === "box");
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
  model.on("change:selection_mode", updateModeButtons);

  modeGroup.appendChild(clickModeBtn);
  modeGroup.appendChild(boxModeBtn);

  zoomControls.appendChild(modeGroup);
  zoomControls.appendChild(layoutSelect);
  zoomControls.appendChild(zoomInBtn);
  zoomControls.appendChild(zoomOutBtn);
  zoomControls.appendChild(zoomFitBtn);
  container.appendChild(zoomControls);

  // Selection overlay (for box select)
  const selectionOverlay = document.createElement("div");
  selectionOverlay.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;z-index:15;";
  selectionOverlay.style.pointerEvents = "none";
  container.appendChild(selectionOverlay);

  const selectionRect = document.createElement("div");
  selectionRect.className = "awg-selection-rect";
  container.appendChild(selectionRect);

  function updateSelectionMode() {
    const mode = model.get("selection_mode");
    selectionOverlay.style.pointerEvents = mode === "box" ? "auto" : "none";
    selectionOverlay.style.cursor = mode === "box" ? "crosshair" : "default";
  }
  updateSelectionMode();
  model.on("change:selection_mode", updateSelectionMode);

  let boxStart = null;

  selectionOverlay.addEventListener("mousedown", (e) => {
    if (model.get("selection_mode") !== "box") return;
    const rect = container.getBoundingClientRect();
    boxStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    selectionRect.style.display = "block";
    selectionRect.style.left = boxStart.x + "px";
    selectionRect.style.top = boxStart.y + "px";
    selectionRect.style.width = "0px";
    selectionRect.style.height = "0px";
  });

  selectionOverlay.addEventListener("mousemove", (e) => {
    if (!boxStart) return;
    const rect = container.getBoundingClientRect();
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
  });

  selectionOverlay.addEventListener("mouseup", (e) => {
    if (!boxStart) return;
    const rect = container.getBoundingClientRect();
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
    const nodeData = graph.getNodeAttributes(node);
    const data = { id: node, ...nodeData };
    model.set("hovered_node", data);
    model.save_changes();
    showTooltip(event.original, data);
    container.style.cursor = "pointer";
  });

  renderer.on("leaveNode", () => {
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
    renderer.resize();
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
  renderer.on("clickStage", () => {
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
      const nodes = (model.get("nodes") || []).filter(n => !removeSet.has(n.id));
      const edges = (model.get("edges") || []).filter(
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

  // Update graph when data or styling changes
  function onDataOrStyleChange() {
    rebuildGraph();
    applyLayout(model.get("layout") || "force");
    renderer.refresh();
    // Auto-fit camera to show all nodes after layout
    renderer.getCamera().animatedReset({ duration: 300 });
  }

  model.on("change:nodes", onDataOrStyleChange);
  model.on("change:edges", onDataOrStyleChange);
  model.on("change:color_field", onDataOrStyleChange);
  model.on("change:color_scale", onDataOrStyleChange);
  model.on("change:color_domain", onDataOrStyleChange);
  model.on("change:size_field", onDataOrStyleChange);
  model.on("change:size_range", onDataOrStyleChange);
  model.on("change:edge_color_field", onDataOrStyleChange);
  model.on("change:edge_color_scale", onDataOrStyleChange);
  model.on("change:edge_size_field", onDataOrStyleChange);
  model.on("change:edge_size_range", onDataOrStyleChange);

  // Layout change handler
  model.on("change:layout", () => {
    applyLayout(model.get("layout"));
    renderer.refresh();
    renderer.getCamera().animatedReset({ duration: 300 });
  });

  // === Demo Mode: auto-init WASM and populate data ===
  if (model.get("_demo_mode")) {
    (async () => {
      try {
        const demoDataStr = model.get("_demo_data");
        if (demoDataStr) {
          await grafeoEmbedBackend.connect(model);
          const statements = JSON.parse(demoDataStr);
          for (const stmt of statements) {
            if (stmt.trim()) {
              try {
                await grafeoEmbedBackend.executeQuery(stmt.trim(), "gql", model);
              } catch (_) {
                // Some statements may fail if data already exists
              }
            }
          }
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
