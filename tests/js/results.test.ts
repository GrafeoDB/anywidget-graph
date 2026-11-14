// The results table shows values as a reader would write them. Run with: node --test tests/js/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

const { cellText } = await import("../../src/anywidget_graph/ui/results.ts");

test("a list of plain values reads as a comma list, not JSON", () => {
  assert.equal(cellText(["Person"]), "Person");
  assert.equal(cellText(["Person", "Admin"]), "Person, Admin");
  assert.equal(cellText([1, 2.5, true]), "1, 2.5, true");
});

test("objects and nested lists stay JSON; missing values are empty; scalars as text", () => {
  assert.equal(cellText({ a: 1 }), '{"a":1}');
  assert.equal(cellText([["x"], 1]), '[["x"],1]');
  assert.equal(cellText(null), "");
  assert.equal(cellText(undefined), "");
  assert.equal(cellText(0.07), "0.07");
  assert.equal(cellText("Person 3"), "Person 3");
});
