/**
 * 3D force-directed layout for the 3D view (ui/canvas3d.js): the graph's "bloom" and "spread" run in three
 * dimensions, so connected nodes pull together along edges while every pair of nodes pushes apart through the
 * volume and a weak gravity keeps the cloud centred.
 *
 * Pure math (no THREE, no DOM), so tests/js runs it in Node: createForce3D(...) -> setData(nodes, edges) -> tick()
 * until the returned alpha cools, then read positions().
 *
 * Tunables (the widget's traits of the same meaning):
 * - repulsion  ("bloom"): many-body push between every pair of nodes, relative to the link distance
 * - linkDistance ("spread"): rest length of an edge; null picks one from the node count
 * - gravity: pull towards the centre of the cloud
 * - collision: keep node spheres (their drawn sizes) from overlapping
 */

import type { GraphEdge, GraphNode } from "./types.ts";

/** A 3D point in layout units. */
export interface Vec3 { x: number; y: number; z: number }

/** Options of createForce3D (the widget traits of the same meaning). */
export interface Force3DOptions {
  repulsion?: number;
  linkDistance?: number | null;
  gravity?: number;
  collision?: boolean;
  ticks?: number;
  seed?: number;
  alphaDecay?: number;
  alphaMin?: number;
}

// Deterministic PRNG (mulberry32), so a layout is reproducible and tests are stable
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rest length of an edge from the node count: in a 3D cloud of n nodes the average spacing grows like cbrt(n). */
export function autoLinkDistance(nodeCount: number): number {
  return Math.min(60, Math.max(8, 12 * Math.cbrt(Math.max(nodeCount, 1))));
}

/**
 * The simulation. `options`: { repulsion = 1, linkDistance = null, gravity = 0.03, collision = true,
 * ticks = 300, seed = 1, alphaDecay = 0.02, alphaMin = 0.001 }.
 */
