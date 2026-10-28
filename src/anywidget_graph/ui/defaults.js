// The widget's settings as a fresh Python Graph() has them. A host without Python (an app's own model) may leave
// settings out; they then read as these. tests/test_ui.py keeps this equal to the Python trait defaults.
export const TRAIT_DEFAULTS = {
  "_demo_data": "",
  "_demo_mode": false,
  "_execute_query": 0,
  "_expand_request": {},
  "_features": [],
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
  "grafeo_connection_mode": "embedded",
  "grafeo_server_url": "http://localhost:7474",
  "height": 600,
  "highlight_neighbors": false,
  "hovered_edge": null,
  "hovered_node": null,
  "lane_action": {},
  "lanes": [],
  "layout": "spring",
  "max_nodes": 300,
  "nodes": [],
  "pinned_nodes": {},
  "pulse_nodes": [],
  "query": "",
  "query_error": "",
  "query_language": "cypher",
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
  };
}
