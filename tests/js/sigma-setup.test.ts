// The sigma 4 setup keeps the label grid the widget had on sigma 3: the same cell size and densities, so a graph shows
// the labels it showed in 1.0.0. Run with: node --test tests/js/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// The primitives are built when the module loads; stand-ins are enough to read the settings
const stub = () => ({});
(globalThis as any).anywidgetGraphVendor = { sdfCircle: stub, pathLine: stub, extremityArrow: stub, layerPlain: stub, layerBorder: stub };
const { SIGMA_SETTINGS, labelDensityFor } = await import("../../src/anywidget_graph/ui/sigma-setup.ts");

test("the label grid is sigma 3's: 100 px cells (sigma 4's default, so not overridden) and the widget's densities", () => {
  assert.equal("labelGridCellSize" in SIGMA_SETTINGS, false);
  assert.equal(labelDensityFor(30), 2);
  assert.equal(labelDensityFor(64), 1);
  assert.equal(labelDensityFor(500), 0.5);
});

test("sizes stay in screen pixels and the widget drags nodes itself", () => {
  assert.equal(SIGMA_SETTINGS.itemSizesReference, "screen");
  assert.equal(SIGMA_SETTINGS.enableNodeDrag, false);
  assert.equal(SIGMA_SETTINGS.enableCameraMouseRotation, false);
});
