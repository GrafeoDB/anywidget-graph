/**
 * 3D force-directed layout for the 3D view (ui/canvas3d.ts): the graph's "bloom" and "spread" run in three
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
  // A rest length that is not a finite positive number (0, negative, NaN, Infinity) breaks the layout: automatic instead
  const linkDistanceOpt = typeof options.linkDistance === "number" && Number.isFinite(options.linkDistance) && options.linkDistance > 0
    ? options.linkDistance
    : null;
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
    // Each run starts from the seed, so the same data gives the same layout however often it is set
    rand = mulberry32(seed);

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
    return step(pos, vel, radius, pinned);
  }

  // The arrays as parameters, so the pair callbacks below see them as set
  function step(pos: Float64Array, vel: Float64Array, radius: Float64Array, pinned: Uint8Array): number {
    const n = ids.length;
    if (n === 0) return 0;
    alpha += (0 - alpha) * alphaDecay;
    if (alpha < alphaMin) alpha = 0;
    const a = alpha;
    if (a === 0) return 0;

    // Many-body repulsion ("bloom"): inverse-square push between pairs closer than the cutoff, found through a grid
    // of cutoff-sized cells, so a tick costs about n times the nodes near each node instead of n squared
    const k = repulsion * linkDistance * linkDistance * 0.8;
    const cutoff = linkDistance * 6;
    const cutoff2 = cutoff * cutoff;
    forEachNearPair(pos, n, cutoff, (i, j) => {
      let dx = pos[j * 3] - pos[i * 3];
      let dy = pos[j * 3 + 1] - pos[i * 3 + 1];
      let dz = pos[j * 3 + 2] - pos[i * 3 + 2];
      if (dx === 0 && dy === 0 && dz === 0) {
        // Two nodes on the same spot have no direction to push along: a tiny random one, as d3-force's jiggle
        dx = (rand() - 0.5) * 1e-6;
        dy = (rand() - 0.5) * 1e-6;
        dz = (rand() - 0.5) * 1e-6;
      }
      const d2 = dx * dx + dy * dy + dz * dz + 0.01;
      if (d2 > cutoff2) return;
      const f = (k / d2) * a;
      const inv = 1 / Math.sqrt(d2);
      const fx = dx * inv * f;
      const fy = dy * inv * f;
      const fz = dz * inv * f;
      vel[i * 3] -= fx; vel[i * 3 + 1] -= fy; vel[i * 3 + 2] -= fz;
      vel[j * 3] += fx; vel[j * 3 + 1] += fy; vel[j * 3 + 2] += fz;
    });

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

    // Collision: project overlapping spheres apart (position-level, like d3-force's collide); the grid's cells are as
    // wide as the largest pair of radii, so every overlapping pair is in neighbouring cells
    if (collision) {
      let maxRadius = 0;
      for (let i = 0; i < n; i++) maxRadius = Math.max(maxRadius, radius[i]);
      forEachNearPair(pos, n, maxRadius * 2, (i, j) => {
        const dx = pos[j * 3] - pos[i * 3];
        const dy = pos[j * 3 + 1] - pos[i * 3 + 1];
        const dz = pos[j * 3 + 2] - pos[i * 3 + 2];
        const min = radius[i] + radius[j];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= min * min || d2 === 0) return;
        const d = Math.sqrt(d2);
        const overlap = ((min - d) / d) * 0.5 * a;
        const ox = dx * overlap, oy = dy * overlap, oz = dz * overlap;
        if (!pinned[i]) { pos[i * 3] -= ox; pos[i * 3 + 1] -= oy; pos[i * 3 + 2] -= oz; }
        if (!pinned[j]) { pos[j * 3] += ox; pos[j * 3 + 1] += oy; pos[j * 3 + 2] += oz; }
      });
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
 * Calls `visit(i, j)` once for every pair of nodes (i < j) that may be closer than `cell`: the nodes are put in a
 * sparse grid of cubes of that side, and each node is paired with the nodes in its own and the 26 neighbouring cubes.
 * Pairs further apart can be visited too (the caller checks the distance); no closer pair is missed.
 */
