// The 3D force layout (src/anywidget_graph/ui/force3d.ts): the graph's bloom (repulsion) and spread (link
// distance) in three dimensions, and where a redraw keeps what is drawn. Run with: node --test tests/js/*.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  autoLinkDistance,
  createForce3D,
  fitPositions,
  forEachNearPair,
  keepPositions,
  keepsPositions,
} from "../../src/anywidget_graph/ui/force3d.ts";

function run(sim: ReturnType<typeof createForce3D>, maxTicks = 400) {
  let alpha = 1;
  for (let i = 0; i < maxTicks && alpha > 0; i++) alpha = sim.tick();
  return alpha;
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function pairDistance(edges: { source: string; target: string }[], linkDistance = 10) {
  const sim = createForce3D({ linkDistance, repulsion: 1 });
  sim.setData([{ id: "a" }, { id: "b" }], edges);
  run(sim);
  const pos = sim.positions();
  return dist(pos.get("a")!, pos.get("b")!);
}

test("a linked pair settles near the link distance (spread), closer than the same pair unlinked", () => {
  const linked = pairDistance([{ source: "a", target: "b" }]);
  const unlinked = pairDistance([]);
  // The spring holds the pair near its rest length against the bloom; without it the bloom alone sets the distance
  assert.ok(linked > 8 && linked < 16, `linked pair distance ${linked} should be near the rest length 10`);
  assert.ok(unlinked > 16, `unlinked pair distance ${unlinked} should be set by the bloom alone`);
  assert.ok(unlinked - linked > 2, `the link should pull the pair together (${linked} vs ${unlinked})`);
  // The spread scales the settled distance
  assert.ok(pairDistance([{ source: "a", target: "b" }], 20) > linked * 1.5, "a longer rest length spreads the pair");
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

test("self-loops and parallel edges add no force: the layout equals the one with a single edge", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const extra = createForce3D({ linkDistance: 10, seed: 3 });
  extra.setData(nodes, [
    { source: "a", target: "a" },
    { source: "a", target: "b" },
    { source: "b", target: "a" },
    { source: "a", target: "b" },
  ]);
  run(extra);
  const single = createForce3D({ linkDistance: 10, seed: 3 });
  single.setData(nodes, [{ source: "a", target: "b" }]);
  run(single);
  assert.deepEqual([...extra.positions()], [...single.positions()]);
});

test("the same data set twice gives the same layout (each run starts from the seed)", () => {
  const nodes = Array.from({ length: 15 }, (_, i) => ({ id: `n${i}` }));
  const edges = nodes.slice(1).map((n, i) => ({ source: `n${i}`, target: n.id }));
  const sim = createForce3D({ seed: 5 });
  sim.setData(nodes, edges);
  run(sim);
  const first = [...sim.positions()];
  sim.setData(nodes, edges);
  run(sim);
  assert.deepEqual([...sim.positions()], first);
});

test("nodes that start on the same spot are pushed apart", () => {
  const sim = createForce3D({ linkDistance: 10 });
  // The same x, y and z: no direction between them until the jiggle gives one
  const nodes = [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: 0, y: 0, z: 0 }, { id: "c", x: 0, y: 0, z: 0 }];
  sim.setData(nodes, []);
  run(sim);
  const pos = sim.positions();
  for (const [p, q] of [["a", "b"], ["a", "c"], ["b", "c"]]) {
    const d = dist(pos.get(p)!, pos.get(q)!);
    assert.ok(d > 1, `${p} and ${q} still overlap (${d})`);
  }
});

test("a spread that is not a positive number is automatic", () => {
  const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}` }));
  for (const linkDistance of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, null]) {
    const sim = createForce3D({ linkDistance });
    sim.setData(nodes, []);
    assert.equal(sim.linkDistance, autoLinkDistance(30), `linkDistance ${linkDistance}`);
  }
  const fixed = createForce3D({ linkDistance: 7 });
  fixed.setData(nodes, []);
  assert.equal(fixed.linkDistance, 7);
});

test("forEachNearPair visits every pair closer than the cell, once", () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const n = 300;
  const pos = new Float64Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = (rand() - 0.5) * 200;
  pos[3 * 7] = 1e5; // one node thrown far out does not change the answer
  const cell = 15;
  const near = (i: number, j: number) =>
    Math.hypot(pos[j * 3] - pos[i * 3], pos[j * 3 + 1] - pos[i * 3 + 1], pos[j * 3 + 2] - pos[i * 3 + 2]) < cell;
  const expected = new Set<string>();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (near(i, j)) expected.add(`${i}|${j}`);
  const visited = new Map<string, number>();
  forEachNearPair(pos, n, cell, (i, j) => {
    assert.ok(i < j);
    visited.set(`${i}|${j}`, (visited.get(`${i}|${j}`) ?? 0) + 1);
  });
  for (const pair of expected) assert.ok(visited.has(pair), `close pair ${pair} not visited`);
  // Every pair visited, close or not, is visited once
  for (const [pair, times] of visited) assert.equal(times, 1, `pair ${pair} visited ${times} times`);
  assert.ok(expected.size > 20, "the test cloud has close pairs");
  // Far fewer pairs than all n * (n - 1) / 2: the grid is what keeps a large graph's layout fast
  assert.ok(visited.size < (n * (n - 1)) / 8, `visited ${visited.size} pairs`);
});

test("keepsPositions: an append, a restyle or a removal keeps what is drawn; new data or a preset does not", () => {
  const drawn = new Map([["a", { x: 0, y: 0, z: 0 }], ["b", { x: 1, y: 0, z: 0 }]]);
  assert.equal(keepsPositions(drawn, ["a", "b", "c"], true, "spring"), true, "append");
  assert.equal(keepsPositions(drawn, ["a", "b"], false, "spring"), true, "restyle");
  assert.equal(keepsPositions(drawn, ["a"], false, "spring"), true, "removal");
  assert.equal(keepsPositions(drawn, ["a", "c"], false, "spring"), false, "new data from the host");
  assert.equal(keepsPositions(drawn, ["a", "b", "c"], true, "preset"), false, "preset");
  assert.equal(keepsPositions(new Map(), ["a"], true, "spring"), false, "first draw");
});

test("keepPositions: drawn nodes stay, a new node goes next to its neighbour, apart from its siblings", () => {
  const drawn = new Map([
    ["a", { x: 0, y: 0, z: 0 }],
    ["b", { x: 1, y: 0, z: 0 }],
    ["far", { x: 50, y: 50, z: 50 }],
  ]);
  const keys = ["a", "b", "far", "c", "d", "lonely"];
  const links: [string, string][] = [["a", "b"], ["a", "c"], ["a", "d"], ["c", "c"]];
  const out = keepPositions(drawn, keys, links, { fallbackStep: 0.2, radius: 1, random: () => 0.5 });
  assert.deepEqual(out.get("a"), { x: 0, y: 0, z: 0 });
  assert.deepEqual(out.get("b"), { x: 1, y: 0, z: 0 });
  assert.deepEqual(out.get("far"), { x: 50, y: 50, z: 50 });
  // c and d: one median edge length (a-b, 1) from a, and not on top of each other
  for (const k of ["c", "d"]) assert.ok(Math.abs(dist(out.get(k)!, out.get("a")!) - 1) < 1e-9, k);
  assert.ok(dist(out.get("c")!, out.get("d")!) > 0.5, "siblings apart");
  // Linked to nothing drawn: inside the ball
  assert.ok(dist(out.get("lonely")!, { x: 0, y: 0, z: 0 }) <= 1);
  assert.equal(out.size, keys.length);
});

test("keepPositions: a new batch linked only among itself stays together around one placed node", () => {
  const drawn = new Map([["a", { x: 0, y: 0, z: 0 }], ["b", { x: 1, y: 0, z: 0 }]]);
  // p, q and r link to each other but to nothing drawn
  const keys = ["a", "b", "p", "q", "r"];
  const links: [string, string][] = [["a", "b"], ["p", "q"], ["q", "r"]];
  let seed = 3;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = keepPositions(drawn, keys, links, { fallbackStep: 0.2, radius: 1, random });
  // One edge length (the a-b median, 1) between linked new nodes, not scattered across the ball independently
  assert.ok(Math.abs(dist(out.get("p")!, out.get("q")!) - 1) < 1e-9, "p next to q");
  assert.ok(Math.abs(dist(out.get("q")!, out.get("r")!) - 1) < 1e-9, "r next to q");
  assert.equal(out.size, keys.length);
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
