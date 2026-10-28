// The model view index.js renders through (defaults.js). Run with: node --test "tests/js/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";

import { TRAIT_DEFAULTS, withDefaults } from "../../src/anywidget_graph/ui/defaults.js";

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
