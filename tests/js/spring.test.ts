// The default 2D layout keeps loose nodes near the connected core, so "fit" frames the graph, not empty space.
// Run with: node --test tests/js/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import * as d3 from "d3-force";

(globalThis as any).anywidgetGraphVendor = { d3Force: d3 };
const { springLayout } = await import("../../src/anywidget_graph/ui/spring.ts");

/** A random graph like a query result: 151 nodes, 260 edges, so a few nodes end up with no edge at all. */
function sample() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const nodes = Array.from({ length: 151 }, (_, i) => ({ id: `n${i}`, size: 6 }));
  const links: [string, string][] = [];
  for (let k = 0; k < 260; k++) links.push([`n${Math.floor(rnd() * 151)}`, `n${Math.floor(rnd() * 151)}`]);
  return { nodes, links };
}

test("nodes without edges settle within 1.5x the radius of the connected core", () => {
  const { nodes, links } = sample();
  const pos = springLayout(nodes, links);
  const degree = new Map<string, number>();
  for (const [a, b] of links) for (const id of [a, b]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const points = [...pos.entries()];
  const cx = points.reduce((s, [, p]) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, [, p]) => s + p.y, 0) / points.length;
  const radius = (p: { x: number; y: number }) => Math.hypot(p.x - cx, p.y - cy);
  const core = points.filter(([id]) => (degree.get(id) ?? 0) >= 2).map(([, p]) => radius(p)).sort((a, b) => a - b);
  const loose = points.filter(([id]) => !degree.has(id)).map(([, p]) => radius(p));
  assert.ok(loose.length > 0, "the sample has nodes without edges");
  const core90 = core[Math.floor(core.length * 0.9)];
  assert.ok(Math.max(...loose) <= 1.5 * core90, `loose ${Math.max(...loose).toFixed(0)} vs core ${core90.toFixed(0)}`);
});

test("the layout is deterministic: the same data gives the same positions", () => {
  const a = springLayout(sample().nodes, sample().links);
  const b = springLayout(sample().nodes, sample().links);
  assert.deepEqual([...a.entries()], [...b.entries()]);
});

test("a hub keeps its spokes on a clear ring (about one link length out)", () => {
  const nodes = Array.from({ length: 21 }, (_, i) => ({ id: `n${i}`, size: 6 }));
  const links = nodes.slice(1).map((n) => ["n0", n.id] as [string, string]);
  const pos = springLayout(nodes, links);
  const hub = pos.get("n0")!;
  for (const n of nodes.slice(1)) {
    const d = Math.hypot(pos.get(n.id)!.x - hub.x, pos.get(n.id)!.y - hub.y);
    assert.ok(d > 50 && d < 160, `spoke ${n.id} at ${d.toFixed(0)} (link length 80)`);
  }
});
