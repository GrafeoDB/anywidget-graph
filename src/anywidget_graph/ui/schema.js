/**
 * Schema browser sidebar component.
 */
import { ICONS } from "./icons.js";
import { fetchSchema } from "./neo4j.js";

/**
 * Create the schema sidebar panel.
 */
export function createSchemaPanel(model, onExecuteQuery) {
  const panel = document.createElement("div");
  panel.className = "awg-schema-panel";

  // Header
  const header = document.createElement("div");
  header.className = "awg-panel-header";
  header.innerHTML = `<span>Schema</span>`;

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "awg-btn awg-btn-icon awg-btn-sm";
  refreshBtn.innerHTML = ICONS.refresh;
  refreshBtn.title = "Refresh schema";
  refreshBtn.addEventListener("click", () => fetchSchema(model));
  header.appendChild(refreshBtn);

  panel.appendChild(header);

  // Content
  const content = document.createElement("div");
  content.className = "awg-schema-content";

  function renderSchema() {
    content.innerHTML = "";

    const nodeTypes = model.get("schema_node_types") || [];
    const edgeTypes = model.get("schema_edge_types") || [];

    if (nodeTypes.length === 0 && edgeTypes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "awg-schema-empty";
      empty.textContent = "Connect to load schema";
      content.appendChild(empty);
      return;
    }

    // Node types section
    if (nodeTypes.length > 0) {
      const nodeSection = document.createElement("div");
      nodeSection.className = "awg-schema-section";

      const nodeHeader = document.createElement("div");
      nodeHeader.className = "awg-schema-section-header";
      nodeHeader.innerHTML = `${ICONS.node} <span>Node Labels</span>`;
      nodeSection.appendChild(nodeHeader);

      nodeTypes.forEach(({ label, properties }) => {
        const item = createSchemaItem(label, properties, "node", model, onExecuteQuery);
        nodeSection.appendChild(item);
      });

      content.appendChild(nodeSection);
    }

    // Edge types section
    if (edgeTypes.length > 0) {
      const edgeSection = document.createElement("div");
      edgeSection.className = "awg-schema-section";

      const edgeHeader = document.createElement("div");
      edgeHeader.className = "awg-schema-section-header";
      edgeHeader.innerHTML = `${ICONS.edge} <span>Relationships</span>`;
      edgeSection.appendChild(edgeHeader);

      edgeTypes.forEach(({ type, properties }) => {
        const item = createSchemaItem(type, properties, "edge", model, onExecuteQuery);
        edgeSection.appendChild(item);
      });

      content.appendChild(edgeSection);
    }
  }

  model.on("change:schema_node_types", renderSchema);
  model.on("change:schema_edge_types", renderSchema);
  renderSchema();

  panel.appendChild(content);
  return panel;
}

/**
 * Create a schema item (node label or relationship type).
 */
function createSchemaItem(name, properties, type, model, onExecuteQuery) {
  const item = document.createElement("div");
  item.className = "awg-schema-item";

  const itemHeader = document.createElement("div");
  itemHeader.className = "awg-schema-item-header";

  const expandBtn = document.createElement("span");
  expandBtn.className = "awg-schema-expand";
  expandBtn.innerHTML = ICONS.chevronRight;

  const nameSpan = document.createElement("span");
  nameSpan.className = "awg-schema-name";
  nameSpan.textContent = name;

  itemHeader.appendChild(expandBtn);
  itemHeader.appendChild(nameSpan);

  // Click on name to query
  nameSpan.addEventListener("click", (e) => {
    e.stopPropagation();
    let query;
    if (type === "node") {
      query = `MATCH (n:\`${name}\`) RETURN n LIMIT 25`;
    } else {
      query = `MATCH (a)-[r:\`${name}\`]->(b) RETURN a, r, b LIMIT 25`;
    }
    model.set("query", query);
    model.save_changes();
    onExecuteQuery();
  });

  // Properties list (collapsed by default)
  const propsList = document.createElement("div");
  propsList.className = "awg-schema-props";

  if (properties && properties.length > 0) {
    properties.forEach((prop) => {
      const propItem = document.createElement("div");
      propItem.className = "awg-schema-prop";
      propItem.innerHTML = `${ICONS.property} <span>${prop}</span>`;

      // Click on property to query with that property
      propItem.addEventListener("click", (e) => {
        e.stopPropagation();
        let query;
        if (type === "node") {
          query = `MATCH (n:\`${name}\`) RETURN n.\`${prop}\` AS ${prop}, n LIMIT 25`;
        } else {
          query = `MATCH (a)-[r:\`${name}\`]->(b) RETURN r.\`${prop}\` AS ${prop}, a, r, b LIMIT 25`;
        }
        model.set("query", query);
        model.save_changes();
        onExecuteQuery();
      });

      propsList.appendChild(propItem);
    });
  } else {
    const noProp = document.createElement("div");
    noProp.className = "awg-schema-prop awg-schema-prop-empty";
    noProp.textContent = "No properties";
    propsList.appendChild(noProp);
  }

  item.appendChild(itemHeader);
  item.appendChild(propsList);

  // Toggle expand/collapse
  itemHeader.addEventListener("click", () => {
    item.classList.toggle("awg-schema-item-expanded");
  });

  return item;
}

/**
 * Toggle schema panel visibility.
 */
export function toggleSchemaPanel(wrapper) {
  const panel = wrapper.querySelector(".awg-schema-panel");
  if (panel) {
    panel.classList.toggle("awg-panel-open");
  }
}
