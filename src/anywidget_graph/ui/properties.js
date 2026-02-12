/**
 * Properties panel component for displaying selected node/edge details.
 */
import { ICONS } from "./icons.js";

/**
 * Create the properties panel.
 */
export function createPropertiesPanel(model, callbacks) {
  const panel = document.createElement("div");
  panel.className = "awg-properties-panel";

  // Header with close button
  const header = document.createElement("div");
  header.className = "awg-panel-header";
  header.innerHTML = "<span>Properties</span>";
  const closeBtn = document.createElement("button");
  closeBtn.className = "awg-btn awg-btn-icon awg-btn-sm";
  closeBtn.innerHTML = ICONS.close;
  closeBtn.title = "Close properties";
  closeBtn.addEventListener("click", () => {
    panel.classList.remove("awg-panel-open");
    callbacks?.onClose?.();
  });
  header.appendChild(closeBtn);
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

  return {
    element: panel,
    open: () => panel.classList.add("awg-panel-open"),
    close: () => panel.classList.remove("awg-panel-open"),
    toggle: () => panel.classList.toggle("awg-panel-open"),
    isOpen: () => panel.classList.contains("awg-panel-open"),
  };
}

/**
 * Render node properties.
 */
function renderNodeProperties(content, node) {
  const nodeHeader = document.createElement("div");
  nodeHeader.className = "awg-properties-header";
  nodeHeader.innerHTML = `${ICONS.node} <span class="awg-properties-type">Node</span>`;
  content.appendChild(nodeHeader);

  const idItem = document.createElement("div");
  idItem.className = "awg-property-item";
  idItem.innerHTML = `<span class="awg-property-key">id</span><span class="awg-property-value">${node.id || "N/A"}</span>`;
  content.appendChild(idItem);

  if (node.labels && node.labels.length > 0) {
    const labelsItem = document.createElement("div");
    labelsItem.className = "awg-property-item";
    labelsItem.innerHTML = `<span class="awg-property-key">labels</span><span class="awg-property-value awg-property-labels">${node.labels.map((l) => `<span class="awg-label-tag">${l}</span>`).join("")}</span>`;
    content.appendChild(labelsItem);
  }

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
  const edgeHeader = document.createElement("div");
  edgeHeader.className = "awg-properties-header";
  edgeHeader.innerHTML = `${ICONS.edge} <span class="awg-properties-type">Relationship</span>`;
  content.appendChild(edgeHeader);

  if (edge.label) {
    const typeItem = document.createElement("div");
    typeItem.className = "awg-property-item";
    typeItem.innerHTML = `<span class="awg-property-key">type</span><span class="awg-property-value"><span class="awg-edge-tag">${edge.label}</span></span>`;
    content.appendChild(typeItem);
  }

  const sourceItem = document.createElement("div");
  sourceItem.className = "awg-property-item";
  sourceItem.innerHTML = `<span class="awg-property-key">source</span><span class="awg-property-value awg-property-truncate">${edge.source}</span>`;
  content.appendChild(sourceItem);

  const targetItem = document.createElement("div");
  targetItem.className = "awg-property-item";
  targetItem.innerHTML = `<span class="awg-property-key">target</span><span class="awg-property-value awg-property-truncate">${edge.target}</span>`;
  content.appendChild(targetItem);

  Object.entries(edge).forEach(([key, value]) => {
    if (["source", "target", "label", "size", "color"].includes(key)) return;
    const item = document.createElement("div");
    item.className = "awg-property-item";
    const displayValue = typeof value === "object" ? JSON.stringify(value) : String(value);
    item.innerHTML = `<span class="awg-property-key">${key}</span><span class="awg-property-value">${displayValue}</span>`;
    content.appendChild(item);
  });
}
