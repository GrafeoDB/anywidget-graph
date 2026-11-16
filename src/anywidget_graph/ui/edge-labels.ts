/**
 * Edge labels that keep clear of each other and of nodes and node labels (edge_label_overlap = "avoid"). Pure
 * geometry in screen pixels: the overlay (index.ts) measures what is drawn and draws the labels this places.
 */

export interface Point { x: number; y: number }

/** A box on screen: its centre, size and angle in radians (0 is level); `owner` is the node it belongs to, if any. */
export interface LabelBox { x: number; y: number; width: number; height: number; angle: number; owner?: string }

/** An edge with a label: its end nodes, their centres and radii, and the label's size. */
export interface EdgeLabelRequest {
  key: string;
  ends: [string, string];
  from: Point;
  to: Point;
  fromRadius: number;
  toRadius: number;
  width: number;
  height: number;
}

/** Where a label goes: its centre and angle (upright: never upside down). */
export interface PlacedEdgeLabel { key: string; x: number; y: number; angle: number }

/** The spots a label tries along its edge, as a share of the edge between its nodes: the middle first. */
export const EDGE_LABEL_SPOTS = [0.5, 0.35, 0.65, 0.2, 0.8];

/** The angle of a line read left to right: in (-PI/2, PI/2], so text along it is never upside down. */
export function uprightAngle(dx: number, dy: number): number {
  let angle = Math.atan2(dy, dx);
  if (angle > Math.PI / 2) angle -= Math.PI;
  else if (angle <= -Math.PI / 2) angle += Math.PI;
  return angle;
}

/** A box's four corners. */
export function boxCorners(box: LabelBox): Point[] {
  const cos = Math.cos(box.angle), sin = Math.sin(box.angle);
  const hw = box.width / 2, hh = box.height / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => ({ x: box.x + u * cos - v * sin, y: box.y + u * sin + v * cos }));
}

function project(corners: Point[], axis: Point): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const c of corners) {
    const d = c.x * axis.x + c.y * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** Whether two boxes overlap (separating axis test); boxes that only touch do not. */
export function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  const ca = boxCorners(a), cb = boxCorners(b);
  for (const angle of [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2]) {
    const axis = { x: Math.cos(angle), y: Math.sin(angle) };
    const [minA, maxA] = project(ca, axis), [minB, maxB] = project(cb, axis);
    if (maxA <= minB + 1e-9 || maxB <= minA + 1e-9) return false;
  }
  return true;
}

/** The axis-aligned extent of a box. */
function extent(box: LabelBox): { x0: number; y0: number; x1: number; y1: number } {
  const corners = boxCorners(box);
  const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Boxes in a grid of square cells, so a test looks only at boxes nearby. */
export class BoxGrid {
  private cells = new Map<string, LabelBox[]>();
  private readonly size: number;
  constructor(size = 64) {
    this.size = size;
  }

  private keys(box: LabelBox): string[] {
    const { x0, y0, x1, y1 } = extent(box);
    const keys: string[] = [];
    for (let i = Math.floor(x0 / this.size); i <= Math.floor(x1 / this.size); i++) {
      for (let j = Math.floor(y0 / this.size); j <= Math.floor(y1 / this.size); j++) keys.push(`${i},${j}`);
    }
    return keys;
  }

  add(box: LabelBox): void {
    for (const key of this.keys(box)) (this.cells.get(key) ?? this.cells.set(key, []).get(key)!).push(box);
  }

  /** Whether the box overlaps one in the grid, other than those owned by the given nodes. */
  hits(box: LabelBox, except: string[] = []): boolean {
    for (const key of this.keys(box)) {
      for (const other of this.cells.get(key) ?? []) {
        if (other.owner !== undefined && except.includes(other.owner)) continue;
        if (boxesOverlap(box, other)) return true;
      }
    }
    return false;
  }
}

/**
 * Places edge labels, in the order given, each at the first of `spots` along its edge where it covers no obstacle
 * (nodes, node labels) and no label placed before it; a label with no such spot, or longer than the edge between
 * its nodes, is left out. The edge's own end nodes (obstacles they own) are no obstacle to it: the label stays
 * between their rims anyway, and a node's box is a square around its disc.
 */
export function placeEdgeLabels(
  edges: EdgeLabelRequest[],
  obstacles: LabelBox[],
  spots: number[] = EDGE_LABEL_SPOTS,
  gap = 2,
): PlacedEdgeLabel[] {
  const grid = new BoxGrid();
  for (const box of obstacles) grid.add(box);
  const placed: PlacedEdgeLabel[] = [];
  for (const edge of edges) {
    const dx = edge.to.x - edge.from.x, dy = edge.to.y - edge.from.y;
    const length = Math.hypot(dx, dy);
    const start = edge.fromRadius + gap, end = length - edge.toRadius - gap;
    // The label lies along the edge between the node rims, or not at all
    if (length === 0 || end - start < edge.width) continue;
    const ux = dx / length, uy = dy / length;
    const angle = uprightAngle(dx, dy);
    const tried = new Set<number>();
    for (const spot of spots) {
      // The label's centre at that share of the edge, kept inside the stretch between the rims
      const along = Math.min(end - edge.width / 2, Math.max(start + edge.width / 2, start + spot * (end - start)));
      const rounded = Math.round(along);
      if (tried.has(rounded)) continue;
      tried.add(rounded);
      const box: LabelBox = { x: edge.from.x + ux * along, y: edge.from.y + uy * along, width: edge.width, height: edge.height, angle };
      if (grid.hits(box, edge.ends)) continue;
      grid.add(box);
      placed.push({ key: edge.key, x: box.x, y: box.y, angle });
      break;
    }
  }
  return placed;
}
