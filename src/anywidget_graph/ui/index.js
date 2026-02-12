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
import * as neo4jBackend from "./neo4j.js";
import * as grafeoBackend from "./grafeo.js";
import * as grafeoEmbedBackend from "./grafeo-embed.js";

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

  if (backend === "neo4j") {
    // Browser-side Neo4j driver
    const result = await neo4jBackend.executeQuery(
      query,
      model.get("connection_database"),
      model
    );
    if (result) {
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
      model.set("nodes", result.nodes);
      model.set("edges", result.edges);
      model.save_changes();
    }
  } else if (backend === "grafeo" && mode === "wasm") {
    // Browser-side Grafeo WASM
    const result = await grafeoEmbedBackend.executeQuery(query, language, model);
    if (result) {
      model.set("nodes", result.nodes);
      model.set("edges", result.edges);
      model.save_changes();
    }
  } else {
    // Python-side backends (grafeo-embedded, ladybug, arango, cosmosdb)
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

  // Create toolbar if enabled
  if (model.get("show_toolbar")) {
    const toolbar = createToolbar(model, onExecuteQuery, panels);
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
  el.appendChild(wrapper);

  // Initialize Graphology graph
  const graph = new Graph();

  // Add initial nodes
  const nodes = model.get("nodes") || [];
  nodes.forEach((node) => {
    graph.addNode(node.id, {
      label: node.label || node.id,
      x: node.x ?? Math.random() * 100,
      y: node.y ?? Math.random() * 100,
      size: node.size || 10,
      color: node.color || "#6366f1",
    });
  });

  // Add initial edges
  const edges = model.get("edges") || [];
  edges.forEach((edge) => {
    graph.addEdge(edge.source, edge.target, {
      label: edge.label || "",
      size: edge.size || 2,
      color: edge.color || "#94a3b8",
    });
  });

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

  // ResizeObserver for responsive sizing
  const resizeObserver = new ResizeObserver(() => {
    renderer.resize();
  });
  resizeObserver.observe(container);

  // Node click handler
  renderer.on("clickNode", ({ node }) => {
    const nodeData = graph.getNodeAttributes(node);
    model.set("selected_node", { id: node, ...nodeData });
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
    model.save_changes();
  });

  // Update graph when nodes change
  model.on("change:nodes", () => {
    graph.clear();
    const newNodes = model.get("nodes") || [];
    newNodes.forEach((node) => {
      graph.addNode(node.id, {
        label: node.label || node.id,
        x: node.x ?? Math.random() * 100,
        y: node.y ?? Math.random() * 100,
        size: node.size || 10,
        color: node.color || "#6366f1",
      });
    });
    const newEdges = model.get("edges") || [];
    newEdges.forEach((edge) => {
      graph.addEdge(edge.source, edge.target, {
        label: edge.label || "",
        size: edge.size || 2,
        color: edge.color || "#94a3b8",
      });
    });
    renderer.refresh();
  });

  // Update graph when edges change
  model.on("change:edges", () => {
    graph.clearEdges();
    const newEdges = model.get("edges") || [];
    newEdges.forEach((edge) => {
      graph.addEdge(edge.source, edge.target, {
        label: edge.label || "",
        size: edge.size || 2,
        color: edge.color || "#94a3b8",
      });
    });
    renderer.refresh();
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
