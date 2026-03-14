/**
 * Results drawer component with collapsible lip toggle.
 */
import { ICONS } from "./icons.js";

/**
 * Create the results drawer (bottom panel with lip toggle).
 */
export function createResultsDrawer(model) {
  const drawer = document.createElement("div");
  drawer.className = "awg-results-drawer";

  // Lip (always visible, toggles the drawer)
  const lip = document.createElement("div");
  lip.className = "awg-results-lip";

  const lipIcon = document.createElement("span");
  lipIcon.className = "awg-results-lip-icon";
  lipIcon.innerHTML = ICONS.chevronUp;

  const lipLabel = document.createElement("span");
  lipLabel.className = "awg-results-lip-label";
  lipLabel.innerHTML = `${ICONS.table} Results`;

  const lipTiming = document.createElement("span");
  lipTiming.className = "awg-results-lip-timing";

  function updateLipTiming() {
    const ms = model.get("query_time") || 0;
    const nodes = model.get("nodes") || [];
    const edges = model.get("edges") || [];
    const parts = [];
    if (nodes.length > 0 || edges.length > 0) {
      parts.push(`${nodes.length}n / ${edges.length}e`);
    }
    if (ms > 0) {
      parts.push(ms < 1 ? "<1 ms" : `${ms.toFixed(1)} ms`);
    }
    lipTiming.textContent = parts.join(" \u00b7 ");
  }
  updateLipTiming();
  model.on("change:query_time", updateLipTiming);
  model.on("change:nodes", updateLipTiming);
  model.on("change:edges", updateLipTiming);

  lip.appendChild(lipLabel);
  lip.appendChild(lipTiming);
  lip.appendChild(lipIcon);

  // Body (collapsible)
  const body = document.createElement("div");
  body.className = "awg-results-body";

  // Tab bar
  const tabBar = document.createElement("div");
  tabBar.className = "awg-results-tabs";

  const nodesTab = document.createElement("button");
  nodesTab.className = "awg-results-tab awg-results-tab-active";
  nodesTab.textContent = "Nodes";

  const edgesTab = document.createElement("button");
  edgesTab.className = "awg-results-tab";
  edgesTab.textContent = "Edges";

  tabBar.appendChild(nodesTab);
  tabBar.appendChild(edgesTab);
  body.appendChild(tabBar);

  // Table container
  const tableContainer = document.createElement("div");
  tableContainer.className = "awg-results-table-wrap";
  body.appendChild(tableContainer);

  let activeTab = "nodes";

  function setActiveTab(tab) {
    activeTab = tab;
    nodesTab.classList.toggle("awg-results-tab-active", tab === "nodes");
    edgesTab.classList.toggle("awg-results-tab-active", tab === "edges");
    renderTable();
  }

  nodesTab.addEventListener("click", () => setActiveTab("nodes"));
  edgesTab.addEventListener("click", () => setActiveTab("edges"));

  function renderTable() {
    tableContainer.innerHTML = "";
    const items = model.get(activeTab === "nodes" ? "nodes" : "edges") || [];

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "awg-results-empty";
      empty.textContent = activeTab === "nodes" ? "No nodes" : "No edges";
      tableContainer.appendChild(empty);
      return;
    }

    // Collect all keys across items (skip internal rendering keys)
    const skipKeys = new Set(["x", "y", "size", "color"]);
    const keys = [];
    const seen = new Set();
    items.forEach((item) => {
      Object.keys(item).forEach((k) => {
        if (!seen.has(k) && !skipKeys.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      });
    });

    const table = document.createElement("table");
    table.className = "awg-results-table";

    // Header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    keys.forEach((k) => {
      const th = document.createElement("th");
      th.textContent = k;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body (limit to 100 rows for performance)
    const tbody = document.createElement("tbody");
    const limit = Math.min(items.length, 100);
    for (let i = 0; i < limit; i++) {
      const row = document.createElement("tr");
      keys.forEach((k) => {
        const td = document.createElement("td");
        const val = items[i][k];
        if (val === undefined || val === null) {
          td.textContent = "";
        } else if (typeof val === "object") {
          td.textContent = JSON.stringify(val);
        } else {
          td.textContent = String(val);
        }
        row.appendChild(td);
      });
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    tableContainer.appendChild(table);

    if (items.length > 100) {
      const more = document.createElement("div");
      more.className = "awg-results-empty";
      more.textContent = `Showing 100 of ${items.length} rows`;
      tableContainer.appendChild(more);
    }
  }

  model.on("change:nodes", () => { if (activeTab === "nodes") renderTable(); });
  model.on("change:edges", () => { if (activeTab === "edges") renderTable(); });
  renderTable();

  drawer.appendChild(lip);
  drawer.appendChild(body);

  let isOpen = false;

  function toggle() {
    isOpen = !isOpen;
    drawer.classList.toggle("awg-results-open", isOpen);
    lipIcon.style.transform = isOpen ? "" : "rotate(180deg)";
  }

  lip.addEventListener("click", toggle);

  // Start closed
  lipIcon.style.transform = "rotate(180deg)";

  return {
    element: drawer,
    open: () => { if (!isOpen) toggle(); },
    close: () => { if (isOpen) toggle(); },
    toggle,
    isOpen: () => isOpen,
  };
}
