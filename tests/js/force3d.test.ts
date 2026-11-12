// The 3D force layout (src/anywidget_graph/ui/force3d.js): the graph's bloom (repulsion) and spread (link
// distance) in three dimensions. Run with: node --test "tests/js/*.test.mjs"

import assert from "node:assert/strict";
import { test } from "node:test";

import { autoLinkDistance, createForce3D, fitPositions } from "../../src/anywidget_graph/ui/force3d.ts";

function run(sim: ReturnType<typeof createForce3D>, maxTicks = 400) {
  let alpha = 1;
  for (let i = 0; i < maxTicks && alpha > 0; i++) alpha = sim.tick();
  return alpha;
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

test("a linked pair settles near the link distance (spread), not on top of each other", () => {
  const sim = createForce3D({ linkDistance: 10, repulsion: 1 });
  sim.setData([{ id: "a" }, { id: "b" }], [{ source: "a", target: "b" }]);
  run(sim);
  const pos = sim.positions();
  const d = dist(pos.get("a")!, pos.get("b")!);
  assert.ok(d > 3 && d < 25, `linked pair distance ${d} should be around the rest length 10`);
});

test("unlinked nodes are pushed apart by the bloom, in 3D (the z spread is real)", () => {
  const sim = createForce3D({ repulsion: 1, linkDistance: 10 });
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}` }));
  sim.setData(nodes, []); // no edges: pure repulsion + gravity
  run(sim);
  const pos = sim.positions();
  const pts = nodes.map((n) => pos.get(n.id));
  // Every pair is apart, and the cloud uses the third dimension
  let minPair = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) minPair = Math.min(minPair, dist(pts[i]!, pts[j]!));
  }
  assert.ok(minPair > 0.5, `closest unlinked pair ${minPair} should be pushed apart`);
  const zs = pts.map((p) => p!.z);
  const zSpread = Math.max(...zs) - Math.min(...zs);
  assert.ok(zSpread > 0.5, `z spread ${zSpread} should be real: the layout is 3D, not flat`);
});

test("stronger bloom spreads the same graph wider", () => {
  const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}` }));
  const edges = nodes.slice(1).map((n, i) => ({ source: `n${i}`, target: n.id }));
  const extent = (repulsion: number) => {
    const sim = createForce3D({ repulsion, linkDistance: 10 });
    sim.setData(nodes, edges);
    run(sim);
    const pts = nodes.map((n) => sim.positions().get(n.id));
    let max = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) max = Math.max(max, dist(pts[i]!, pts[j]!));
    }
    return max;
  };
  assert.ok(extent(3) > extent(0.2), "more repulsion means a wider cloud");
});

test("a chain keeps its links short while staying connected end to end", () => {
  const n = 8;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` }));
  const sim = createForce3D({ repulsion: 1, linkDistance: 10 });
  sim.setData(nodes, edges);
  run(sim);
  const pos = sim.positions();
  for (let i = 0; i < n - 1; i++) {
    const d = dist(pos.get(`n${i}`)!, pos.get(`n${i + 1}`)!);
    assert.ok(d < 30, `link ${i} too long: ${d}`);
  }
  const ends = dist(pos.get("n0")!, pos.get(`n${n - 1}`)!);
  assert.ok(ends < (n - 1) * 30, "chain ends should not be absurdly far apart");
});

test("pinned nodes do not move", () => {
  const sim = createForce3D({ repulsion: 1, linkDistance: 10 });
  sim.setData(
    [{ id: "a", x: 1, y: 2, z: 3, pinned: true }, { id: "b" }],
    [{ source: "a", target: "b" }]
  );
  run(sim);
  const a = sim.positions().get("a")!;
  assert.deepEqual({ x: a.x, y: a.y, z: a.z }, { x: 1, y: 2, z: 3 });
});

test("self-loops and parallel edges add no force and do not crash", () => {
  const sim = createForce3D({ linkDistance: 10 });
  sim.setData([{ id: "a" }, { id: "b" }], [
    { source: "a", target: "a" },
    { source: "a", target: "b" },
    { source: "a", target: "b" },
  ]);
  run(sim);
  assert.equal(sim.positions().size, 2);
});

test("deterministic for the same seed; autoLinkDistance grows with the node count", () => {
  const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}` }));
  const edges = [{ source: "n0", target: "n1" }];
  const a = createForce3D({ seed: 7 });
  a.setData(nodes, edges);
  run(a);
  const b = createForce3D({ seed: 7 });
  b.setData(nodes, edges);
  run(b);
  assert.deepEqual([...a.positions().values()], [...b.positions().values()]);
  assert.ok(autoLinkDistance(1000) > autoLinkDistance(10));
});

test("fitPositions centres the cloud in a cube of the given side", () => {
  const pos = new Map([
    ["a", { x: 0, y: 0, z: 0 }],
    ["b", { x: 4, y: 2, z: -2 }],
  ]);
  const fitted = fitPositions(pos, 2);
  const pts = [...fitted.values()];
  const extent = Math.max(...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)))) * 2;
  assert.ok(Math.abs(extent - 2) < 1e-9, `extent ${extent} should be 2`);
  const cx = pts.reduce((s, p) => s + p.x, 0) / 2;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 2;
  const cz = pts.reduce((s, p) => s + p.z, 0) / 2;
  assert.ok(Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9 && Math.abs(cz) < 1e-9, "centred on the origin");
});
