/**
 * Toolbar component with query input and action buttons.
 */
import { ICONS } from "./icons.ts";
import { updateStatusDot } from "./settings.ts";
import { shownOf, totalShown, nodeType, edgeType } from "./lanes.ts";
import type { GraphEdge, GraphNode, Panel, WidgetModel } from "./types.ts";

/**
 * Create the toolbar component.
 * @param {object} panels - { schema, settings, properties } panel objects with toggle/close/isOpen
 * @param {function} onSearch - callback(term) for search filtering
 */
export function createToolbar(
  model: WidgetModel,
  onExecuteQuery: () => void,
  panels: { schema?: Panel; settings?: Panel | null; properties?: Panel },
  onSearch?: (term: string) => void,
): HTMLDivElement {
  const toolbar = document.createElement("div");
  toolbar.className = "awg-toolbar";

  // Schema sidebar toggle (left)
  const schemaBtn = document.createElement("button");
  schemaBtn.className = "awg-btn";
  schemaBtn.innerHTML = ICONS.sidebar;
  schemaBtn.title = "Toggle schema browser";
  schemaBtn.addEventListener("click", () => {
    panels.schema?.toggle();
  });
  toolbar.appendChild(schemaBtn);

  // Query container (collapsible input)
  if (model.get("show_query_input")) {
    const queryContainer = document.createElement("div");
    queryContainer.className = "awg-query-container";

    const queryInput = document.createElement("input");
    queryInput.type = "text";
    queryInput.className = "awg-query-input";
    queryInput.placeholder = "Enter query (e.g., MATCH (n) RETURN n LIMIT 25)";
    queryInput.value = model.get("query") || "";

    queryInput.addEventListener("input", (e: Event) => {
      model.set("query", (e.target as HTMLInputElement).value);
      model.save_changes();
    });

    queryInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onExecuteQuery();
      }
    });

    model.on("change:query", () => {
      if (queryInput.value !== model.get("query")) {
        queryInput.value = model.get("query") || "";
      }
    });

    queryContainer.appendChild(queryInput);

    // A failed query says why under the toolbar (its full width, so a narrow pane cannot clip it), without opening the
    // settings panel, which shows errors too; a note (query_note: nothing to draw, a cut at max_nodes) shows there in
    // a quieter style when there is no error
    const queryError = document.createElement("div");
    queryError.className = "awg-query-error";
    const queryErrorText = document.createElement("span");
    const queryErrorClose = document.createElement("button");
    queryErrorClose.className = "awg-btn awg-btn-icon awg-btn-sm";
    queryErrorClose.innerHTML = ICONS.close;
    queryErrorClose.title = "Dismiss";
    queryErrorClose.addEventListener("click", () => { queryError.style.display = "none"; });
    queryError.append(queryErrorText, queryErrorClose);
    function updateQueryError() {
      const err = model.get("query_error");
      const message = err || model.get("query_note");
      queryErrorText.textContent = message || "";
      queryError.style.display = message ? "flex" : "none";
      queryError.classList.toggle("awg-query-note", !err && Boolean(message));
      queryError.setAttribute("role", err ? "alert" : "status");
      queryInput.classList.toggle("awg-query-input-error", Boolean(err));
    }
    model.on("change:query_error", updateQueryError);
    model.on("change:query_note", updateQueryError);
    updateQueryError();
    toolbar.appendChild(queryError);

    // Play button
    const playBtn = document.createElement("button");
    playBtn.className = "awg-btn awg-btn-primary";
    playBtn.innerHTML = ICONS.play;
    playBtn.title = "Run query";
    playBtn.addEventListener("click", () => onExecuteQuery());

    // While a query runs the button shows a spinner (there is no cancel); also when the widget opens mid-query
    const showRunning = () => {
      playBtn.disabled = Boolean(model.get("query_running"));
      playBtn.innerHTML = model.get("query_running") ? '<span class="awg-spinner"></span>' : ICONS.play;
    };
    model.on("change:query_running", showRunning);
    showRunning();

    queryContainer.appendChild(playBtn);
    toolbar.appendChild(queryContainer);
  }

  // Search input (compact filter for nodes)
  const searchWrap = document.createElement("div");
  searchWrap.className = "awg-search-wrap";
  const searchIcon = document.createElement("span");
  searchIcon.className = "awg-search-icon";
  searchIcon.innerHTML = ICONS.search;
  searchWrap.appendChild(searchIcon);

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "awg-search-input";
  searchInput.placeholder = "Filter nodes...";
  // A narrow widget shows only the icon (styles.css), so the field keeps its name for screen readers
  searchInput.setAttribute("aria-label", "Filter nodes");
  searchInput.addEventListener("input", () => {
    onSearch?.(searchInput.value);
  });
  searchWrap.appendChild(searchInput);
  toolbar.appendChild(searchWrap);

  // Count badge
  const countBadge = document.createElement("span");
  countBadge.className = "awg-count-badge";
  // "300 / 30,000 nodes" when the host gives totals (it may hold far more than it sends)
  function updateCount() {
    const nodes = (model.get("nodes") ?? []) as GraphNode[];
    const edges = (model.get("edges") ?? []) as GraphEdge[];
    const totals = (model.get("totals") ?? {}) as { nodes?: Record<string, number>; edges?: Record<string, number> };
    const shownNodes = shownOf(nodes.length, totalShown(nodes, nodeType, totals.nodes));
    countBadge.textContent = `${shownNodes} nodes \u00b7 ${shownOf(edges.length, totalShown(edges, edgeType, totals.edges))} edges`;
  }
  updateCount();
  model.on("change:nodes", updateCount);
  model.on("change:edges", updateCount);
  model.on("change:totals", updateCount);
  toolbar.appendChild(countBadge);

  // Query timing badge
  const timingBadge = document.createElement("span");
  timingBadge.className = "awg-count-badge awg-timing-badge";
  function updateTiming() {
    const ms = model.get("query_time") || 0;
    if (ms > 0) {
      timingBadge.textContent = ms < 1 ? "<1 ms" : `${ms.toFixed(1)} ms`;
      timingBadge.style.display = "";
    } else {
      timingBadge.style.display = "none";
    }
  }
  updateTiming();
  model.on("change:query_time", updateTiming);
  toolbar.appendChild(timingBadge);

  // 2D/3D view toggle: switches the model's `view` trait; index.ts's render re-mounts the matching view
  const viewBtn = document.createElement("button");
  viewBtn.className = "awg-btn awg-view-btn";
  viewBtn.innerHTML = ICONS.cube;
  viewBtn.title = "Toggle 3D view";
  function updateViewBtn() {
    const is3d = (model.get("view") || "2d") === "3d";
    viewBtn.classList.toggle("awg-view-active", is3d);
    viewBtn.setAttribute("aria-pressed", String(is3d));
    viewBtn.title = is3d ? "Switch to 2D view" : "Switch to 3D view";
  }
  viewBtn.addEventListener("click", () => {
    model.set("view", (model.get("view") || "2d") === "3d" ? "2d" : "3d");
    model.save_changes();
  });
  model.on("change:view", updateViewBtn);
  updateViewBtn();
  // show_view_toggle false: a host with a fixed view keeps the switch out
  if (model.get("show_view_toggle") !== false) toolbar.appendChild(viewBtn);

  // Settings button (mutual exclusion with properties)
  if (model.get("show_settings")) {
    const settingsBtn = document.createElement("button");
    settingsBtn.className = "awg-btn";
    settingsBtn.innerHTML = ICONS.settings;
    settingsBtn.title = "Connection settings";

    // Status dot
    const statusDot = document.createElement("span");
    statusDot.className = "awg-status-dot";
    updateStatusDot(statusDot, model.get("connection_status"));
    settingsBtn.appendChild(statusDot);

    model.on("change:connection_status", () => {
      updateStatusDot(statusDot, model.get("connection_status"));
    });

    settingsBtn.addEventListener("click", () => {
      // Mutual exclusion: close properties before toggling settings
      if (panels.properties?.isOpen()) {
        panels.properties.close();
      }
      panels.settings?.toggle();
    });

    toolbar.appendChild(settingsBtn);
  }

  // Properties panel toggle (right, mutual exclusion with settings)
  const propsBtn = document.createElement("button");
  propsBtn.className = "awg-btn";
  propsBtn.innerHTML = ICONS.property;
  propsBtn.title = "Toggle properties panel";
  propsBtn.addEventListener("click", () => {
    // Mutual exclusion: close settings before toggling properties
    if (panels.settings?.isOpen()) {
      panels.settings.close();
    }
    panels.properties?.toggle();
  });
  toolbar.appendChild(propsBtn);

  return toolbar;
}
