/**
 * The standalone export page (ui/export.html, filled in by widget.py's to_html): the graph drawn once, with no
 * widget model -- the page's DATA and OPTIONS constants (written into the template) drive it. Bundled by
 * scripts/vendor/build-esm.mjs into dist/export.js and inlined into the page after those constants, so the page
 * needs no CDN and no module files.
 */
import { Graph, Sigma, createNodeBorderProgram, circular, random, forceAtlas2 } from "./vendor-globals.ts";
import { autoLabel, computeEdgeColor, computeNodeColor, computeNodeSize, getStylingOpts, nodeDisplay } from "./styling.ts";
import { LABEL_FONT } from "./lanes.ts";
import { springLayout } from "./spring.ts";
import type { SpringNode } from "./spring.ts";
import type { GraphEdge, GraphNode, WidgetModel } from "./types.ts";

// Written into the page by the template (const DATA = {...}; const OPTIONS = {...};) before this bundle runs
declare const DATA: { nodes?: GraphNode[]; edges?: GraphEdge[] };
declare const OPTIONS: Record<string, any>;

// The page's options read like a model's traits, so the shared styling helpers work on them unchanged
const model: WidgetModel = {
  get: (key: string) => OPTIONS[key],
  set: () => {},
  save_changes: () => {},
  on: () => {},
};

// A multigraph, as in the widget: two edges between the same nodes are both drawn
const graph = new Graph({ multi: true });
const nodes = DATA.nodes || [];
const edges = DATA.edges || [];
const opts = getStylingOpts(model, nodes, edges);

/** A node's colour, ring and fill (styling.ts nodeDisplay) over the page's background */
function ringed(color: string) {
  const { fillColor } = nodeDisplay(color, OPTIONS.background || opts.palette.background);
  return { color, borderColor: color, fillColor };
}
// Graph keys are strings; the data's ids may be numbers
// The first node with an id is the one drawn (later ones with the same id are skipped), and the one its tooltip shows
const nodeByKey = new Map<string, GraphNode>();
for (const n of nodes) if (!nodeByKey.has(String(n.id))) nodeByKey.set(String(n.id), n);

nodes.forEach((node) => {
  const key = String(node.id);
  if (graph.hasNode(key)) return;
  graph.addNode(key, {
    label: autoLabel(node),
    x: node.x ?? Math.random() * 100,
    y: node.y ?? Math.random() * 100,
    size: computeNodeSize(node, opts.sizeField, opts.sizeDomain, opts.sizeRange, opts.degreeMap.get(key)),
    // Ink nodes as in the widget: the ring in the colour, the inside filled with it at 38% over the page
    ...ringed(computeNodeColor(node, opts)),
  });
});

edges.forEach((edge) => {
  let size = edge.size || 2;
  if (opts.edgeSizeField && edge[opts.edgeSizeField] !== undefined && opts.edgeSizeDomain) {
    const [min, max] = opts.edgeSizeDomain;
    const v = edge[opts.edgeSizeField];
    const t = max > min && typeof v === "number" ? (v - min) / (max - min) : 0.5;
    size = opts.edgeSizeRange[0] + t * (opts.edgeSizeRange[1] - opts.edgeSizeRange[0]);
  }
  // An edge to a node that is not in the data is skipped, as in the widget
  const source = String(edge.source), target = String(edge.target);
  if (!graph.hasNode(source) || !graph.hasNode(target)) return;
  graph.addEdge(source, target, {
    label: edge.label || "",
    size,
    color: computeEdgeColor(edge, opts),
  });
});

// --- Apply layout ---
const layoutName = OPTIONS.layout || "spring";
if (graph.order > 0) {
  switch (layoutName) {
    case "spring": {
      // The widget's default layout (spring.ts); nodes the host placed keep their x and y as a start
      const springNodes: SpringNode[] = graph.mapNodes((id, attrs) => ({ id, x: attrs.x, y: attrs.y, size: attrs.size || 8 }));
      const links: [string, string][] = graph.mapEdges((_edge, _attrs, source, target) => [source, target] as [string, string]);
      for (const [id, p] of springLayout(springNodes, links)) graph.mergeNodeAttributes(id, { x: p.x, y: p.y });
      break;
    }
    case "circular":
      circular.assign(graph);
      break;
    case "random":
      random.assign(graph);
      break;
    case "force":
      forceAtlas2.assign(graph, { iterations: 50, settings: { gravity: 1, scalingRatio: 2 } });
      break;
  }
}

