/**
 * Filter + Schema sidebar component.
 * Shows node/edge types from current graph data with toggle checkboxes.
 * Clicking a type name still fires the query (schema browse behavior).
 */
import { ICONS } from "./icons.js";
import { fetchSchema as neo4jFetchSchema } from "./neo4j.js";
import { fetchSchema as grafeoFetchSchema } from "./grafeo.js";
import { fetchSchema as grafeoEmbedFetchSchema } from "./grafeo-embed.js";

const FILTER_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6",
];

function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return FILTER_COLORS[Math.abs(hash) % FILTER_COLORS.length];
}

/**
 * Extract node types and edge types from current graph data.
 */
function extractTypesFromData(model) {
  const nodes = model.get("nodes") || [];
  const edges = model.get("edges") || [];

  // Node types: group by first label, or "Unlabeled"
  const nodeTypeMap = new Map();
  nodes.forEach((node) => {
    const typeKey = (node.labels && node.labels.length > 0)
      ? node.labels[0]
      : (node.label || "Unlabeled");
    if (!nodeTypeMap.has(typeKey)) nodeTypeMap.set(typeKey, 0);
    nodeTypeMap.set(typeKey, nodeTypeMap.get(typeKey) + 1);
  });

  // Edge types: group by label/type
  const edgeTypeMap = new Map();
  edges.forEach((edge) => {
    const typeKey = edge.type || edge.label || "unknown";
    if (!edgeTypeMap.has(typeKey)) edgeTypeMap.set(typeKey, 0);
    edgeTypeMap.set(typeKey, edgeTypeMap.get(typeKey) + 1);
  });

  return {
    nodeTypes: [...nodeTypeMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count })),
    edgeTypes: [...edgeTypeMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count })),
  };
}

/**
 * Create the filter/schema sidebar panel.
 * @param {object} model - anywidget model
 * @param {function} onExecuteQuery - run query callback
 * @param {object} callbacks - optional { onClose }
 * @param {function} onFilterChange - callback(hiddenNodeTypes: Set, hiddenEdgeTypes: Set)
 * @param {function} onColorChange - callback(typeColorMap: Map<string, string>)
 */
