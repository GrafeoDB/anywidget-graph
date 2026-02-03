/**
 * Properties panel component for displaying selected node/edge details.
 */
import { ICONS } from "./icons.js";

/**
 * Create the properties panel.
 */
export function createPropertiesPanel(model) {
  const panel = document.createElement("div");
  panel.className = "awg-properties-panel";

  // Header
  const header = document.createElement("div");
  header.className = "awg-panel-header";
  header.innerHTML = "<span>Properties</span>";
  panel.appendChild(header);

  // Content
  const content = document.createElement("div");
  content.className = "awg-properties-content";

  function renderProperties() {
    content.innerHTML = "";

    const selectedNode = model.get("selected_node");
    const selectedEdge = model.get("selected_edge");

    if (!selectedNode && !selectedEdge) {
      const empty = document.createElement("div");
      empty.className = "awg-properties-empty";
      empty.textContent = "Click a node or edge to view properties";
      content.appendChild(empty);
      return;
    }

    if (selectedNode) {
      renderNodeProperties(content, selectedNode);
    }

    if (selectedEdge) {
      renderEdgeProperties(content, selectedEdge);
    }
  }

  model.on("change:selected_node", renderProperties);
  model.on("change:selected_edge", renderProperties);
  renderProperties();

  panel.appendChild(content);
  return panel;
}

/**
 * Render node properties.
 */
function renderNodeProperties(content, node) {
  // Node header
  const nodeHeader = document.createElement("div");
  nodeHeader.className = "awg-properties-header";
  nodeHeader.innerHTML = `${ICONS.node} <span class="awg-properties-type">Node</span>`;
  content.appendChild(nodeHeader);

  // Node ID
  const idItem = document.createElement("div");
  idItem.className = "awg-property-item";
  idItem.innerHTML = `<span class="awg-property-key">id</span><span class="awg-property-value">${node.id || "N/A"}</span>`;
  content.appendChild(idItem);

  // Labels
  if (node.labels && node.labels.length > 0) {
    const labelsItem = document.createElement("div");
    labelsItem.className = "awg-property-item";
    labelsItem.innerHTML = `<span class="awg-property-key">labels</span><span class="awg-property-value awg-property-labels">${node.labels.map((l) => `<span class="awg-label-tag">${l}</span>`).join("")}</span>`;
    content.appendChild(labelsItem);
  }

  // Other properties
  Object.entries(node).forEach(([key, value]) => {
    if (["id", "labels", "label", "x", "y", "size", "color"].includes(key)) return;
    const item = document.createElement("div");
    item.className = "awg-property-item";
    const displayValue = typeof value === "object" ? JSON.stringify(value) : String(value);
    item.innerHTML = `<span class="awg-property-key">${key}</span><span class="awg-property-value">${displayValue}</span>`;
    content.appendChild(item);
  });
}

/**
 * Render edge properties.
 */
function renderEdgeProperties(content, edge) {
  // Edge header
  const edgeHeader = document.createElement("div");
  edgeHeader.className = "awg-properties-header";
  edgeHeader.innerHTML = `${ICONS.edge} <span class="awg-properties-type">Relationship</span>`;
  content.appendChild(edgeHeader);

  // Edge type/label
  if (edge.label) {
    const typeItem = document.createElement("div");
    typeItem.className = "awg-property-item";
    typeItem.innerHTML = `<span class="awg-property-key">type</span><span class="awg-property-value"><span class="awg-edge-tag">${edge.label}</span></span>`;
    content.appendChild(typeItem);
  }

  // Source/Target
  const sourceItem = document.createElement("div");
  sourceItem.className = "awg-property-item";
  sourceItem.innerHTML = `<span class="awg-property-key">source</span><span class="awg-property-value awg-property-truncate">${edge.source}</span>`;
  content.appendChild(sourceItem);

  const targetItem = document.createElement("div");
  targetItem.className = "awg-property-item";
  targetItem.innerHTML = `<span class="awg-property-key">target</span><span class="awg-property-value awg-property-truncate">${edge.target}</span>`;
  content.appendChild(targetItem);

  // Other properties
  Object.entries(edge).forEach(([key, value]) => {
    if (["source", "target", "label", "size", "color"].includes(key)) return;
    const item = document.createElement("div");
    item.className = "awg-property-item";
    const displayValue = typeof value === "object" ? JSON.stringify(value) : String(value);
    item.innerHTML = `<span class="awg-property-key">${key}</span><span class="awg-property-value">${displayValue}</span>`;
    content.appendChild(item);
  });
}

/**
 * Toggle properties panel visibility.
 */
export function togglePropertiesPanel(wrapper) {
  const panel = wrapper.querySelector(".awg-properties-panel");
  if (panel) {
    panel.classList.toggle("awg-panel-open");
  }
}
