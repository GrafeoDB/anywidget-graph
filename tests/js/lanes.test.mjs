// Pure helpers for linked lanes, incremental append, pulse and host theme. Run with: node --test tests/js/
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  laneOf, laneBand, fitToBand, isCrossEdge, crossKey, placeAppended, hashUnit,
  curveControl, curvePoint, curveUntil, staggerSchedule, progress, pulseScale, themeVariables, withAlpha,
  laneBands, lanesBBox, columnPositions, glyphHit, fitBox, labelColor, nextLaneAction, edgeKey, mergeItems,
  sameItems, extentBand, crossNeighbours, laneIcon, removeItems, edgeMatches, applyBatchItems,
  withTotals, shownOf, totalShown, nodeType, edgeType, insetBand,
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
  assert.deepEqual(p, { x: (band.x0 + band.x1) / 2, y: 300 });
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

test("a host theme maps onto the widget's CSS variables; a key it leaves out clears its variables", () => {
  const vars = themeVariables({ background: "#0d1416", panel: "#121b1e", text: "#dbe7e5", muted: "", accent: "#5bb8a9" });
  assert.equal(vars["--awg-bg"], "#0d1416");
  assert.equal(vars["--awg-graph-bg"], "#0d1416");
  assert.equal(vars["--awg-bg-secondary"], "#121b1e");
  assert.equal(vars["--awg-text"], "#dbe7e5");
  assert.equal(vars["--awg-accent"], "#5bb8a9");
  // An empty string removes the inline variable, so the widget's own light or dark colour shows again
  assert.equal(vars["--awg-text-secondary"], "");
  assert.equal(vars["--awg-border"], "");
  const cleared = themeVariables(null);
  assert.equal(Object.keys(cleared).length, Object.keys(vars).length);
  assert.ok(Object.values(cleared).every((value) => value === ""));
  assert.equal(withAlpha("#5bb8a9", 0.5), "rgba(91, 184, 169, 0.5)");
  assert.equal(withAlpha("not-a-hex", 0.5), "not-a-hex");
});

test("labels take the host theme's text colour, else the light or dark default", () => {
  assert.equal(labelColor({ text: "#dbe7e5" }, false), "#dbe7e5");
  assert.equal(labelColor({}, true), "#e0e0e0");
  assert.equal(labelColor(null, false), "#333");
});

test("a lane action counts on from the value the model holds, so every view's click is a change", () => {
  assert.deepEqual(nextLaneAction("model", {}), { lane: "model", seq: 1 });
  // Another view (or an earlier render) already sent seq 3
  assert.deepEqual(nextLaneAction("model", { lane: "model", seq: 3 }), { lane: "model", seq: 4 });
  assert.deepEqual(nextLaneAction("model", null), { lane: "model", seq: 1 });
});

test("appended items merge into the drawn data: a node by id (properties updated), an edge once per ends and label", () => {
  const base = mergeItems(undefined, [{ id: "a", label: "A" }, { id: "b" }], [{ source: "a", target: "b" }]);
  const drawn = mergeItems(base, [{ id: "a", color: "red" }, { id: "c" }], [{ source: "a", target: "b" }, { source: "b", target: "c", label: "x" }]);
  assert.deepEqual([...drawn.nodes.keys()], ["a", "b", "c"]);
  assert.deepEqual(drawn.nodes.get("a"), { id: "a", label: "A", color: "red" });
  assert.deepEqual(drawn.edges.map(edgeKey), ["a|b|", "b|c|x"]);
  // The base data keeps parallel edges as given; nothing changes in place
  assert.equal(mergeItems(undefined, [], [{ source: "a", target: "b" }, { source: "a", target: "b" }]).edges.length, 2);
  assert.equal(base.nodes.size, 2);
});