export function createForce3D(options: Force3DOptions = {}) {
  const repulsion = options.repulsion ?? 1;
  const linkDistanceOpt = options.linkDistance ?? null;
  const gravity = options.gravity ?? 0.03;
  const collision = options.collision ?? true;
  const maxTicks = options.ticks ?? 300;
  const alphaDecay = options.alphaDecay ?? 0.02;
  const alphaMin = options.alphaMin ?? 0.001;
  const seed = options.seed ?? 1;

  let ids: string[] = []; // index -> node id (as given)
  let indexOf = new Map<string, number>(); // String(id) -> index
  let pos: Float64Array | null = null; // 3 per node
  let vel: Float64Array | null = null;
  let radius: Float64Array | null = null; // collision radius per node
  let pinned: Uint8Array | null = null;
  let links: [number, number, number][] = []; // [i, j, restLength]
  let linkDistance: number = linkDistanceOpt ?? 10;
  let alpha = 0;
  let tickCount = 0;
  let rand = mulberry32(seed);

  function setData(nodes: GraphNode[], edges: GraphEdge[] | null | undefined): void {
    ids = nodes.map((n) => String(n.id));
    indexOf = new Map(ids.map((id, i) => [id, i] as [string, number]));
    const n = ids.length;
    const posArr = new Float64Array(n * 3);
    pos = posArr;
    vel = new Float64Array(n * 3);
    const radiusArr = new Float64Array(n);
    radius = radiusArr;
    const pinnedArr = new Uint8Array(n);
    pinned = pinnedArr;
    linkDistance = linkDistanceOpt ?? autoLinkDistance(n);

    // Start where the host put each node when it gave that node coordinates (z jittered when the z values do not
    // vary, so a 2D preset still blooms into the third dimension); otherwise on a random sphere
    const zs = new Set(nodes.map((nd) => nd.z));
    const zVaries = zs.size > 1;
    const r0 = linkDistance * Math.cbrt(Math.max(n, 1));
    nodes.forEach((nd: GraphNode, i: number) => {
      if (nd.x !== undefined && nd.y !== undefined) {
        posArr[i * 3] = nd.x;
        posArr[i * 3 + 1] = nd.y;
        posArr[i * 3 + 2] = nd.z !== undefined && zVaries ? nd.z : (rand() - 0.5) * linkDistance * 0.5;
      } else {
        // Uniform-ish in a ball
        const u = rand() * 2 - 1;
        const phi = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        posArr[i * 3] = r0 * Math.cbrt(rand()) * s * Math.cos(phi);
        posArr[i * 3 + 1] = r0 * Math.cbrt(rand()) * s * Math.sin(phi);
        posArr[i * 3 + 2] = r0 * Math.cbrt(rand()) * u;
      }
      radiusArr[i] = Math.max(0.5, (nd.size ?? 8) / 8) * linkDistance * 0.12;
      pinnedArr[i] = nd.pinned ? 1 : 0;
    });

    // Links, once per unordered pair of ends (parallel edges and self-loops do not add force)
    links = [];
    const seen = new Set<string>();
    for (const edge of edges || []) {
      const a = indexOf.get(String(edge.source));
      const b = indexOf.get(String(edge.target));
      if (a === undefined || b === undefined || a === b) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push([a, b, linkDistance]);
    }

    alpha = 1;
    tickCount = 0;
  }

  /** One simulation step; returns the current alpha (cools towards 0, `reheat` raises it again). */
  function tick(): number {
    if (!pos || !vel || !radius || !pinned || tickCount >= maxTicks) return 0;
    const n = ids.length;
    if (n === 0) return 0;
    alpha += (0 - alpha) * alphaDecay;
    if (alpha < alphaMin) alpha = 0;
    const a = alpha;
    if (a === 0) return 0;

    // Many-body repulsion ("bloom"): inverse-square push between every pair, cut off far away
    const k = repulsion * linkDistance * linkDistance * 0.8;
    const cutoff2 = (linkDistance * 6) * (linkDistance * 6);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j * 3] - pos[i * 3];
        const dy = pos[j * 3 + 1] - pos[i * 3 + 1];
        const dz = pos[j * 3 + 2] - pos[i * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        if (d2 > cutoff2) continue;
        const f = (k / d2) * a;
        const fx = (dx / Math.sqrt(d2)) * f;
        const fy = (dy / Math.sqrt(d2)) * f;
        const fz = (dz / Math.sqrt(d2)) * f;
        vel[i * 3] -= fx; vel[i * 3 + 1] -= fy; vel[i * 3 + 2] -= fz;
        vel[j * 3] += fx; vel[j * 3 + 1] += fy; vel[j * 3 + 2] += fz;
      }
    }

    // Link springs ("spread"): pull towards the rest length along the edge
    const linkStrength = 0.08;
    for (const [i, j, rest] of links) {
      const dx = pos[j * 3] - pos[i * 3];
      const dy = pos[j * 3 + 1] - pos[i * 3 + 1];
      const dz = pos[j * 3 + 2] - pos[i * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      const f = (d - rest) * linkStrength * a;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      const fz = (dz / d) * f;
      vel[i * 3] += fx; vel[i * 3 + 1] += fy; vel[i * 3 + 2] += fz;
      vel[j * 3] -= fx; vel[j * 3 + 1] -= fy; vel[j * 3 + 2] -= fz;
    }

    // Gravity towards the centre of mass, so the cloud does not drift away
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    const velocityDecay = 0.6;
    for (let i = 0; i < n; i++) {
      if (pinned[i]) { vel[i * 3] = vel[i * 3 + 1] = vel[i * 3 + 2] = 0; continue; }
      vel[i * 3] += (cx - pos[i * 3]) * gravity * a;
      vel[i * 3 + 1] += (cy - pos[i * 3 + 1]) * gravity * a;
      vel[i * 3 + 2] += (cz - pos[i * 3 + 2]) * gravity * a;
      vel[i * 3] *= velocityDecay; vel[i * 3 + 1] *= velocityDecay; vel[i * 3 + 2] *= velocityDecay;
      pos[i * 3] += vel[i * 3];
      pos[i * 3 + 1] += vel[i * 3 + 1];
      pos[i * 3 + 2] += vel[i * 3 + 2];
    }

    // Collision: project overlapping spheres apart (position-level, like d3-force's collide)
    if (collision) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = pos[j * 3] - pos[i * 3];
          const dy = pos[j * 3 + 1] - pos[i * 3 + 1];
          const dz = pos[j * 3 + 2] - pos[i * 3 + 2];
          const min = radius[i] + radius[j];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const overlap = ((min - d) / d) * 0.5 * a;
          const ox = dx * overlap, oy = dy * overlap, oz = dz * overlap;
          if (!pinned[i]) { pos[i * 3] -= ox; pos[i * 3 + 1] -= oy; pos[i * 3 + 2] -= oz; }
          if (!pinned[j]) { pos[j * 3] += ox; pos[j * 3 + 1] += oy; pos[j * 3 + 2] += oz; }
        }
      }
    }

    tickCount++;
    return alpha;
  }

  function reheat(value = 0.5): void {
    alpha = Math.max(alpha, value);
    tickCount = 0;
  }

  /** id (as given) -> { x, y, z }, in layout units. */
  function positions(): Map<string, Vec3> {
    const p = pos;
    const out = new Map<string, Vec3>();
    for (let i = 0; i < ids.length; i++) {
      if (!p) break;
      out.set(ids[i], { x: p[i * 3], y: p[i * 3 + 1], z: p[i * 3 + 2] });
    }
    return out;
  }

  return {
    setData,
    tick,
    reheat,
    positions,
    get alpha() { return alpha; },
    get linkDistance() { return linkDistance; },
    get nodeCount() { return ids.length; },
  };
}

/**
 * Scale positions to fit a cube of side `size` centred on the origin (the scene is framed on it), preserving
 * aspect. Returns a new Map; the input is unchanged.
 */
export function fitPositions(positions: Map<string, Vec3>, size = 2): Map<string, Vec3> {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of positions.values()) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const scale = size / extent;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const out = new Map();
  for (const [id, p] of positions) {
    out.set(id, { x: (p.x - cx) * scale, y: (p.y - cy) * scale, z: (p.z - cz) * scale });
  }
  return out;
}
