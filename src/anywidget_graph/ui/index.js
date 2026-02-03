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

/**
 * Execute a query based on the current backend.
 */
async function executeQuery(model) {
  const backend = model.get("database_backend");
  const query = model.get("query");

  if (!query.trim()) {
    model.set("query_error", "Please enter a query");
    model.save_changes();
    return;
  }

  if (backend === "neo4j") {
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
  } else if (backend === "grafeo") {
    // Trigger Python-side execution
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

  // Apply dark mode
  function updateTheme() {
    wrapper.classList.toggle("awg-dark", model.get("dark_mode"));
  }
  updateTheme();
  model.on("change:dark_mode", updateTheme);

  // Create query executor callback
  const onExecuteQuery = () => executeQuery(model);

  // Create toolbar if enabled
  if (model.get("show_toolbar")) {
    const toolbar = createToolbar(model, wrapper, onExecuteQuery);
    wrapper.appendChild(toolbar);
  }

  // Main content area (schema + graph + properties)
  const content = document.createElement("div");
  content.className = "awg-content";

  // Create schema sidebar (left) - collapsed by default
  const schemaSidebar = createSchemaPanel(model, onExecuteQuery);
  content.appendChild(schemaSidebar);

  // Create graph container
  const container = document.createElement("div");
  container.className = "awg-graph-container";
  container.style.width = model.get("width") + "px";
  container.style.height = model.get("height") + "px";
  content.appendChild(container);

  // Create properties panel (right) - collapsed by default
  const propertiesPanel = createPropertiesPanel(model);
  content.appendChild(propertiesPanel);

  // Create settings panel if enabled
  if (model.get("show_settings")) {
    const settingsPanel = createSettingsPanel(model);
    content.appendChild(settingsPanel);
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

  // Cleanup on destroy
  return () => {
    renderer.kill();
  };
}

export default { render };
