/**
 * Node labels that never cover each other. Sigma's label grid allows a number of labels per grid cell but not how
 * wide they are, so long names ran into each other. The labels sigma's grid would show are placed here in screen
 * pixels, the largest node first: on the right of the node, the left, above or below it, at the first of those where
 * the label covers no other label and no other node, or not at all. A hub (one of the most linked nodes) may cover a
 * node where no position is clear of nodes; a forced label always shows.
 */
import { BoxGrid } from "./edge-labels.ts";
import type { LabelBox } from "./edge-labels.ts";

/** Pixels between a node's rim and its label (sigma 4's label margin). */
export const NODE_LABEL_MARGIN = 5;

export type LabelSide = "right" | "left" | "above" | "below";

/** The positions a label tries, in order. */
export const LABEL_SIDES: LabelSide[] = ["right", "left", "above", "below"];

/** A node whose label may show: its centre and radius on screen, its label's size, and its own side, if any. */
export interface NodeLabelCandidate {
  key: string;
  x: number;
  y: number;
  radius: number;
  width: number;
  height: number;
  /** A label the widget always shows (hovered, selected, pulsing, a lane's chosen label): placed first, never left out. */
  forced?: boolean;
  /** One of the most linked nodes: its label may cover another node where no position is clear of nodes. */
  hub?: boolean;
  /** The side it must take (a lane's chosen label); otherwise the first free of LABEL_SIDES. */
  side?: LabelSide;
}

/** The box a node's label takes on one side of it. */
export function nodeLabelBox(node: { x: number; y: number; radius: number; width: number; height: number }, side: LabelSide): LabelBox {
  const box = { x: node.x, y: node.y, width: node.width, height: node.height, angle: 0 };
  const across = node.radius + NODE_LABEL_MARGIN + node.width / 2, along = node.radius + NODE_LABEL_MARGIN + node.height / 2;
  if (side === "right") box.x += across;
  else if (side === "left") box.x -= across;
  else if (side === "above") box.y -= along;
  else box.y += along;
  return box;
}

/**
 * The labels to draw and their sides. `candidates` in priority order (forced first, then the largest node);
 * `nodes` are the drawn nodes' boxes, each owned by its node, which its own label may cover.
 */
export function pickNodeLabels(candidates: NodeLabelCandidate[], nodes: LabelBox[]): Map<string, LabelSide> {
  const nodeGrid = new BoxGrid();
  for (const box of nodes) nodeGrid.add(box);
  const labels = new BoxGrid();
  const picked = new Map<string, LabelSide>();
  for (const candidate of candidates) {
    const sides: LabelSide[] = candidate.side ? [candidate.side] : LABEL_SIDES;
    const boxes = sides.map((side) => ({ side, box: nodeLabelBox(candidate, side) }));
    const free = boxes.filter(({ box }) => !labels.hits(box));
    const clear = free.find(({ box }) => !nodeGrid.hits(box, [candidate.key]));
    const choice = clear ?? (candidate.forced || candidate.hub ? free[0] : undefined) ?? (candidate.forced ? boxes[0] : undefined);
    if (!choice) continue;
    labels.add(choice.box);
    picked.set(candidate.key, choice.side);
  }
  return picked;
}
