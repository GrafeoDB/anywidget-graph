/**
 * Schema browser sidebar component.
 */
import { ICONS } from "./icons.js";
import { fetchSchema as neo4jFetchSchema } from "./neo4j.js";
import { fetchSchema as grafeoFetchSchema } from "./grafeo.js";
import { fetchSchema as grafeoEmbedFetchSchema } from "./grafeo-embed.js";

/**
 * Create the schema sidebar panel.
 */
export function createSchemaPanel(model, onExecuteQuery, callbacks) {
  const panel = document.createElement("div");
  panel.className = "awg-schema-panel";

  // Header with close + refresh buttons
  const header = document.createElement("div");
  header.className = "awg-panel-header";
  header.innerHTML = "<span>Schema</span>";

  const headerBtns = document.createElement("div");
  headerBtns.style.display = "flex";
  headerBtns.style.gap = "4px";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "awg-btn awg-btn-icon awg-btn-sm";
  refreshBtn.innerHTML = ICONS.refresh;
  refreshBtn.title = "Refresh schema";
  refreshBtn.addEventListener("click", () => refreshSchema(model));
  headerBtns.appendChild(refreshBtn);

  const closeBtn = document.createElement("button");
  closeBtn.className = "awg-btn awg-btn-icon awg-btn-sm";
  closeBtn.innerHTML = ICONS.close;
  closeBtn.title = "Close schema";
  closeBtn.addEventListener("click", () => {
    panel.classList.remove("awg-panel-open");
    callbacks?.onClose?.();
  });
  headerBtns.appendChild(closeBtn);

  header.appendChild(headerBtns);
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

  return {
    element: panel,
    open: () => panel.classList.add("awg-panel-open"),
    close: () => panel.classList.remove("awg-panel-open"),
    toggle: () => panel.classList.toggle("awg-panel-open"),
    isOpen: () => panel.classList.contains("awg-panel-open"),
  };
}

/**
 * Refresh schema based on current backend.
 */
function refreshSchema(model) {
  const backend = model.get("database_backend");
  const mode = model.get("grafeo_connection_mode");

  if (backend === "neo4j") {
    neo4jFetchSchema(model);
  } else if (backend === "grafeo" && mode === "server") {
    grafeoFetchSchema(model);
  } else if (backend === "grafeo" && mode === "wasm") {
    grafeoEmbedFetchSchema(model);
  } else {
    // Python-side backends: trigger via counter
    model.set("_execute_query", model.get("_execute_query") + 1);
    model.save_changes();
  }
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
    const lang = model.get("query_language") || "cypher";
    let query;

    if (lang === "gql") {
      query = type === "node"
        ? `MATCH (n:${name}) RETURN n LIMIT 25`
        : `MATCH (a)-[r:${name}]->(b) RETURN a, r, b LIMIT 25`;
    } else if (lang === "cypher") {
      query = type === "node"
        ? `MATCH (n:\`${name}\`) RETURN n LIMIT 25`
        : `MATCH (a)-[r:\`${name}\`]->(b) RETURN a, r, b LIMIT 25`;
    } else if (lang === "gremlin") {
      query = type === "node"
        ? `g.V().hasLabel('${name}').limit(25)`
        : `g.E().hasLabel('${name}').limit(25)`;
    } else if (lang === "sparql") {
      query = type === "node"
        ? `SELECT ?s ?p ?o WHERE { ?s a <${name}> ; ?p ?o } LIMIT 25`
        : `SELECT ?s ?o WHERE { ?s <${name}> ?o } LIMIT 25`;
    } else {
      // Fallback to Cypher-like
      query = type === "node"
        ? `MATCH (n:\`${name}\`) RETURN n LIMIT 25`
        : `MATCH (a)-[r:\`${name}\`]->(b) RETURN a, r, b LIMIT 25`;
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

      propItem.addEventListener("click", (e) => {
        e.stopPropagation();
        const lang = model.get("query_language") || "cypher";
        let query;

        if (lang === "gremlin") {
          query = type === "node"
            ? `g.V().hasLabel('${name}').values('${prop}').limit(25)`
            : `g.E().hasLabel('${name}').values('${prop}').limit(25)`;
        } else {
          // Cypher / GQL
          query = type === "node"
            ? `MATCH (n:\`${name}\`) RETURN n.\`${prop}\` AS ${prop}, n LIMIT 25`
            : `MATCH (a)-[r:\`${name}\`]->(b) RETURN r.\`${prop}\` AS ${prop}, a, r, b LIMIT 25`;
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