test("the host's lists that hold exactly the drawn items are a copy, anything else replaces the drawing", () => {
  const drawn = mergeItems(undefined, [{ id: "a" }, { id: "b" }], [{ source: "a", target: "b" }]);
  assert.equal(sameItems(drawn, [{ id: "b", label: "B" }, { id: "a" }], [{ source: "a", target: "b" }]), true);
  assert.equal(sameItems(drawn, [{ id: "a" }], [{ source: "a", target: "b" }]), false);
  assert.equal(sameItems(drawn, [{ id: "a" }, { id: "b" }, { id: "c" }], [{ source: "a", target: "b" }]), false);
  assert.equal(sameItems(drawn, [{ id: "a" }, { id: "b" }], []), false);
  assert.equal(sameItems(drawn, [{ id: "a" }, { id: "b" }], [{ source: "a", target: "b", label: "other" }]), false);
});

test("ids that differ only at the end (y1, y2, ...) still spread over the band, instead of landing on one spot", () => {
  // FNV alone puts y0, y1, y2, ... about 0.004 apart; spread numbers are about 1/3 apart on average
  const units = Array.from({ length: 20 }, (_, i) => hashUnit(`y${i}`));
  const steps = units.slice(1).map((u, i) => Math.abs(u - units[i]));
  assert.ok(steps.reduce((sum, step) => sum + step, 0) / steps.length > 0.2);
  // Ten nodes without neighbours go to stable spots spread over the band, not to one spot
  const band = laneBand(1);
  const xs = units.slice(0, 10).map((_, i) => placeAppended(`y${i}`, {}, band).x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 200);
});

test("nodes next to the same neighbour stack as rows, one label line apart, then in the next column", () => {
  const band = laneBand(1);  // x 1400..2400, y 0..1000
  const unit = { x: 150, y: 20 };  // one label width across, one label line down, in graph units
  const placed = [];
  for (let i = 0; i < 60; i++) placed.push(placeAppended(`e${i}`, { cross: [{ x: 300, y: 500 }], occupied: [...placed], unit }, band));
  // Every label box is clear of every other one, inside the band
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    assert.ok(p.x >= band.x0 && p.x <= band.x1 && p.y >= band.y0 && p.y <= band.y1);
    for (let j = i + 1; j < placed.length; j++) {
      const q = placed[j];
      assert.ok(Math.abs(p.x - q.x) >= unit.x || Math.abs(p.y - q.y) >= unit.y, `labels ${i} and ${j} overlap`);
    }
  }
  // The first ones line up in the middle of the band, at the neighbour's height and the rows next to it
  assert.deepEqual(placed.slice(0, 3), [{ x: 1900, y: 500 }, { x: 1900, y: 520 }, { x: 1900, y: 480 }]);
  // A column is three rows' worth: after rows 0, +-1, +-2 come the next columns, before rows 4 and beyond
  assert.deepEqual(placed[5], { x: 2050, y: 500 });
  assert.ok(placed.some((q) => q.x === 1750));
});

test("rows stay one label line apart with fractional spacing too (no row is skipped by rounding)", () => {
  const band = laneBand(1);
  const unit = { x: 151.37, y: 17.93 };
  const placed = [];
  for (let i = 0; i < 9; i++) placed.push(placeAppended(`e${i}`, { cross: [{ x: 300, y: 500 }], occupied: [...placed], unit }, band));
  const rows = placed.filter((p) => p.x === 1900).map((p) => Math.round((p.y - 500) / unit.y)).sort((a, b) => a - b);
  assert.deepEqual(rows, [-3, -2, -1, 0, 1, 2, 3]);
});

test("an appended node keeps its spot when its label is clear, and stays inside a band that is full", () => {
  const band = laneBand(1);
  const unit = { x: 150, y: 20 };
  const alone = placeAppended("e1", { cross: [{ x: 300, y: 500 }], unit }, band);
  assert.deepEqual(placeAppended("e1", { cross: [{ x: 300, y: 500 }], occupied: [{ x: 0, y: 0 }], unit }, band), alone);
  // A laid-out node right there pushes it to the next row
  assert.deepEqual(placeAppended("e1", { cross: [{ x: 300, y: 500 }], occupied: [{ x: 1950, y: 500 }], unit }, band), { x: 1900, y: 520 });
  // A tiny band with no room left: the spot itself, never outside the band
  const tiny = { x0: 0, x1: 10, y0: 0, y1: 10 };
  const p = placeAppended("e1", { cross: [{ x: 0, y: 5 }], occupied: [{ x: 5, y: 5 }], unit }, tiny);
  assert.ok(p.x >= 0 && p.x <= 10 && p.y >= 0 && p.y <= 10);
  // ...marked crowded, so its label is left to sigma's culling (a clear spot carries no mark)
  assert.equal(p.crowded, true);
  assert.equal("crowded" in alone, false);
});

