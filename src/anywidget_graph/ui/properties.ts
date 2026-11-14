/**
 * Properties panel component for displaying selected node/edge details.
 */
import { panelControls, setPanelOpen } from "./panel.ts";
import { ICONS } from "./icons.ts";
import type { GraphEdge, GraphNode, Panel, WidgetModel } from "./types.ts";

/**
 * Create the properties panel.
 */
export function createPropertiesPanel(
  model: WidgetModel,
  callbacks?: { onClose?: () => void },
  // A node type's colour as the view draws it, so the label tags match the nodes
  colorOf?: (label: string) => string,
): Panel {
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
    setPanelOpen(panel, false);
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
      renderNodeProperties(content, selectedNode, colorOf);
    }

    if (selectedEdge) {
      renderEdgeProperties(content, selectedEdge);
    }
  }

  model.on("change:selected_node", renderProperties);
  model.on("change:selected_edge", renderProperties);
  // The label tags take the type's colour as drawn: each theme has its own data colours, and the host may set its own
  model.on("change:dark_mode", renderProperties);
  model.on("change:type_colors", renderProperties);
  renderProperties();

  panel.appendChild(content);

  return panelControls(panel);
}

/**
 * A span holding `text` as text, never as markup: node and edge values come from the data.
 */
function textSpan(className: string, text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

/**
 * A property row: the key, then a text span for a string value, or `value` itself when it is an element.
 */
function propertyItem(key: string, value: string | HTMLElement, valueClass = "awg-property-value"): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "awg-property-item";
  item.appendChild(textSpan("awg-property-key", key));
  item.appendChild(typeof value === "string" ? textSpan(valueClass, value) : value);
  return item;
}

/**
 * Render node properties.
 */
export function renderNodeProperties(content: HTMLElement, node: GraphNode, colorOf?: (label: string) => string): void {
  const nodeHeader = document.createElement("div");
  nodeHeader.className = "awg-properties-header";
  nodeHeader.innerHTML = `${ICONS.node} <span class="awg-properties-type">Node</span>`;
  // The header's dot and each label tag take the type's colour (--awg-tag), drawn like a node: ring and 38% fill
  const firstLabel = node.labels?.[0] ?? node.label;
  if (colorOf && firstLabel !== undefined) nodeHeader.style.setProperty("--awg-tag", colorOf(String(firstLabel)));
  content.appendChild(nodeHeader);

  content.appendChild(propertyItem("id", String(node.id || "N/A")));

  if (node.labels && node.labels.length > 0) {
    const labels = document.createElement("span");
    labels.className = "awg-property-value awg-property-labels";
    node.labels.forEach((l: string) => {
      const tag = labels.appendChild(textSpan("awg-label-tag", String(l)));
      if (colorOf) tag.style.setProperty("--awg-tag", colorOf(String(l)));
    });
    content.appendChild(propertyItem("labels", labels));
  }

  Object.entries(node).forEach(([key, value]: [string, unknown]) => {
    if (["id", "labels", "label", "x", "y", "size", "color", "nodeType"].includes(key)) return;
    const displayValue = typeof value === "object" ? JSON.stringify(value) : String(value);
    content.appendChild(propertyItem(key, displayValue));
  });
}

/**
 * Render edge properties.
 */
export function renderEdgeProperties(content: HTMLElement, edge: GraphEdge): void {
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

  Object.entries(edge).forEach(([key, value]: [string, unknown]) => {
    if (["source", "target", "label", "size", "color", "edgeType"].includes(key)) return;
    const displayValue = typeof value === "object" ? JSON.stringify(value) : String(value);
    content.appendChild(propertyItem(key, displayValue));
  });
}
