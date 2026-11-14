// What the canvas says when it has nothing to draw. Run with: node --test tests/js/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeModel } from "./helpers.ts";

const { canvasNote, EMPTY_NOTE, RUNNING_NOTE } = await import("../../src/anywidget_graph/ui/states.ts");

test("an empty widget says how to fill it", () => {
  assert.equal(canvasNote(fakeModel({ nodes: [], lanes: [] })), EMPTY_NOTE);
  assert.equal(EMPTY_NOTE, "Nothing to show yet. Run a query, or pass nodes and edges from Python.");
});

test("a running query says so, even over an old graph", () => {
  assert.equal(canvasNote(fakeModel({ nodes: [], query_running: true })), RUNNING_NOTE);
  assert.equal(canvasNote(fakeModel({ nodes: [{ id: 1 }], query_running: true })), RUNNING_NOTE);
  assert.equal(RUNNING_NOTE, "Running query\u2026");
});

test("no note over a graph, over lanes, or when the query banner already speaks", () => {
  assert.equal(canvasNote(fakeModel({ nodes: [{ id: 1 }] })), "");
  assert.equal(canvasNote(fakeModel({ nodes: [], lanes: [{ id: "a", action: true }] })), "");
  assert.equal(canvasNote(fakeModel({ nodes: [], query_error: "Syntax error" })), "");
  assert.equal(canvasNote(fakeModel({ nodes: [], query_note: "No rows" })), "");
});