test("an action lane shows the host's icon (SVG or image URL), stacked bars only for glyph colours, else a neutral icon", () => {
  const svg = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 2h20v20H2z"/></svg>';
  const fromSvg = laneIcon({ action: true, icon: svg }, "#0880ea");
  assert.equal(fromSvg.kind, "image");
  assert.ok(fromSvg.src.startsWith("data:image/svg+xml"));
  // currentColor takes the accent, so a plain icon follows the theme
  assert.ok(decodeURIComponent(fromSvg.src).includes('fill="#0880ea"'));
  assert.deepEqual(laneIcon({ action: true, icon: "https://example.org/model.png" }, "#000"), { kind: "image", src: "https://example.org/model.png" });
  assert.deepEqual(laneIcon({ action: true, glyph: ["#f0c000", "#00a0c0"] }, "#000"), { kind: "bars", colors: ["#f0c000", "#00a0c0"] });
  // An icon wins over glyph colours; nothing given is the neutral "open" icon, never the bars
  assert.equal(laneIcon({ action: true, icon: svg, glyph: ["#f00"] }, "#000").kind, "image");
  assert.deepEqual(laneIcon({ action: true }, "#000"), { kind: "open" });
  assert.deepEqual(laneIcon({ action: true, glyph: [] }, "#000"), { kind: "open" });
});

test("a batch removes nodes (with every edge touching them) and edges; an edge without a label means all between its ends", () => {
  const drawn = mergeItems(undefined, [{ id: "a" }, { id: "b" }, { id: "c" }], [
    { source: "a", target: "b", label: "x" }, { source: "a", target: "b", label: "y" }, { source: "b", target: "c" },
  ]);
  const withoutC = removeItems(drawn, { nodes: ["c"] });
  assert.deepEqual([...withoutC.nodes.keys()], ["a", "b"]);
  assert.deepEqual(withoutC.edges.map(edgeKey), ["a|b|x", "a|b|y"]);
  assert.deepEqual(removeItems(drawn, { edges: [{ source: "a", target: "b", label: "x" }] }).edges.map(edgeKey), ["a|b|y", "b|c|"]);
  assert.deepEqual(removeItems(drawn, { edges: [{ source: "a", target: "b" }] }).edges.map(edgeKey), ["b|c|"]);
  assert.equal(edgeMatches({ source: "b", target: "c" }, { source: "b", target: "c", label: "" }), true);
  assert.equal(drawn.nodes.size, 3);  // unchanged in place
  // A re-sample in one batch: removals first, then the new items (a node removed and sent again stays)
  const next = applyBatchItems(drawn, { remove: { nodes: ["b", "c"] }, nodes: [{ id: "b", label: "B" }, { id: "d" }], edges: [{ source: "d", target: "a" }] });
  assert.deepEqual([...next.nodes.keys()], ["a", "b", "d"]);
  assert.deepEqual(next.edges.map(edgeKey), ["d|a|"]);
});

