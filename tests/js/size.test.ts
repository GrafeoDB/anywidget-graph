// The widget's size: the shared rule (size.ts, byte for byte the same as anywidget-vector's), and both views use it
// unless the host asks for fill. Run with: node --test tests/js/*.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { wrapperSize, MIN_HEIGHT } from "../../src/anywidget_graph/ui/size.ts";
import { TRAIT_DEFAULTS } from "../../src/anywidget_graph/ui/defaults.ts";

const UI = new URL("../../src/anywidget_graph/ui/", import.meta.url);

test("no size given: fill the width, 16:10, between what the chrome needs and 80% of the screen", () => {
  assert.deepEqual(wrapperSize(0, 0), { width: "100%", aspectRatio: "16 / 10", minHeight: `${MIN_HEIGHT}px`, maxHeight: "80vh" });
  assert.deepEqual(wrapperSize(800, 600), { width: "800px", height: "600px" });
});

test("hosts without size traits get the rule too (0 = not given)", () => {
  assert.equal(TRAIT_DEFAULTS.width, 0);
  assert.equal(TRAIT_DEFAULTS.height, 0);
});

test("both views size the frame with the rule, and fill still wins", () => {
  for (const file of ["index.ts", "index3d.ts"]) {
    const source = readFileSync(new URL(file, UI), "utf8");
    assert.ok(source.includes("wrapperSize("), `${file} uses wrapperSize`);
    assert.ok(source.includes('model.get("fill")'), `${file} keeps fill`);
  }
});

test("size.ts is the same file as anywidget-vector's", { skip: (() => { try { readFileSync(new URL("../../../anywidget-vector/src/anywidget_vector/ui/size.ts", import.meta.url)); return false; } catch { return "anywidget-vector is not checked out next to this repo"; } })() }, () => {
  const ours = readFileSync(new URL("size.ts", UI), "utf8");
  const theirs = readFileSync(new URL("../../../anywidget-vector/src/anywidget_vector/ui/size.ts", import.meta.url), "utf8");
  assert.equal(ours, theirs);
});