// --- Create Sigma renderer ---
const container = document.getElementById("container")!;
const renderer = new Sigma(graph, container, {
  renderLabels: OPTIONS.show_labels,
  renderEdgeLabels: OPTIONS.show_edge_labels,
  defaultNodeColor: opts.palette.data[0],
  defaultEdgeColor: opts.palette.edge,
  nodeProgramClasses: {
    bordered: createNodeBorderProgram({
      borders: [
        { size: { value: 2, mode: "pixels" }, color: { attribute: "borderColor" } },
        { size: { fill: true }, color: { attribute: "fillColor" } },
      ],
    }),
  },
  defaultNodeType: "bordered",
  labelColor: { color: OPTIONS.label_color },
  labelFont: LABEL_FONT,
  labelSize: 12,
  labelWeight: "500",
  defaultEdgeType: OPTIONS.edge_arrows ? "arrow" : "line",
});

// A hovered node's label sits on a card in the page colour, outlined in the label colour (sigma's card is white)
const drawLabel = renderer.getSetting("defaultDrawNodeLabel");
renderer.setSetting("defaultDrawNodeHover", (context, data, settings) => {
  const size = settings.labelSize, padding = 2;
  context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
  context.beginPath();
  if (typeof data.label === "string" && data.label) {
    const boxWidth = Math.round(context.measureText(data.label).width + 5);
    const boxHeight = Math.round(size + 2 * padding);
    const radius = Math.max(data.size, size / 2) + padding;
    const angle = Math.asin(boxHeight / 2 / radius);
    const dx = Math.sqrt(Math.abs(radius ** 2 - (boxHeight / 2) ** 2));
    context.moveTo(data.x + dx, data.y + boxHeight / 2);
    context.lineTo(data.x + radius + boxWidth, data.y + boxHeight / 2);
    context.lineTo(data.x + radius + boxWidth, data.y - boxHeight / 2);
    context.lineTo(data.x + dx, data.y - boxHeight / 2);
    context.arc(data.x, data.y, radius, angle, -angle);
  } else {
    context.arc(data.x, data.y, data.size + padding, 0, Math.PI * 2);
  }
  context.closePath();
  context.fillStyle = OPTIONS.background;
  context.fill();
  context.globalAlpha = 0.35;
  context.strokeStyle = OPTIONS.label_color;
  context.lineWidth = 1;
  context.stroke();
  context.globalAlpha = 1;
  drawLabel(context, data, settings);
});

// --- Tooltip ---
const tooltip = document.getElementById("tooltip")!;

// Below right of the pointer, or on the other side where the tooltip would leave the window
function placeTooltip(x: number, y: number) {
  const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
  const left = x + 15 + width <= window.innerWidth ? x + 15 : x - 15 - width;
  const top = y + 15 + height <= window.innerHeight ? y + 15 : y - 15 - height;
  tooltip.style.left = Math.max(0, left) + window.scrollX + "px";
  tooltip.style.top = Math.max(0, top) + window.scrollY + "px";
}

// Sigma's pointer coordinates are relative to the graph container
function pointerOnPage(event: { x: number; y: number }): [number, number] {
  const rect = container.getBoundingClientRect();
  return [rect.left + event.x, rect.top + event.y];
}

// A tooltip row built from text: keys and values come from the data, so never from markup
function tooltipRow(key: string, value: unknown) {
  const row = document.createElement("div");
  row.className = "tooltip-row";
  const keySpan = document.createElement("span");
  keySpan.className = "tooltip-key";
  keySpan.textContent = key + ":";
  const valueSpan = document.createElement("span");
  valueSpan.textContent = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
  row.append(keySpan, valueSpan);
  return row;
}

renderer.on("enterNode", ({ node, event }) => {
  const original = nodeByKey.get(node) || ({} as GraphNode);
  const rows: HTMLElement[] = [];
  for (const [k, v] of Object.entries(original)) {
    if (k === "x" || k === "y") continue;
    let display: unknown = v;
    if (typeof v === "number") display = Number.isInteger(v) ? v : v.toFixed(3);
    if (Array.isArray(v)) display = v.join(", ");
    rows.push(tooltipRow(k, display));
  }
  if (rows.length) {
    tooltip.replaceChildren(...rows);
    tooltip.style.display = "block";
    placeTooltip(...pointerOnPage(event));
  }
});

renderer.getMouseCaptor().on("mousemovebody", (e) => {
  if (tooltip.style.display === "block") placeTooltip(...pointerOnPage(e));
});

renderer.on("leaveNode", () => {
  tooltip.style.display = "none";
});

renderer.on("enterEdge", ({ edge, event }) => {
  const attrs = graph.getEdgeAttributes(edge);
  const [source, target] = graph.extremities(edge);
  const rows = [tooltipRow("source", source), tooltipRow("target", target)];
  if (attrs.label) rows.push(tooltipRow("label", attrs.label));
  tooltip.replaceChildren(...rows);
  tooltip.style.display = "block";
  placeTooltip(...pointerOnPage(event));
});

renderer.on("leaveEdge", () => {
  tooltip.style.display = "none";
});
