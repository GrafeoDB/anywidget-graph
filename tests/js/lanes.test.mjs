// Pure helpers for linked lanes, incremental append, pulse and host theme. Run with: node --test tests/js/
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  laneOf, laneBand, fitToBand, isCrossEdge, crossKey, placeAppended, hashUnit,
  curveControl, curvePoint, curveUntil, staggerSchedule, progress, pulseScale, themeVariables, withAlpha,
  laneBands, lanesBBox, columnPositions, glyphHit, fitBox,
} from "../../src/anywidget_graph/ui/lanes.js";

const LANES = [{ id: "intermediate", title: "Intermediate graph" }, { id: "output", title: "Output graph" }];

test("a node without a known lane goes to the first lane", () => {
  assert.equal(laneOf({ id: "a", lane: "output" }, LANES), "output");
  assert.equal(laneOf({ id: "b" }, LANES), "intermediate");
  assert.equal(laneOf({ id: "c", lane: "elsewhere" }, LANES), "intermediate");
});

test("lanes sit left to right with a gap", () => {
  const a = laneBand(0), b = laneBand(1);
  assert.deepEqual(a, { x0: 0, x1: 1000, y0: 0, y1: 1000 });
  assert.equal(b.x0, 1400);
  assert.ok(b.x0 > a.x1);
});

test("positions are scaled into the band; a single node sits in the middle", () => {
  const band = laneBand(1);
  const placed = fitToBand({ a: { x: -5, y: 2 }, b: { x: 5, y: 12 } }, band);
  assert.deepEqual(placed.a, { x: band.x0, y: band.y0 });
  assert.deepEqual(placed.b, { x: band.x1, y: band.y1 });
  assert.deepEqual(fitToBand({ only: { x: 3, y: 3 } }, band).only, { x: 1900, y: 500 });
  assert.deepEqual(fitToBand({}, band), {});
});

test("an edge is cross-lane when marked or when its ends are in different lanes", () => {
  const laneById = new Map([["g1", "intermediate"], ["g2", "intermediate"], ["m1", "output"]]);
  assert.equal(isCrossEdge({ source: "m1", target: "g1" }, laneById), true);
  assert.equal(isCrossEdge({ source: "g1", target: "g2" }, laneById), false);
  assert.equal(isCrossEdge({ source: "g1", target: "g2", cross: true }, laneById), true);
  assert.equal(isCrossEdge({ source: "g1", target: "unknown" }, laneById), false);
  assert.equal(crossKey({ source: "m1", target: "g1" }), "m1|g1");
});

test("an appended node sits at the height of its cross-lane neighbours, inside its band", () => {
  const band = laneBand(1);
  const p = placeAppended("m1", { cross: [{ x: 100, y: 200 }, { x: 300, y: 400 }], lane: [] }, band);
  assert.ok(Math.abs(p.y - 300) <= 0.02 * 1000);
  assert.ok(p.x >= band.x0 && p.x <= band.x1);
});

test("without cross neighbours a node goes next to its lane neighbours, else to a stable spot", () => {
  const band = laneBand(0);
  const near = placeAppended("n", { cross: [], lane: [{ x: 500, y: 500 }] }, band);
  assert.ok(Math.hypot(near.x - 500, near.y - 500) <= 60);
  const a = placeAppended("lonely", { cross: [], lane: [] }, band);
  const b = placeAppended("lonely", { cross: [], lane: [] }, band);
  assert.deepEqual(a, b);
  assert.ok(hashUnit("x") >= 0 && hashUnit("x") < 1);
});

test("curves bow to one side and can be drawn partly", () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
  const c = curveControl(a, b);
  assert.equal(c.x, 50);
  assert.notEqual(c.y, 0);
  assert.deepEqual(curvePoint(a, c, b, 0), a);
  assert.deepEqual(curvePoint(a, c, b, 1), b);
  const half = curveUntil(a, c, b, 0.5);
  assert.deepEqual(half.end, curvePoint(a, c, b, 0.5));
  assert.deepEqual(curveUntil(a, c, b, 1).end, b);
});

