/**
 * Filter + Schema sidebar component.
 * Shows node/edge types from current graph data with toggle checkboxes.
 * Clicking a type name still fires the query (schema browse behavior).
 */
import { panelControls, setPanelOpen } from "./panel.ts";
import { DARK, LIGHT } from "./palette.ts";
import type { Palette } from "./registry.ts";
import { Registries, assignNodeTypes, nodeTypeOf } from "./styling.ts";
import { ICONS } from "./icons.ts";
import { fetchSchema as neo4jFetchSchema } from "./neo4j.ts";
import { fetchSchema as grafeoFetchSchema } from "./grafeo.ts";
import { fetchSchema as grafeoEmbedFetchSchema } from "./grafeo-embed.ts";
import { withTotals, shownOf, nodeType, edgeType, UNLABELED } from "./lanes.ts";
import type { GraphEdge, GraphNode, Panel, WidgetModel } from "./types.ts";

// Types a filter section shows before "Show more"
export const FILTER_PAGE = 50;


/**
 * Extract node types and edge types from current graph data, with the host's totals ({nodes: {type: n},
 * edges: {type: n}}) when it gives them: "shown / total", and a type the data lacks as 0.
 */
function extractTypesFromData(model: WidgetModel): {
  nodeTypes: { label: string; count: number; total?: number }[];
  edgeTypes: { type: string; count: number; total?: number }[];
} {
  const nodes = (model.get("nodes") ?? []) as GraphNode[];
  const edges = (model.get("edges") ?? []) as GraphEdge[];

  // Node types: group by first label, or "Unlabeled"
  const nodeTypeMap = new Map<string, number>();
  nodes.forEach((node) => {
    const typeKey = nodeType(node);
    if (!nodeTypeMap.has(typeKey)) nodeTypeMap.set(typeKey, 0);
    nodeTypeMap.set(typeKey, (nodeTypeMap.get(typeKey) ?? 0) + 1);
  });

  // Edge types: group by label/type
  const edgeTypeMap = new Map<string, number>();
  edges.forEach((edge) => {
    const typeKey = edgeType(edge);
    if (!edgeTypeMap.has(typeKey)) edgeTypeMap.set(typeKey, 0);
    edgeTypeMap.set(typeKey, (edgeTypeMap.get(typeKey) ?? 0) + 1);
  });

  const totals = (model.get("totals") ?? {}) as { nodes?: Record<string, number>; edges?: Record<string, number> };
  return {
    nodeTypes: withTotals(nodeTypeMap, totals.nodes).map(({ name, count, total }: any) => ({ label: name, count, total })),
    edgeTypes: withTotals(edgeTypeMap, totals.edges).map(({ name, count, total }: any) => ({ type: name, count, total })),
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
export function createSchemaPanel(
  model: WidgetModel,
  onExecuteQuery: () => void,
  callbacks: { onClose?: () => void } | null | undefined,
  onFilterChange?: (hiddenNodes: Set<string>, hiddenEdges: Set<string>) => void,
  onColorChange?: (colors: Map<string, string>) => void,
  onRefreshLayout?: () => void,
  // The widget's colour assignments and palette, so a swatch shows the colour the view draws
  colors: { registries: Registries; palette: () => Palette } = {
    registries: new Registries(),
    palette: () => (model.get("dark_mode") ? DARK : LIGHT),
  },
): Panel {
  const panel = document.createElement("div");
  panel.className = "awg-schema-panel";

  // Filter state
  const hiddenNodeTypes = new Set<string>();
  // Sections show their first FILTER_PAGE types; "Show more" lifts the cap for that section from then on
  const showAllTypes: Record<"node" | "edge", boolean> = { node: false, edge: false };
  const hiddenEdgeTypes = new Set<string>();

  // Custom color overrides per type
  const typeColorMap = new Map<string, string>();

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
  refreshBtn.title = "Refresh layout";
  refreshBtn.addEventListener("click", () => {
    refreshSchema(model);
    onRefreshLayout?.();
  });
  headerBtns.appendChild(refreshBtn);

  const closeBtn = document.createElement("button");
  closeBtn.className = "awg-btn awg-btn-icon awg-btn-sm";
  closeBtn.innerHTML = ICONS.close;
  closeBtn.title = "Close panel";
  closeBtn.addEventListener("click", () => {
    setPanelOpen(panel, false);
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

  // A large schema draws its first FILTER_PAGE types per section, so the panel stays quick to build and scroll
  function pageOf<T>(types: T[], kind: "node" | "edge"): T[] {
    return showAllTypes[kind] ? types : types.slice(0, FILTER_PAGE);
  }

  function appendShowMore(section: HTMLElement, total: number, kind: "node" | "edge"): void {
    if (showAllTypes[kind] || total <= FILTER_PAGE) return;
    const more = document.createElement("button");
    more.className = "awg-filter-more";
    more.textContent = `Show ${total - FILTER_PAGE} more`;
    more.addEventListener("click", () => {
      showAllTypes[kind] = true;
      renderFilters();
    });
    section.appendChild(more);
  }

  function renderFilters() {
    content.innerHTML = "";

    const { nodeTypes, edgeTypes } = extractTypesFromData(model);
    // The drawn nodes take their colour slots first (as on the canvas); a type known only from the counts follows
    const drawnNodes = (model.get("nodes") ?? []) as GraphNode[];
    assignNodeTypes(colors.registries, drawnNodes);
    // Nodes without a type are drawn as Other (the first colour when no node has a type), so their "Unlabeled" group
    // takes no slot of its own and its swatch shows that colour
    const untyped = drawnNodes.some((node) => nodeTypeOf(node) === undefined);
    const isUntyped = (label: string) => untyped && label === UNLABELED;
    const untypedColor = () => (drawnNodes.some((node) => nodeTypeOf(node) !== undefined) ? colors.palette().other : colors.palette().data[0]);
    colors.registries.for("node-type").assign(new Map(nodeTypes.filter(({ label }) => !isUntyped(label)).map(({ label, count }) => [label, count])));
    const schemaNodeTypes = (model.get("schema_node_types") ?? []) as { label: string; properties?: string[] }[];
    const schemaEdgeTypes = (model.get("schema_edge_types") ?? []) as { type: string; properties?: string[] }[];

    // Build a property lookup from schema data
    const nodePropsMap = new Map<string, string[]>();
    schemaNodeTypes.forEach(({ label, properties }: { label: string; properties?: string[] }) => {
      nodePropsMap.set(label, properties || []);
    });
    const edgePropsMap = new Map<string, string[]>();
    schemaEdgeTypes.forEach(({ type, properties }: { type: string; properties?: string[] }) => {
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
        allLink.addEventListener("click", (e: MouseEvent) => {
          e.preventDefault();
          nodeTypes.forEach(({ label }) => hiddenNodeTypes.delete(label));
          emitFilterChange();
          renderFilters();
        });
        const noneLink = document.createElement("a");
        noneLink.textContent = "none";
        noneLink.href = "#";
        noneLink.addEventListener("click", (e: MouseEvent) => {
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

      pageOf(nodeTypes, "node").forEach(({ label, count, total }) => {
        const props = nodePropsMap.get(label) || [];
        const item = createFilterItem({
          name: label,
          count,
          total,
          color: typeColorMap.get(label) || (model.get("type_colors")?.nodes || {})[label] || (isUntyped(label) ? untypedColor() : colors.registries.for("node-type").colorFor(label, colors.palette())),
          kind: "node",
          properties: props,
          isHidden: hiddenNodeTypes.has(label),
          onToggle: (visible: boolean) => {
            if (visible) hiddenNodeTypes.delete(label);
            else hiddenNodeTypes.add(label);
            emitFilterChange();
          },
          onColorChange: (newColor: string) => {
            typeColorMap.set(label, newColor);
            emitColorChange();
          },
          onQuery: () => fireTypeQuery(label, "node", model, onExecuteQuery),
        });
        section.appendChild(item);
      });
      appendShowMore(section, nodeTypes.length, "node");

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
        allLink.addEventListener("click", (e: MouseEvent) => {
          e.preventDefault();
          edgeTypes.forEach(({ type }) => hiddenEdgeTypes.delete(type));
          emitFilterChange();
          renderFilters();
        });
        const noneLink = document.createElement("a");
        noneLink.textContent = "none";
        noneLink.href = "#";
        noneLink.addEventListener("click", (e: MouseEvent) => {
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

      pageOf(edgeTypes, "edge").forEach(({ type, count, total }) => {
        const props = edgePropsMap.get(type) || [];
        const item = createFilterItem({
          name: type,
          count,
          total,
          color: typeColorMap.get(type) || (model.get("type_colors")?.edges || {})[type] || colors.palette().edge,
          kind: "edge",
          properties: props,
          isHidden: hiddenEdgeTypes.has(type),
          onToggle: (visible: boolean) => {
            if (visible) hiddenEdgeTypes.delete(type);
            else hiddenEdgeTypes.add(type);
            emitFilterChange();
          },
          onColorChange: (newColor: string) => {
            typeColorMap.set(type, newColor);
            emitColorChange();
          },
          onQuery: () => fireTypeQuery(type, "edge", model, onExecuteQuery),
        });
        section.appendChild(item);
      });
      appendShowMore(section, edgeTypes.length, "edge");

      content.appendChild(section);
    }
  }

  model.on("change:nodes", renderFilters);
  model.on("change:edges", renderFilters);
  model.on("change:schema_node_types", renderFilters);
  model.on("change:schema_edge_types", renderFilters);
  model.on("change:totals", renderFilters);
  model.on("change:type_colors", renderFilters);
  // Each theme has its own data colours: the swatches follow the switch, as the canvas does
  model.on("change:dark_mode", renderFilters);
  renderFilters();

  panel.appendChild(content);

  return panelControls(panel);
}

/**
 * Create a single filter item with checkbox, color swatch, name, and count.
 */
export function createFilterItem({ name, count, total, color, properties, isHidden, onToggle, onColorChange, onQuery }: {
  name: string;
  count: number;
  total?: number;
  color: string;
  kind: "node" | "edge";
  properties?: string[];
  isHidden: boolean;
  onToggle: (visible: boolean) => void;
  onColorChange?: (color: string) => void;
  onQuery: () => void;
}): HTMLDivElement {
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
  checkbox.addEventListener("click", (e: MouseEvent) => {
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
    onColorChange?.((e.target as HTMLInputElement).value);
  });
  colorInput.addEventListener("click", (e) => e.stopPropagation());
  itemHeader.appendChild(colorInput);

  // Name: a button (styled as text) that queries this type, so Tab and Enter reach it too
  const nameSpan = document.createElement("button");
  nameSpan.type = "button";
  nameSpan.className = "awg-schema-name";
  nameSpan.textContent = name;
  nameSpan.title = `Query ${name}`;
  nameSpan.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();
    onQuery();
  });
  itemHeader.appendChild(nameSpan);

  // Count badge
  const countSpan = document.createElement("span");
  countSpan.className = "awg-filter-count";
  countSpan.textContent = shownOf(count, total);
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

    properties.forEach((prop: string) => {
      const propItem = document.createElement("div");
      propItem.className = "awg-schema-prop";
      propItem.innerHTML = `${ICONS.property} `;
      const propName = document.createElement("span");
      propName.textContent = prop;
      propItem.appendChild(propName);
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
function fireTypeQuery(name: string, kind: "node" | "edge", model: WidgetModel, onExecuteQuery: () => void): void {
  const lang = model.get("query_language") || "cypher";
  let query: string;

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
function refreshSchema(model: WidgetModel): void {
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
