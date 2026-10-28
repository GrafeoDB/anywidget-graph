// The widget's settings as a fresh Python Graph() has them. A host without Python (an app's own model) may leave
// settings out; they then read as these. tests/test_ui.py keeps this equal to the Python trait defaults.
export const TRAIT_DEFAULTS = {
  "_demo_data": "",
  "_demo_mode": false,
  "_execute_query": 0,
  "_expand_request": {},
  "_features": [],
  "_theme_explicit": false,
  "append_animation": "draw",
  "append_batch": {},
  "append_stagger_ms": 60,
  "background": "#fafafa",
  "color_domain": null,
  "color_field": null,
  "color_scale": "viridis",
  "connection_database": "default",
  "connection_password": "",
  "connection_status": "disconnected",
  "connection_uri": "",
  "connection_username": "",
  "current_level": 0,
  "dark_mode": true,
  "database_backend": "grafeo",
  "edge_arrows": false,
  "edge_color_field": null,
  "edge_color_scale": "viridis",
  "edge_size_field": null,
  "edge_size_range": [
    1,
    8
  ],
  "edges": [],
  "fill": false,
  "filtered_style": "dim",
  "grafeo_connection_mode": "embedded",
  "grafeo_server_url": "http://localhost:7474",
  "height": 600,
  "highlight_neighbors": false,
  "hovered_edge": null,
  "hovered_node": null,
  "lane_action": {},
  "lanes": [],
  "layout": "spring",
  "level_field": "level",
  "levels": [],
  "max_nodes": 300,
  "max_query_nodes": null,
  "nodes": [],
  "pinned_nodes": {},
  "pulse_nodes": [],
  "query": "",
  "query_error": "",
  "query_language": "cypher",
  "query_note": "",
  "query_running": false,
  "query_time": 0.0,
  "schema_edge_types": [],
  "schema_node_types": [],
  "selected_edge": null,
  "selected_edges": [],
  "selected_node": null,
  "selected_nodes": [],
  "selection_mode": "click",
  "show_edge_labels": false,
  "show_labels": true,
  "show_query_input": true,
  "show_settings": true,
  "show_toolbar": true,
  "show_tooltip": true,
  "size_field": null,
  "size_range": [
    5,
    30
  ],
  "theme": {},
  "tooltip_fields": [
    "label",
    "id"
  ],
  "totals": {},
  "type_colors": {},
  "width": 800
};

/**
 * The host's model, where a setting the host left out (an app without Python) reads as the widget's default.
 * It remembers the listeners added through it, so `offAll()` removes this view's listeners and no other.
 */
export function withDefaults(host) {
  const listeners = [];
  return {
    get: (name) => {
      const value = host.get(name);
      if (value !== undefined || !(name in TRAIT_DEFAULTS)) return value;
      const fallback = TRAIT_DEFAULTS[name];
      return fallback !== null && typeof fallback === "object" ? structuredClone(fallback) : fallback;
    },
    set: (...args) => host.set(...args),
    on: (name, callback) => {
      listeners.push([name, callback]);
      host.on(name, callback);
    },
    off: (...args) => host.off(...args),
    offAll: () => {
      for (const [name, callback] of listeners.splice(0)) host.off(name, callback);
    },
    save_changes: (...args) => host.save_changes(...args),
    send: (...args) => host.send(...args),
    // The widget behind this view: state shared by all its views (a connection, the newest query) is kept per host
    host,
  };
}

/**
 * Whether the page around `el` is dark. The nearest ancestor with data-theme="dark" or "light" decides (a host's
 * pane can differ from its page); then a `dark` or `dark-theme` class or data-theme="dark" on <html> or <body>; then
 * the system setting. Other data-theme values ("system", "auto") pass the question on.
 */
export function detectDark(el, matchMedia = globalThis.matchMedia) {
  for (let node = el; node; node = node.parentElement) {
    const theme = node.dataset?.theme;
    if (theme === "dark") return true;
    if (theme === "light") return false;
  }
  const doc = el?.ownerDocument ?? globalThis.document;
  for (const node of [doc?.documentElement, doc?.body]) {
    if (node?.classList?.contains("dark") || node?.classList?.contains("dark-theme")) return true;
  }
  return Boolean(matchMedia?.("(prefers-color-scheme: dark)").matches);
}