test("a batch is staggered, and a huge batch is squeezed under the maximum", () => {
  assert.deepEqual(staggerSchedule(3, 60), [0, 60, 120]);
  assert.deepEqual(staggerSchedule(0, 60), []);
  const big = staggerSchedule(1000, 60);
  assert.equal(big.length, 1000);
  assert.ok(big[big.length - 1] <= 1500);
});

test("progress eases from 0 to 1 and the pulse breathes between 1 and 1 + amplitude", () => {
  assert.equal(progress(100, 50, 400), 0);
  assert.equal(progress(100, 600, 400), 1);
  assert.ok(progress(0, 200, 400) > 0.5);
  assert.equal(pulseScale(0), 1);
  assert.ok(Math.abs(pulseScale(700) - 1.35) < 1e-9);
});

test("a host theme maps onto the widget's CSS variables; empty keys are left out", () => {
  const vars = themeVariables({ background: "#0d1416", panel: "#121b1e", text: "#dbe7e5", muted: "", accent: "#5bb8a9" });
  assert.equal(vars["--awg-bg"], "#0d1416");
  assert.equal(vars["--awg-graph-bg"], "#0d1416");
  assert.equal(vars["--awg-bg-secondary"], "#121b1e");
  assert.equal(vars["--awg-text"], "#dbe7e5");
  assert.equal(vars["--awg-accent"], "#5bb8a9");
  assert.equal("--awg-text-secondary" in vars, false);
  assert.deepEqual(themeVariables(null), {});
  assert.equal(withAlpha("#5bb8a9", 0.5), "rgba(91, 184, 169, 0.5)");
  assert.equal(withAlpha("not-a-hex", 0.5), "not-a-hex");
});

test("lanes take their relative width, left to right with the same gap", () => {
  const bands = laneBands([{ id: "repository", width: 0.3 }, { id: "intermediate" }, { id: "output" }, { id: "model", width: 0.25, action: true }]);
  assert.deepEqual(bands.map((band) => [band.x0, band.x1]), [[0, 300], [700, 1700], [2100, 3100], [3500, 3750]]);
  assert.deepEqual(laneBands([{ id: "a" }, { id: "b" }]), [laneBand(0), laneBand(1)]);
});

test("the camera frames every band with a margin, empty ones included", () => {
  const bands = laneBands([{ id: "a" }, { id: "m", width: 0.25, action: true }]);
  assert.deepEqual(lanesBBox(bands, 100), { x: [-100, 1750], y: [-100, 1100] });
});

test("a column lane stacks its nodes around the middle of its band, in the given order", () => {
  const band = { x0: 0, x1: 300, y0: 0, y1: 1000 };
  assert.deepEqual(columnPositions(["only"], band), { only: { x: 150, y: 500 } });
  const three = columnPositions(["a", "b", "c"], band);
  assert.deepEqual(Object.values(three).map((p) => p.x), [150, 150, 150]);
  assert.ok(three.a.y < three.b.y && three.b.y < three.c.y);
  assert.equal(three.b.y, 500);
  assert.equal(three.c.y - three.b.y, three.b.y - three.a.y);
});

test("a click hits the glyph inside its box only", () => {
  assert.equal(glyphHit({ x: 110, y: 95 }, { x: 100, y: 100 }), true);
  assert.equal(glyphHit({ x: 140, y: 100 }, { x: 100, y: 100 }), false);
});

test("an empty canvas fits the lane area itself, centred and in proportion", () => {
  const toViewport = fitBox({ x: [0, 2000], y: [0, 1000] }, 1000, 1000);
  assert.deepEqual(toViewport({ x: 0, y: 0 }), { x: 0, y: 250 });
  assert.deepEqual(toViewport({ x: 2000, y: 1000 }), { x: 1000, y: 750 });
  assert.deepEqual(toViewport({ x: 1000, y: 500 }), { x: 500, y: 500 });
});
