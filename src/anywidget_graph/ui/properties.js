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
 * A span holding `text` as text, never as markup: node and edge values come from the data.
 */
function textSpan(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

/**
 * A property row: the key, then a text span for a string value, or `value` itself when it is an element.
 */
function propertyItem(key, value, valueClass = "awg-property-value") {
  const item = document.createElement("div");
  item.className = "awg-property-item";
  item.appendChild(textSpan("awg-property-key", key));
  item.appendChild(typeof value === "string" ? textSpan(valueClass, value) : value);
  return item;
}

/**
 * Render node properties.
 */
export function renderNodeProperties(content, node) {
  const nodeHeader = document.createElement("div");
  nodeHeader.className = "awg-properties-header";
  nodeHeader.innerHTML = `${ICONS.node} <span class="awg-properties-type">Node</span>`;
  content.appendChild(nodeHeader);

  content.appendChild(propertyItem("id", String(node.id || "N/A")));

  if (node.labels && node.labels.length > 0) {
    const labels = document.createElement("span");
    labels.className = "awg-property-value awg-property-labels";
    node.labels.forEach((l) => labels.appendChild(textSpan("awg-label-tag", String(l))));
    content.appendChild(propertyItem("labels", labels));
  }

  Object.entries(node).forEach(([key, value]) => {
    if (["id", "labels", "label", "x", "y", "size", "color", "nodeType"].includes(key)) return;
    const displayValue = typeof value === "object" ? JSON.stringify(value) : String(value);
    content.appendChild(propertyItem(key, displayValue));
  });
}

/**
 * Render edge properties.
 */
export function renderEdgeProperties(content, edge) {
  const edgeHeader = document.createElement("div");
  edgeHeader.className = "awg-properties-header";
  edgeHeader.innerHTML = `${ICONS.edge} <span class="awg-properties-type">Relationship</span>`;
  content.appendChild(edgeHeader);

  const edgeTypeName = edge.edgeType || edge.label || edge.type;
  if (edgeTypeName) {
    const type = document.createElement("span");
    type.className = "awg-property-value";
    type.appendChild(textSpan("awg-edge-tag", String(edgeTypeName)));
    content.appendChild(propertyItem("type", type));
  }

  content.appendChild(propertyItem("source", String(edge.source), "awg-property-value awg-property-truncate"));
  content.appendChild(propertyItem("target", String(edge.target), "awg-property-value awg-property-truncate"));

  Object.entries(edge).forEach(([key, value]) => {
    if (["source", "target", "label", "size", "color", "edgeType"].includes(key)) return;
    const displayValue = typeof value === "object" ? JSON.stringify(value) : String(value);
    content.appendChild(propertyItem(key, displayValue));
  });
}