export function createSchemaPanel(model, onExecuteQuery, callbacks, onFilterChange, onColorChange) {
  const panel = document.createElement("div");
  panel.className = "awg-schema-panel";

  // Filter state
  const hiddenNodeTypes = new Set();
  const hiddenEdgeTypes = new Set();

  // Custom color overrides per type
  const typeColorMap = new Map();

  // Header
  const header = document.createElement("div");
  header.className = "awg-panel-header";
  header.innerHTML = "<span>Filter</span>";

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
  closeBtn.title = "Close panel";
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

  function emitFilterChange() {
    onFilterChange?.(hiddenNodeTypes, hiddenEdgeTypes);
  }

  function emitColorChange() {
    onColorChange?.(typeColorMap);
  }

  function renderFilters() {
    content.innerHTML = "";

    const { nodeTypes, edgeTypes } = extractTypesFromData(model);
    const schemaNodeTypes = model.get("schema_node_types") || [];
    const schemaEdgeTypes = model.get("schema_edge_types") || [];

    // Build a property lookup from schema data
    const nodePropsMap = new Map();
    schemaNodeTypes.forEach(({ label, properties }) => {
      nodePropsMap.set(label, properties || []);
    });
    const edgePropsMap = new Map();
    schemaEdgeTypes.forEach(({ type, properties }) => {
      edgePropsMap.set(type, properties || []);
    });

    if (nodeTypes.length === 0 && edgeTypes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "awg-schema-empty";
      empty.textContent = "No data loaded";
      content.appendChild(empty);
      return;
    }

    // Show/hide all controls
    if (nodeTypes.length + edgeTypes.length > 2) {
      const bulkRow = document.createElement("div");
      bulkRow.className = "awg-filter-bulk";
      const showAll = document.createElement("button");
      showAll.className = "awg-btn awg-btn-sm";
      showAll.textContent = "Show all";
      showAll.addEventListener("click", () => {
        hiddenNodeTypes.clear();
        hiddenEdgeTypes.clear();
        emitFilterChange();
        renderFilters();
      });
      const hideAll = document.createElement("button");
      hideAll.className = "awg-btn awg-btn-sm";
      hideAll.textContent = "Hide all";
      hideAll.addEventListener("click", () => {
        nodeTypes.forEach(({ label }) => hiddenNodeTypes.add(label));
        edgeTypes.forEach(({ type }) => hiddenEdgeTypes.add(type));
        emitFilterChange();
        renderFilters();
      });
      bulkRow.appendChild(showAll);
      bulkRow.appendChild(hideAll);
      content.appendChild(bulkRow);
    }

    // Node types section
    if (nodeTypes.length > 0) {
      const section = document.createElement("div");
      section.className = "awg-schema-section";

      const sectionHeader = document.createElement("div");
      sectionHeader.className = "awg-schema-section-header";
      sectionHeader.innerHTML = `${ICONS.node} <span>Nodes</span>`;

      if (nodeTypes.length > 1) {
        const toggleLinks = document.createElement("span");
        toggleLinks.className = "awg-filter-toggle-links";
        const allLink = document.createElement("a");
        allLink.textContent = "all";
        allLink.href = "#";
        allLink.addEventListener("click", (e) => {
          e.preventDefault();
          nodeTypes.forEach(({ label }) => hiddenNodeTypes.delete(label));
          emitFilterChange();
          renderFilters();
        });
        const noneLink = document.createElement("a");
        noneLink.textContent = "none";
        noneLink.href = "#";
        noneLink.addEventListener("click", (e) => {
          e.preventDefault();
          nodeTypes.forEach(({ label }) => hiddenNodeTypes.add(label));
          emitFilterChange();
          renderFilters();
        });
        toggleLinks.appendChild(allLink);
        toggleLinks.appendChild(document.createTextNode(" / "));
        toggleLinks.appendChild(noneLink);
        sectionHeader.appendChild(toggleLinks);
      }

      section.appendChild(sectionHeader);

      nodeTypes.forEach(({ label, count }) => {
        const props = nodePropsMap.get(label) || [];
        const item = createFilterItem({
          name: label,
          count,
          color: typeColorMap.get(label) || hashColor(label),
          kind: "node",
          properties: props,
          isHidden: hiddenNodeTypes.has(label),
          onToggle: (visible) => {
            if (visible) hiddenNodeTypes.delete(label);
            else hiddenNodeTypes.add(label);
            emitFilterChange();
          },
          onColorChange: (newColor) => {
            typeColorMap.set(label, newColor);
            emitColorChange();
          },
          onQuery: () => fireTypeQuery(label, "node", model, onExecuteQuery),
        });
        section.appendChild(item);
      });

      content.appendChild(section);
    }

    // Edge types section
    if (edgeTypes.length > 0) {
      const section = document.createElement("div");
      section.className = "awg-schema-section";

      const sectionHeader = document.createElement("div");
      sectionHeader.className = "awg-schema-section-header";
      sectionHeader.innerHTML = `${ICONS.edge} <span>Relationships</span>`;

      if (edgeTypes.length > 1) {
        const toggleLinks = document.createElement("span");
        toggleLinks.className = "awg-filter-toggle-links";
        const allLink = document.createElement("a");
        allLink.textContent = "all";
        allLink.href = "#";
        allLink.addEventListener("click", (e) => {
          e.preventDefault();
          edgeTypes.forEach(({ type }) => hiddenEdgeTypes.delete(type));
          emitFilterChange();
          renderFilters();
        });
        const noneLink = document.createElement("a");
        noneLink.textContent = "none";
        noneLink.href = "#";
        noneLink.addEventListener("click", (e) => {
          e.preventDefault();
          edgeTypes.forEach(({ type }) => hiddenEdgeTypes.add(type));
          emitFilterChange();
          renderFilters();
        });
        toggleLinks.appendChild(allLink);
        toggleLinks.appendChild(document.createTextNode(" / "));
        toggleLinks.appendChild(noneLink);
        sectionHeader.appendChild(toggleLinks);
      }

      section.appendChild(sectionHeader);

      edgeTypes.forEach(({ type, count }) => {
        const props = edgePropsMap.get(type) || [];
        const item = createFilterItem({
          name: type,
          count,
          color: typeColorMap.get(type) || hashColor(type),
          kind: "edge",
          properties: props,
          isHidden: hiddenEdgeTypes.has(type),
          onToggle: (visible) => {
            if (visible) hiddenEdgeTypes.delete(type);
            else hiddenEdgeTypes.add(type);
            emitFilterChange();
          },
          onColorChange: (newColor) => {
            typeColorMap.set(type, newColor);
            emitColorChange();
          },
          onQuery: () => fireTypeQuery(type, "edge", model, onExecuteQuery),
        });
        section.appendChild(item);
      });

      content.appendChild(section);
    }
  }

  model.on("change:nodes", renderFilters);
  model.on("change:edges", renderFilters);
  model.on("change:schema_node_types", renderFilters);
  model.on("change:schema_edge_types", renderFilters);
  renderFilters();

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
 * Create a single filter item with checkbox, color swatch, name, and count.
 */
function createFilterItem({ name, count, color, kind, properties, isHidden, onToggle, onColorChange, onQuery }) {
  const item = document.createElement("div");
  item.className = "awg-schema-item" + (isHidden ? " awg-filter-hidden" : "");

  const itemHeader = document.createElement("div");
  itemHeader.className = "awg-schema-item-header";

  // Checkbox
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = !isHidden;
  checkbox.className = "awg-filter-checkbox";
  checkbox.title = isHidden ? `Show ${name}` : `Hide ${name}`;
  checkbox.addEventListener("click", (e) => {
    e.stopPropagation();
    const visible = checkbox.checked;
    item.classList.toggle("awg-filter-hidden", !visible);
    onToggle(visible);
  });
  itemHeader.appendChild(checkbox);

  // Color picker swatch
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "awg-filter-color-picker";
  colorInput.value = color;
  colorInput.title = `Change color for ${name}`;
  colorInput.addEventListener("input", (e) => {
    e.stopPropagation();
    onColorChange?.(e.target.value);
  });
  colorInput.addEventListener("click", (e) => e.stopPropagation());
  itemHeader.appendChild(colorInput);

  // Name (clickable to query)
  const nameSpan = document.createElement("span");
  nameSpan.className = "awg-schema-name";
  nameSpan.textContent = name;
  nameSpan.addEventListener("click", (e) => {
    e.stopPropagation();
    onQuery();
  });
  itemHeader.appendChild(nameSpan);

  // Count badge
  const countSpan = document.createElement("span");
  countSpan.className = "awg-filter-count";
  countSpan.textContent = count;
  itemHeader.appendChild(countSpan);

  // Expand arrow (only if properties)
  if (properties && properties.length > 0) {
    const expandBtn = document.createElement("span");
    expandBtn.className = "awg-schema-expand";
    expandBtn.innerHTML = ICONS.chevronRight;
    itemHeader.appendChild(expandBtn);
  }

  item.appendChild(itemHeader);

  // Properties list (collapsed)
  if (properties && properties.length > 0) {
    const propsList = document.createElement("div");
    propsList.className = "awg-schema-props";

    properties.forEach((prop) => {
      const propItem = document.createElement("div");
      propItem.className = "awg-schema-prop";
      propItem.innerHTML = `${ICONS.property} <span>${prop}</span>`;
      propsList.appendChild(propItem);
    });

    item.appendChild(propsList);

    // Toggle expand on header click (but not on checkbox/name)
    itemHeader.addEventListener("click", () => {
      item.classList.toggle("awg-schema-item-expanded");
    });
  }

  return item;
}

/**
 * Fire a query to fetch data for a specific type.
 */
function fireTypeQuery(name, kind, model, onExecuteQuery) {
  const lang = model.get("query_language") || "cypher";
  let query;

  if (lang === "gql") {
    query = kind === "node"
      ? `MATCH (n:${name}) RETURN n LIMIT 25`
      : `MATCH (a)-[r:${name}]->(b) RETURN a, r, b LIMIT 25`;
  } else if (lang === "cypher") {
    query = kind === "node"
      ? `MATCH (n:\`${name}\`) RETURN n LIMIT 25`
      : `MATCH (a)-[r:\`${name}\`]->(b) RETURN a, r, b LIMIT 25`;
  } else if (lang === "gremlin") {
    query = kind === "node"
      ? `g.V().hasLabel('${name}').limit(25)`
      : `g.E().hasLabel('${name}').limit(25)`;
  } else if (lang === "sparql") {
    query = kind === "node"
      ? `SELECT ?s ?p ?o WHERE { ?s a <${name}> ; ?p ?o } LIMIT 25`
      : `SELECT ?s ?o WHERE { ?s <${name}> ?o } LIMIT 25`;
  } else {
    query = kind === "node"
      ? `MATCH (n:\`${name}\`) RETURN n LIMIT 25`
      : `MATCH (a)-[r:\`${name}\`]->(b) RETURN a, r, b LIMIT 25`;
  }

  model.set("query", query);
  model.save_changes();
  onExecuteQuery();
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
    model.set("_execute_query", model.get("_execute_query") + 1);
    model.save_changes();
  }
}
