// The model view index.js renders through (defaults.js). Run with: node --test "tests/js/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";

import { TRAIT_DEFAULTS, capQueryResult, detectDark, followHostTheme, queryResultNote, withDefaults } from "../../src/anywidget_graph/ui/defaults.js";

// A host model in the shape anywidget hands to render(): get/set/on/off/save_changes/send
function fakeHost(values = {}) {
  const handlers = new Map();
  return {
    get: (name) => values[name],
    set: (name, value) => { values[name] = value; },
    on: (name, callback) => handlers.set(name, [...(handlers.get(name) || []), callback]),
    off: (name, callback) => handlers.set(name, (handlers.get(name) || []).filter((c) => c !== callback)),
    save_changes() {},
    send() {},
    count: () => [...handlers.values()].reduce((n, list) => n + list.length, 0),
    fire: (name) => (handlers.get(name) || []).forEach((c) => c()),
  };
}

test("a setting the host leaves out reads as the widget default, a fresh copy for objects", () => {
  const model = withDefaults(fakeHost({ width: 640 }));
  assert.equal(model.get("width"), 640);
  assert.equal(model.get("height"), TRAIT_DEFAULTS.height);
  const colors = model.get("type_colors");
  colors.nodes = { A: "#000" };
  assert.deepEqual(model.get("type_colors"), TRAIT_DEFAULTS.type_colors);
  assert.equal(model.get("not_a_trait"), undefined);
});

test("offAll removes every listener a view added, so a re-render does not stack them", () => {
  const host = fakeHost();
  const other = () => {};
  host.on("change:nodes", other);

  let calls = 0;
  for (let view = 0; view < 3; view++) {
    const model = withDefaults(host);
    model.on("change:nodes", () => calls++);
    model.on("change:edges", () => calls++);
    host.fire("change:nodes");
    model.offAll();
  }
  assert.equal(calls, 3, "each view's listener ran once, while it was mounted");
  assert.equal(host.count(), 1, "only the listener added outside the views is left");
  host.fire("change:nodes");
  assert.equal(calls, 3);
});

// A model that fires change events while `set` runs, as Backbone (anywidget's model) does
function liveModel(values) {
  const handlers = new Map();
  return {
    get: (name) => values[name],
    set: (name, value) => {
      if (values[name] === value) return;
      values[name] = value;
      (handlers.get(`change:${name}`) || []).forEach((callback) => callback());
    },
    on: (name, callback) => handlers.set(name, [...(handlers.get(name) || []), callback]),
    save_changes() {},
    values,
  };
}

function mountTheme(values) {
  const page = { dark: true };
  const model = liveModel(values);
  const theme = followHostTheme(model, () => page.dark);
  model.on("change:dark_mode", theme.onChange);
  theme.sync();
  return { page, model, theme };
}

test("a dark_mode the host chose stays, whatever the page's theme does", () => {
  const { page, model, theme } = mountTheme({ dark_mode: false, _theme_explicit: true });
  assert.equal(model.values.dark_mode, false);
  for (const dark of [true, false, true]) {
    page.dark = dark;
    theme.sync();
    assert.equal(model.values.dark_mode, false);
  }
});

test("without a choice the widget follows every change of the page's theme, not just the first", () => {
  const { page, model, theme } = mountTheme({ dark_mode: true, _theme_explicit: false });
  for (const dark of [false, true, false]) {
    page.dark = dark;
    theme.sync();
    assert.equal(model.values.dark_mode, dark);
  }
  assert.equal(model.values._theme_explicit, false);
});

test("dark_mode set after render (Python, the settings switch) becomes a choice and the page is no longer followed", () => {
  const { page, model, theme } = mountTheme({ dark_mode: true, _theme_explicit: false });
  model.set("dark_mode", false);
  assert.equal(model.values._theme_explicit, true);
  page.dark = true;
  theme.sync();
  assert.equal(model.values.dark_mode, false);
});

