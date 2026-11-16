/**
 * How the widget and its export page set up sigma 4: what sigma draws (primitives), the settings that keep the look
 * the widget was designed with, and the shapes of what the reducers hand sigma.
 */
import { extremityArrow, layerBorder, layerPlain, pathLine, sdfCircle } from "./vendor-globals.ts";
import { LABEL_FONT, withAlpha } from "./lanes.ts";
import { nodeLabelBox, pickNodeLabels } from "./node-labels.ts";
import type { LabelBox } from "./edge-labels.ts";
import type { LabelSide, NodeLabelCandidate } from "./node-labels.ts";
import type Sigma from "sigma";
import type { EdgeDisplayData, NodeDisplayData } from "sigma/types";

/** Node labels: the label face at 12 px, weight 500 (sigma reads the weight from the font string). */
export const LABEL_SIZE = 12;
export const LABEL_WEIGHT = "500";
export const LABEL_FONT_STRING = `${LABEL_WEIGHT} ${LABEL_FONT}`;
/** Edge labels: 14 px, in the edge's colour (sigma draws them in its own sans-serif face). */
export const EDGE_LABEL_SIZE = 14;

/**
 * What sigma draws: one circle shape whose ink is a ring (borderColor, 2 px) over a fill (fillColor), both set per
 * node by the reducer; edges as lines, with an arrow head when the reducer asks for one.
 */
export const PRIMITIVES = {
  nodes: {
    shapes: [sdfCircle()],
    variables: { borderColor: { type: "color", default: "#000000" }, fillColor: { type: "color", default: "#ffffff" } },
    layers: [layerBorder({
      borders: [
        { size: 2, mode: "pixels", color: { attribute: "borderColor" } },
        { size: 0, fill: true, color: { attribute: "fillColor" } },
      ],
    })],
    label: { font: { family: LABEL_FONT, weight: LABEL_WEIGHT } },
  },
  edges: { paths: [pathLine()], extremities: [extremityArrow()], layers: [layerPlain()] },
} as const;

/**
 * Sigma 4 settings that keep sigma 3's behaviour, which the widget's look was made with: sizes in screen pixels, no
 * camera rotation, and sigma's own node drag off (the widget drags and pins nodes itself). The label grid (100 px
 * cells) is the same in both.
 */
export const SIGMA_SETTINGS = {
  itemSizesReference: "screen",
  enableCameraRotation: false,
  enableCameraMouseRotation: false,
  enableNodeDrag: false,
  // Every edge label may show, as in sigma 3 (sigma 4 shows only those of edges with a node label shown)
  edgeLabelAnchors: "allNodes",
  // A host may mount the widget in a hidden or not yet sized container (a closed panel, a tab)
  allowInvalidContainer: true,
} as const;

/** Labels per grid cell: fewer on larger graphs, to reduce clutter. */
export function labelDensityFor(nodeCount: number): number {
  return nodeCount > 200 ? 0.5 : nodeCount > 50 ? 1 : 2;
}

/** What the reducers hand sigma: its display data, plus the widget's own fields (ring and fill colours, loops, dashes). */
export type SigmaNodeDisplay = Partial<NodeDisplayData> & Record<string, unknown>;
export type SigmaEdgeDisplay = Partial<EdgeDisplayData> & Record<string, unknown>;
export type SigmaNodeReducer = (node: string, display: NodeDisplayData, attrs: Record<string, any>, state: { isHovered: boolean }) => SigmaNodeDisplay;
export type SigmaEdgeReducer = (edge: string, display: EdgeDisplayData, attrs: Record<string, any>) => SigmaEdgeDisplay;

/** Whether sigma draws an item: not when its display data says hidden, or when it has none. */
export function isHidden(display: { visibility?: string } | undefined): boolean {
  return !display || display.visibility === "hidden";
}

/**
 * A hovered node's card: the node and its label on the graph's background, outlined in the label colour at 35%
 * (sigma's own card is white with a shadow, so on a dark canvas a light label vanished on it).
 */
export function hoverCard(background: string, labelColor: string): SigmaNodeDisplay {
  return {
    backdropColor: background,
    backdropBorderColor: withAlpha(labelColor, 0.35),
    backdropBorderWidth: 1,
    backdropShadowBlur: 0,
    backdropShadowColor: "rgba(0, 0, 0, 0)",
    backdropPadding: 2,
    backdropCornerRadius: 0,
  };
}

/** A drawn node label's box on screen, as the browser tests read it. */
export interface DrawnLabelBox { node: string; label: string; x0: number; x1: number; y0: number; y1: number }

/**
 * Node labels that never cover each other (node-labels.ts places them). After each frame, the labels sigma's grid
 * would show (on screen, at least `labelRenderedSizeThreshold` px, the largest of each `labelGridCellSize` cell as
 * `labelDensity` allows) are placed in screen pixels: forced ones first, then the hubs (the about sqrt(n) / 2 most
 * linked nodes, which always try), then the largest node; a change of placement refreshes sigma, so the next frame
 * draws it. `apply` puts the placement into a node's display data in the reducer: a placed label shows at its position,
 * any other is hidden, and the hovered node's label always shows.
 */