export function forEachNearPair(pos: Float64Array, n: number, cell: number, visit: (i: number, j: number) => void): void {
  if (n < 2) return;
  const all = () => {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) visit(i, j);
  };
  if (!(cell > 0) || !Number.isFinite(cell)) return all();
  const cx = new Float64Array(n), cy = new Float64Array(n), cz = new Float64Array(n);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    cx[i] = Math.floor(pos[i * 3] / cell);
    cy[i] = Math.floor(pos[i * 3 + 1] / cell);
    cz[i] = Math.floor(pos[i * 3 + 2] / cell);
    minX = Math.min(minX, cx[i]); maxX = Math.max(maxX, cx[i]);
    minY = Math.min(minY, cy[i]); maxY = Math.max(maxY, cy[i]);
    minZ = Math.min(minZ, cz[i]); maxZ = Math.max(maxZ, cz[i]);
  }
  // A cell's key is exact while each axis spans fewer than SPAN cells (SPAN cubed stays below 2^53)
  const SPAN = 131072;
  if (!(maxX - minX < SPAN - 2 && maxY - minY < SPAN - 2 && maxZ - minZ < SPAN - 2)) return all();
  const key = (x: number, y: number, z: number) => (x - minX + 1) + SPAN * ((y - minY + 1) + SPAN * (z - minZ + 1));
  const cells = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const k = key(cx[i], cy[i], cz[i]);
    const list = cells.get(k);
    if (list) list.push(i);
    else cells.set(k, [i]);
  }
  for (let i = 0; i < n; i++) {
    for (let oz = -1; oz <= 1; oz++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const list = cells.get(key(cx[i] + ox, cy[i] + oy, cz[i] + oz));
          if (!list) continue;
          for (const j of list) if (j > i) visit(i, j);
        }
      }
    }
  }
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

/**
 * Whether a redraw keeps the positions drawn (`previous`) instead of laying the graph out again: for a Graph.append
 * batch (`appended`), and for a restyle or a removal (no node that is not drawn yet). A preset layout always places
 * the nodes where the host says, and a graph drawn for the first time is laid out.
 */
export function keepsPositions(previous: Map<string, Vec3>, keys: string[], appended: boolean, layout: string): boolean {
  if (layout === "preset" || previous.size === 0 || keys.length === 0) return false;
  return appended || keys.every((k) => previous.has(k));
}

/**
 * Positions for `keys`: a node in `previous` stays where it is; a new node goes next to the nodes it links to
 * (`links`, [source, target] pairs), at about the median length of the drawn edges (`fallbackStep` when none), each
 * in its own direction on a golden-angle spiral so nodes added around the same neighbour do not land on one another.
 * A new node linked to nothing placed goes anywhere in a ball of `radius` (`random`, Math.random by default), and
 * the new nodes linked to it gather around it.
 */
export function keepPositions(
  previous: Map<string, Vec3>,
  keys: string[],
  links: [string, string][],
  { fallbackStep, radius, random = Math.random }: { fallbackStep: number; radius: number; random?: () => number },
): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  for (const k of keys) {
    const p = previous.get(k);
    if (p) out.set(k, { ...p });
  }
  if (out.size === keys.length) return out;

  const neighbours = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = neighbours.get(from);
    if (list) list.push(to);
    else neighbours.set(from, [to]);
  };
  const lengths: number[] = [];
  for (const [s, t] of links) {
    if (s === t) continue;
    add(s, t);
    add(t, s);
    const a = out.get(s), b = out.get(t);
    if (a && b) lengths.push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  }
  lengths.sort((a, b) => a - b);
  const step = (lengths.length && lengths[Math.floor(lengths.length / 2)]) || fallbackStep;

  let pending = keys.filter((k) => !out.has(k));
  let index = 0;
  while (pending.length > 0) {
    const next: string[] = [];
    for (const k of pending) {
      const near = (neighbours.get(k) ?? []).map((n) => out.get(n)).filter((p): p is Vec3 => p !== undefined);
      if (near.length === 0) {
        next.push(k);
        continue;
      }
      let cx = 0, cy = 0, cz = 0;
      for (const p of near) { cx += p.x / near.length; cy += p.y / near.length; cz += p.z / near.length; }
      const u = 1 - 2 * ((index * 0.618034) % 1);
      const theta = index * 2.399963;
      const s = Math.sqrt(1 - u * u);
      out.set(k, { x: cx + step * s * Math.cos(theta), y: cy + step * u, z: cz + step * s * Math.sin(theta) });
      index++;
    }
    if (next.length === pending.length) {
      // Linked to nothing placed: one node anywhere in the ball the scene is framed on, then its new neighbours
      // gather around it on the next pass (a batch linked only among itself stays together)
      const [k, ...rest] = next;
      const u = random() * 2 - 1;
      const theta = random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = radius * Math.cbrt(random());
      out.set(k, { x: r * s * Math.cos(theta), y: r * u, z: r * s * Math.sin(theta) });
      pending = rest;
      continue;
    }
    pending = next;
  }
  return out;
}