// Theme writes running now, counted on the page (the key anywidget-archimate and anywidget-vector use too). A write
// is synchronous and model.set fires every view's listeners inside it, so a change seen while the count is above 0
// is a widget following the page, not a choice: whatever model object (anywidget hands each view a proxy) or copy
// of this module (a cell run again) the view has
const THEME_WRITES = Symbol.for("anywidget.theme-writes");

/**
 * Following the page's light or dark theme, the same way anywidget-archimate and anywidget-vector do.
 *
 * Until dark_mode is a choice (`_theme_explicit`), `sync()` sets it to the page's theme: call it on render and
 * whenever the page's theme may have changed. Any other change of dark_mode is a choice (Python after display, the
 * settings switch): `onChange`, listening to change:dark_mode, stores that in `_theme_explicit`, so this view and
 * later ones keep it. The model fires change events while `set` runs, which is how onChange tells the two apart
 * (THEME_WRITES, counted on the page).
 */
export function followHostTheme(model, detectDark) {
  function sync() {
    if (model.get("_theme_explicit")) return;
    const dark = detectDark();
    if (model.get("dark_mode") === dark) return;
    globalThis[THEME_WRITES] = (globalThis[THEME_WRITES] ?? 0) + 1;
    try {
      model.set("dark_mode", dark);
      model.save_changes();
    } finally {
      globalThis[THEME_WRITES] -= 1;
    }
  }
  function onChange() {
    if ((globalThis[THEME_WRITES] ?? 0) > 0 || model.get("_theme_explicit")) return;
    model.set("_theme_explicit", true);
    model.save_changes();
  }
  return { sync, onChange };
}

/**
 * What a finished query tells the viewer besides its result (query_note). A result without nodes or edges leaves the
 * drawing as it is (a write, nothing matched, or rows of plain values), and the note says why; "" when the result is
 * drawn. `rowCount` is undefined when the backend does not report it.
 */
export function queryResultNote(rowCount, graph) {
  if (graph.nodes.length > 0 || graph.edges.length > 0) return "";
  if (rowCount === 0) return "The query returned no rows, so the drawing is unchanged.";
  if (!rowCount) return "The query returned nothing to draw, so the drawing is unchanged.";
  const what = rowCount === 1 ? "1 row" : `${rowCount} rows`;
  return `The query returned ${what} without nodes, edges or paths, so the drawing is unchanged. Return graph elements (for example RETURN n, r, m) to draw them.`;
}

/**
 * A query result cut to `max` nodes (max_query_nodes; null or 0 draws every node): the best-connected nodes of the
 * result (most edges within it, ties in result order), with the edges between them. Returns the graph to draw and the
 * note to show (query_note), "" when nothing was cut. Mirrors _cap_query_result in widget.py.
 */
export function capQueryResult(graph, max) {
  const total = graph.nodes.length;
  if (!(max > 0) || total <= max) return { graph, note: "" };
  const degree = new Map(graph.nodes.map((node) => [String(node.id), 0]));
  for (const edge of graph.edges) {
    for (const end of [String(edge.source), String(edge.target)]) {
      if (degree.has(end)) degree.set(end, degree.get(end) + 1);
    }
  }
  const ranked = graph.nodes.map((node, index) => ({ index, links: degree.get(String(node.id)) }));
  ranked.sort((a, b) => b.links - a.links || a.index - b.index);
  const chosen = new Set(ranked.slice(0, max).map((entry) => entry.index));
  const nodes = graph.nodes.filter((_, index) => chosen.has(index));
  const kept = new Set(nodes.map((node) => String(node.id)));
  const edges = graph.edges.filter((edge) => kept.has(String(edge.source)) && kept.has(String(edge.target)));
  const note = `The query returned ${total.toLocaleString("en-US")} nodes; the ${max.toLocaleString("en-US")} best connected are drawn (max_query_nodes).`;
  return { graph: { ...graph, nodes, edges }, note };
}