export function labelPicker(
  renderer: Sigma,
  options: { forced?: (node: string) => boolean; side?: (node: string) => LabelSide | undefined; enabled?: () => boolean } = {},
) {
  const graph = renderer.getGraph();
  const measure = document.createElement("canvas").getContext("2d");
  let placed: Map<string, LabelSide> | null = null;
  let signature = "";

  function labelSize(text: string): { width: number; height: number } {
    if (measure) measure.font = `${LABEL_WEIGHT} ${LABEL_SIZE}px ${LABEL_FONT}`;
    return { width: (measure ? measure.measureText(text).width : text.length * 7.2) + 4, height: LABEL_SIZE + 4 };
  }

  function update(): void {
    const enabled = (options.enabled?.() ?? true) && renderer.getSetting("renderLabels");
    if (!enabled) {
      if (placed) {
        placed = null;
        signature = "";
        renderer.scheduleRefresh();
      }
      return;
    }
    const { width, height } = renderer.getDimensions();
    const threshold = renderer.getSetting("labelRenderedSizeThreshold");
    const nodes: LabelBox[] = [];
    const candidates: (NodeLabelCandidate & { degree: number })[] = [];
    graph.forEachNode((node) => {
      const shown = renderer.getNodeDisplayData(node);
      if (!shown || isHidden(shown)) return;
      const at = renderer.framedGraphToViewport(shown);
      const radius = renderer.scaleSize(shown.size);
      // A node's box: the square inside its disc, a little larger (labels may graze a disc's edge, not cross it)
      nodes.push({ x: at.x, y: at.y, width: 1.6 * radius, height: 1.6 * radius, angle: 0, owner: node });
      if (!shown.label) return;
      if (at.x < -radius - 200 || at.x > width + radius || at.y < -radius - 20 || at.y > height + radius + 20) return;
      const forced = options.forced?.(node) ?? false;
      if (!forced && radius < threshold) return;
      candidates.push({ key: node, x: at.x, y: at.y, radius, ...labelSize(shown.label), forced, side: options.side?.(node), degree: graph.degree(node) });
    });
    candidates.sort((a, b) => Number(b.forced) - Number(a.forced) || b.radius - a.radius || b.degree - a.degree || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    // The hubs: the most linked nodes by size, then degree (sigma sizes nodes by degree unless the host sizes them)
    const hubs = Math.max(3, Math.round(Math.sqrt(graph.order) / 2));
    candidates.filter((c) => !c.forced).slice(0, hubs).forEach((c) => (c.hub = true));
    // Sigma's label grid: per cell, as many of the largest labels as its density allows at this zoom
    const cell = renderer.getSetting("labelGridCellSize");
    const ratio = renderer.getCamera().getState().ratio;
    const perCell = Math.ceil(renderer.getSetting("labelDensity") / (ratio * ratio));
    const inCell = new Map<string, number>();
    const allowed = candidates.filter((c) => {
      const key = `${Math.floor(c.x / cell)},${Math.floor(c.y / cell)}`;
      const count = (inCell.get(key) ?? 0) + 1;
      inCell.set(key, count);
      return c.forced || c.hub || count <= perCell;
    });
    const next = pickNodeLabels(allowed, nodes);
    const nextSignature = [...next].map(([node, side]) => `${node}:${side}`).join("|");
    placed = next;
    if (nextSignature !== signature) {
      signature = nextSignature;
      renderer.scheduleRefresh();
    }
  }

  function apply(node: string, out: SigmaNodeDisplay, isHovered: boolean): void {
    if (!placed || isHovered || out.visibility === "hidden" || !out.label) return;
    const side = placed.get(node);
    if (side) {
      out.labelVisibility = "visible";
      out.labelPosition = side;
    } else {
      out.labelVisibility = "hidden";
    }
  }

  /** The boxes of the node labels sigma drew in the last frame. */
  function drawnBoxes(): DrawnLabelBox[] {
    return [...renderer.getNodeDisplayedLabels()].map((node) => {
      const shown = renderer.getNodeDisplayData(node)!;
      const at = renderer.framedGraphToViewport(shown);
      const size = labelSize(shown.label || "");
      const side = (["left", "above", "below"] as const).find((s) => s === shown.labelPosition) ?? "right";
      const box = nodeLabelBox({ x: at.x, y: at.y, radius: renderer.scaleSize(shown.size), ...size }, side);
      return { node, label: shown.label || "", x0: box.x - box.width / 2, x1: box.x + box.width / 2, y0: box.y - box.height / 2, y1: box.y + box.height / 2 };
    });
  }

  return { update, apply, drawnBoxes, labelSize };
}