test("host totals show as 'shown / total' per type; a type the sample lacks still shows, as 0", () => {
  const counts = new Map([["File", 120], ["Class", 30]]);
  assert.deepEqual(withTotals(counts, { File: 20000, Class: 9000, Note: 50 }), [
    { name: "File", count: 120, total: 20000 },
    { name: "Class", count: 30, total: 9000 },
    { name: "Note", count: 0, total: 50 },
  ]);
  // Without totals (or for a type the host does not list): the count alone, sorted by count
  assert.deepEqual(withTotals(new Map([["A", 1], ["B", 5]]), undefined), [{ name: "B", count: 5 }, { name: "A", count: 1 }]);
  assert.deepEqual(withTotals(new Map([["A", 1]]), { B: 4 }), [{ name: "A", count: 1 }, { name: "B", count: 0, total: 4 }]);
  assert.equal(shownOf(300, 30000), "300 / 30,000");
  assert.equal(shownOf(3), "3");
  // The badge's total: the host's totals, plus the shown items of a type it gives none for (those are shown in full)
  const nodes = [{ id: 1, labels: ["File"] }, { id: 2, label: "Class" }, { id: 3, label: "Element" }, { id: 4 }];
  assert.equal(totalShown(nodes, nodeType, { File: 20000, Class: 9000 }), 29002);
  assert.equal(totalShown(nodes, nodeType, undefined), undefined);
  assert.equal(totalShown(nodes, nodeType, {}), undefined);
  assert.deepEqual(nodes.map(nodeType), ["File", "Class", "Element", "Unlabeled"]);
  assert.deepEqual([{ type: "CONTAINS" }, { label: "x" }, {}].map(edgeType), ["CONTAINS", "x", "unknown"]);
});

test("nodes keep a margin from their lane's edges, so none sits under a title or on the border", () => {
  const band = { x0: 1400, x1: 2400, y0: 0, y1: 2000 };
  assert.deepEqual(insetBand(band), { x0: 1460, x1: 2340, y0: 120, y1: 1880 });
  assert.deepEqual(insetBand(band, 0.1), { x0: 1500, x1: 2300, y0: 200, y1: 1800 });
  // Laid-out nodes fill the inset band: the outermost ones land on its edges, not the lane's
  const placed = fitToBand({ a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }, insetBand(band));
  assert.deepEqual(placed, { a: { x: 1460, y: 120 }, b: { x: 2340, y: 1880 } });
});

test("a search shows a match's partners in other lanes, through the cross-lane links either way", () => {
  const cross = [
    { source: "t1", target: "s1", key: "t1|s1" },
    { source: "s1", target: "u1", key: "s1|u1" },
    { source: "t2", target: "s2", key: "t2|s2" },
  ];
  assert.deepEqual([...crossNeighbours(new Set(["s1"]), cross)].sort(), ["t1", "u1"]);
  assert.equal(crossNeighbours(new Set(), cross).size, 0);
});

test("without lanes, appended nodes go inside the drawn area, so the camera does not rescale", () => {
  assert.deepEqual(extentBand([{ x: -50, y: 10 }, { x: 150, y: -30 }, { x: 0, y: 70 }]), { x0: -50, x1: 150, y0: -30, y1: 70 });
  // One node: an area around it; a flat graph: as high as it is wide
  assert.deepEqual(extentBand([{ x: 10, y: 20 }]), { x0: -490, x1: 510, y0: -480, y1: 520 });
  assert.deepEqual(extentBand([{ x: 0, y: 5 }, { x: 200, y: 5 }]), { x0: 0, x1: 200, y0: -95, y1: 105 });
  assert.equal(extentBand([]), null);
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

test("an empty canvas keeps sigma's stage padding, so the lanes don't move when the first node arrives", () => {
  // Sigma fits the box into the smaller side less twice the padding: 50 px above and below here, 100 px at the sides
  const toViewport = fitBox({ x: [0, 2000], y: [0, 1000] }, 1000, 500, 50);
  assert.deepEqual(toViewport({ x: 0, y: 0 }), { x: 100, y: 50 });
  assert.deepEqual(toViewport({ x: 2000, y: 1000 }), { x: 900, y: 450 });
  assert.deepEqual(toViewport({ x: 1000, y: 500 }), { x: 500, y: 250 });
  // A container without a size yet maps everything to its corner instead of NaN
  assert.deepEqual(fitBox({ x: [0, 2000], y: [0, 1000] }, 0, 0, 30)({ x: 1000, y: 500 }), { x: 0, y: 0 });
});
