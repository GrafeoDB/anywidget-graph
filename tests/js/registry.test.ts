// The categorical colour registry (registry.ts): the 8 largest categories get the data colours, the rest are
// Other, and a category keeps its colour for the widget's life. Shared, byte for byte, with anywidget-vector.
// Run with: node --test tests/js/*.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { CategoryRegistry, countBy, mixOver } from "../../src/anywidget_graph/ui/registry.ts";
import type { Palette } from "../../src/anywidget_graph/ui/registry.ts";

const LIGHT: Palette = { data: ["#l1", "#l2", "#l3", "#l4", "#l5", "#l6", "#l7", "#l8"], other: "#lo", background: "#ffffff", edge: "#le" };
const DARK: Palette = { data: ["#d1", "#d2", "#d3", "#d4", "#d5", "#d6", "#d7", "#d8"], other: "#do", background: "#000000", edge: "#de" };

const counts = (entries: Record<string, number>) => new Map(Object.entries(entries));

test("the 8 largest categories by count get the slots, ties by name, the rest are Other", () => {
  const r = new CategoryRegistry();
  r.assign(counts({ a: 1, b: 9, c: 9, d: 5, e: 4, f: 3, g: 2, h: 2, i: 1, j: 7 }));
  const slots = Object.fromEntries(["b", "c", "j", "d", "e", "f", "g", "h", "a", "i"].map((k) => [k, r.slot(k)]));
  assert.deepEqual(slots, { b: 0, c: 1, j: 2, d: 3, e: 4, f: 5, g: 6, h: 7, a: null, i: null });
  assert.equal(r.colorFor("a", LIGHT), LIGHT.other);
  assert.equal(r.colorFor("b", LIGHT), LIGHT.data[0]);
});

test("assignments stick across a second batch", () => {
  const r = new CategoryRegistry();
  r.assign(counts({ a: 1, b: 9, c: 9, d: 5, e: 4, f: 3, g: 2, h: 2, i: 1, j: 7 }));
  r.assign(counts({ k: 100 }));
  assert.equal(r.slot("b"), 0);
  assert.equal(r.slot("h"), 7);
  assert.equal(r.slot("k"), null);
});

test("a freed slot is not reused", () => {
  const r = new CategoryRegistry();
  r.assign(counts({ x: 5 }));
  r.assign(counts({ y: 9 }));
  assert.equal(r.slot("x"), 0);
  assert.equal(r.slot("y"), 1);
});

test("free slots go to the largest new categories", () => {
  const r = new CategoryRegistry();
  r.assign(counts({ a: 3, b: 2 }));
  r.assign(counts({ c: 1, d: 9, e: 4 }));
  assert.deepEqual([r.slot("a"), r.slot("b"), r.slot("d"), r.slot("e"), r.slot("c")], [0, 1, 2, 3, 4]);
});

test("colorFor keeps the slot across themes", () => {
  const r = new CategoryRegistry();
  r.assign(counts({ b: 2, a: 1 }));
  assert.equal(r.colorFor("b", LIGHT), LIGHT.data[0]);
  assert.equal(r.colorFor("b", DARK), DARK.data[0]);
  assert.equal(r.colorFor("unseen", DARK), DARK.other);
});

test("mixOver composites a colour onto a background, opaque", () => {
  assert.equal(mixOver("#5c93d9", "#ffffff", 0.38), "#c1d6f1");
  assert.equal(mixOver("#5c93d9", "#ffffff", 1), "#5c93d9");
  assert.equal(mixOver("#5c93d9", "#ffffff", 0), "#ffffff");
});

test("countBy counts by key and skips missing keys", () => {
  const items = [{ t: "a" }, { t: "b" }, { t: "a" }, { t: undefined }];
  assert.deepEqual([...countBy(items, (i) => i.t)], [["a", 2], ["b", 1]]);
});

test("mixOver reads every colour form a host may pass, and never yields NaN", () => {
  // rgb() from a numeric colour scale, 3-digit hex, rgba(); 38% over white
  assert.equal(mixOver("rgb(33, 145, 141)", "#ffffff", 0.38), "#abd5d4");
  assert.equal(mixOver("#f00", "#ffffff", 0.38), "#ff9e9e");
  assert.equal(mixOver("rgba(255, 0, 0, 0.5)", "#000000", 0.5), "#800000");
  // A colour it cannot read (a CSS name outside a browser) comes back as it is: a solid fill, never "#NaN..."
  assert.equal(mixOver("red", "#ffffff", 0.38).includes("NaN"), false);
  assert.equal(mixOver("hsl(10 50% 50%)", "#ffffff", 0.38).includes("NaN"), false);
});

test("mixOver reads rgb() in its comma or its space form, never a mix, and leaves a malformed one as it is", () => {
  assert.equal(mixOver("rgb(33 145 141)", "#ffffff", 0.38), "#abd5d4");
  assert.equal(mixOver("rgb(255 0 0 / 0.5)", "#000000", 0.5), "#800000");
  assert.equal(mixOver("RGB(33,145,141)", "#ffffff", 0.38), "#abd5d4");
  for (const malformed of ["rgb(1,,2,3)", "rgb(1, 2 3)", "rgb(1 2 3, 0.5)", "rgb(1, 2, 3 / 0.5)", "rgb(,1,2,3)", "rgb(1, 2, 3"]) {
    assert.equal(mixOver(malformed, "#ffffff", 0.38), malformed, malformed);
  }
});

test("in a browser, a colour the canvas cannot read comes back as it is instead of as black", () => {
  // A stand-in canvas that, like a browser's, ignores a colour it cannot read and keeps the one before
  const known: Record<string, string> = { "#000000": "#000000", "#ffffff": "#ffffff", teal: "#008080" };
  const ctx = { value: "#000000", get fillStyle() { return this.value; }, set fillStyle(v: string) { if (v in known) this.value = known[v]; } };
  const g = globalThis as { document?: unknown };
  g.document = { createElement: () => ({ getContext: () => ctx }) };
  try {
    assert.equal(mixOver("teal", "#ffffff", 0.38), mixOver("#008080", "#ffffff", 0.38));
    assert.equal(mixOver("no-such-colour", "#ffffff", 0.38), "no-such-colour");
  } finally {
    delete g.document;
  }
});
