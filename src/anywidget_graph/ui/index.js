/**
 * Main entry point for the anywidget-graph UI.
 * Orchestrates all UI components and graph rendering.
 */
import Graph from "https://esm.sh/graphology@0.25.4";
import Sigma from "https://esm.sh/sigma@3.0.0";
import * as d3Force from "https://esm.sh/d3-force@3.0.0";

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

function computeNodeColor(node, colorField, colorScale, colorDomain) {
  if (node.color) return node.color;
  if (!colorField || node[colorField] === undefined) {
    // Color by node type (matches filter panel swatch colors)
    const nodeType = (node.labels && node.labels.length > 0) ? node.labels[0] : (node.label || "");
    if (nodeType) return getCategoricalColor(nodeType);
    return "#6366f1";
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
 * Main render function for the anywidget.
 */
function render({ model, el }) {
  const wrapper = document.createElement("div");
  wrapper.className = "awg-wrapper";
  wrapper.style.width = model.get("width") + "px";
  wrapper.style.height = model.get("height") + "px";
  wrapper.style.maxHeight = model.get("height") + "px";

  // Apply dark mode
  function updateTheme() {
    wrapper.classList.toggle("awg-dark", model.get("dark_mode"));
  }
  updateTheme();
  model.on("change:dark_mode", () => {
    updateTheme();
    rendererRef?.setSetting("labelColor", { color: model.get("dark_mode") ? "#e0e0e0" : "#333" });
    rendererRef?.refresh();
  });

  // Create query executor callback
  const onExecuteQuery = () => executeQuery(model);

  // Filter state (shared with node/edge reducers)
  let hiddenNodeTypes = new Set();
  let hiddenEdgeTypes = new Set();
  let typeColorOverrides = new Map(); // custom colors from filter panel
  let rendererRef = null; // set after Sigma init

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

  // Layout application (preserves pinned positions, respects filters)
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
        const nodes = model.get("nodes") || [];
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

        // Configure forces
        const linkDistance = n < 30 ? 50 : n < 100 ? 40 : 30;
        const chargeStrength = n < 30 ? -200 : n < 100 ? -150 : -80;

        const simulation = d3Force.forceSimulation(d3Nodes)
          .force("link", d3Force.forceLink(d3Links).distance(linkDistance).strength(0.5))
          .force("charge", d3Force.forceManyBody().strength(chargeStrength))
          .force("center", d3Force.forceCenter(0, 0))
          .force("collide", d3Force.forceCollide().radius((d) => d.size * 1.5 + 2).strength(0.7))
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

  // Apply initial layout
  applyLayout(model.get("layout") || "spring");

  // Initialize Sigma renderer with LOD settings
  const nodeCount = graph.order;
  const renderer = new Sigma(graph, container, {
    renderLabels: model.get("show_labels"),
    renderEdgeLabels: model.get("show_edge_labels"),
    defaultNodeColor: "#6366f1",
    defaultEdgeColor: "#94a3b8",
    labelColor: { color: model.get("dark_mode") ? "#e0e0e0" : "#333" },
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
  });
  rendererRef = renderer;

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

    return res;
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
    applyLayout(model.get("layout") || "spring");

    // Update LOD thresholds based on new graph size
    const n = graph.order;
    renderer.setSetting("labelRenderedSizeThreshold", n > 200 ? 8 : n > 50 ? 5 : 2);
    renderer.setSetting("labelDensity", n > 200 ? 0.5 : n > 50 ? 1 : 2);

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
  model.on("change:layout", refreshLayout);

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
