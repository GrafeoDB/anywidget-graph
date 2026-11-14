/**
 * The 2D view's default layout ("spring"): a d3-force simulation, run synchronously, that gives clean hub-spoke
 * rings for hierarchical data. Shared by the widget (index.ts) and the standalone export page (export.ts), so an
 * exported graph is laid out as the widget lays it out.
 */
import { d3Force } from "./vendor-globals.ts";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

/** A node to lay out: its id, a start position when it has one, and its drawn size (for the collision radius). */
export type SpringNode = SimulationNodeDatum & { id: string; size: number };

/** Positions (id -> {x, y}) for the nodes; `links` are [source id, target id] pairs, ends not in `nodes` skipped. */
export function springLayout(nodes: SpringNode[], links: [string, string][]): Map<string, { x: number; y: number }> {
  const n = nodes.length;
  const indexOf = new Map(nodes.map((d, i) => [d.id, i] as [string, number]));
  const d3Links: SimulationLinkDatum<SpringNode>[] = [];
  for (const [source, target] of links) {
    const s = indexOf.get(source), t = indexOf.get(target);
    if (s !== undefined && t !== undefined) d3Links.push({ source: s, target: t });
  }

  // Generous spacing so hub-spoke rings are clear
  const linkDistance = n < 30 ? 80 : n < 100 ? 60 : 45;
  const chargeStrength = n < 30 ? -400 : n < 100 ? -300 : -200;

  const simulation = d3Force.forceSimulation<SpringNode>(nodes)
    .force("link", d3Force.forceLink<SpringNode, SimulationLinkDatum<SpringNode>>(d3Links).distance(linkDistance).strength(0.4))
    // Repulsion reaches only so far, and a gentle pull to the middle keeps nodes without edges near the graph
    // instead of in the far corners, so "fit" frames the graph, not empty space
    .force("charge", d3Force.forceManyBody().strength(chargeStrength).distanceMax(400))
    .force("center", d3Force.forceCenter(0, 0))
    .force("x", d3Force.forceX(0).strength(0.06))
    .force("y", d3Force.forceY(0).strength(0.06))
    .force("collide", d3Force.forceCollide().radius((d) => ((d as SpringNode).size * 2 + 4)).strength(0.8))
    .stop();

  const ticks = Math.min(300, Math.max(100, n * 2));
  for (let i = 0; i < ticks; i++) simulation.tick();

  return new Map(nodes.map((d) => [d.id, { x: d.x ?? 0, y: d.y ?? 0 }]));
}