test("a result without nodes or edges keeps the drawing and the note says why; a drawn result has no note", () => {
  const empty = { nodes: [], edges: [] };
  assert.equal(queryResultNote(0, empty), "The query returned no rows, so the drawing is unchanged.");
  assert.match(queryResultNote(1, empty), /^The query returned 1 row without nodes, edges or paths, so the drawing is unchanged/);
  assert.match(queryResultNote(3, empty), /^The query returned 3 rows /);
  assert.match(queryResultNote(undefined, empty), /nothing to draw/);
  assert.equal(queryResultNote(2, { nodes: [{ id: "a" }], edges: [] }), "");
});

// Just enough of the DOM for detectDark: parents, data-theme and classes
function element(theme, classes = [], parent = null, doc = null) {
  return { dataset: theme ? { theme } : {}, classList: { contains: (c) => classes.includes(c) }, parentElement: parent, ownerDocument: doc };
}
function page({ htmlTheme, htmlClasses = [], paneTheme, system = false } = {}) {
  const doc = {};
  doc.documentElement = element(htmlTheme, htmlClasses, null, doc);
  doc.body = element(undefined, [], doc.documentElement, doc);
  const pane = element(paneTheme, [], doc.body, doc);
  const widget = element(undefined, [], pane, doc);
  return { widget, matchMedia: () => ({ matches: system }) };
}

test("the nearest data-theme decides the theme, then the page's classes, then the system", () => {
  const dark = (options) => { const p = page(options); return detectDark(p.widget, p.matchMedia); };
  assert.equal(dark({ paneTheme: "light", system: true }), false, "a light pane on a dark system is light");
  assert.equal(dark({ paneTheme: "dark", htmlTheme: "light" }), true, "the pane wins over the page");
  assert.equal(dark({ paneTheme: "system", htmlTheme: "dark" }), true, "another value passes the question on");
  assert.equal(dark({ htmlClasses: ["dark-theme"] }), true);
  assert.equal(dark({ system: true }), true);
  assert.equal(dark({}), false);
});

test("a second view of the same widget does not take the first view's update for a choice", () => {
  const page = { dark: true };
  const host = liveModel({ dark_mode: true, _theme_explicit: false });
  // Each view gets its own proxy over the widget's model, as anywidget hands out (modelProxy)
  const views = [0, 1].map(() => {
    const view = { get: host.get, set: host.set, on: host.on, save_changes: host.save_changes };
    const theme = followHostTheme(view, () => page.dark);
    host.on("change:dark_mode", theme.onChange);
    return theme;
  });
  page.dark = false;
  views[0].sync();
  assert.equal(host.values.dark_mode, false);
  assert.equal(host.values._theme_explicit, false, "view 1 saw view 0's write and left it alone");
  page.dark = true;
  views[1].sync();
  assert.equal(host.values.dark_mode, true);
});

test("a second copy of the module (a cell run again) also sees the first copy's update as the page's", async () => {
  const copy = await import("../../src/anywidget_graph/ui/defaults.js?copy=2");
  const page = { dark: true };
  const host = liveModel({ dark_mode: true, _theme_explicit: false });
  const first = followHostTheme(host, () => page.dark);
  const second = copy.followHostTheme(host, () => page.dark);
  host.on("change:dark_mode", first.onChange);
  host.on("change:dark_mode", second.onChange);
  page.dark = false;
  first.sync();
  assert.equal(host.values._theme_explicit, false);
});

test("max_query_nodes cuts a large result to its best-connected nodes and says so; off by default", () => {
  // A star around hub with two loose nodes
  const nodes = ["loose1", "a", "hub", "b", "loose2", "c"].map((id) => ({ id }));
  const edges = ["a", "b", "c"].map((leaf) => ({ source: "hub", target: leaf }));
  const graph = { nodes, edges, rows: 6 };
  assert.deepEqual(capQueryResult(graph, null), { graph, note: "" });
  assert.deepEqual(capQueryResult(graph, 0), { graph, note: "" });
  assert.deepEqual(capQueryResult(graph, 6), { graph, note: "" });
  const { graph: cut, note } = capQueryResult(graph, 3);
  assert.deepEqual(cut.nodes.map((n) => n.id), ["a", "hub", "b"], "hub first by links, then a and b in result order");
  assert.deepEqual(cut.edges, [edges[0], edges[1]], "only edges between kept nodes");
  assert.equal(note, "The query returned 6 nodes; the 3 best connected are drawn (max_query_nodes).");
});
