/**
 * The standalone export page of the 3D view (ui/export3d.html, filled in by widget.py's to_html when `view` is "3d"):
 * the widget's Three.js canvas (canvas3d.ts) on a model that lives in the page. The page's DATA and OPTIONS constants
 * (written into the template) are its traits; a change made on the page (a selection, the selection mode) is kept
 * there and reported to the canvas as the widget's model would, so orbiting, hovering and selecting work offline.
 * Bundled by scripts/vendor/build-esm.mjs into dist/export3d.js and inlined after those constants.
 */
import { createCanvas3D } from "./canvas3d.ts";
import { themeVariables } from "./lanes.ts";
import type { GraphEdge, GraphNode, WidgetModel } from "./types.ts";

// Written into the page by the template (const DATA = {...}; const OPTIONS = {...};) before this bundle runs
declare const DATA: { nodes?: GraphNode[]; edges?: GraphEdge[] };
declare const OPTIONS: Record<string, any>;

const values: Record<string, any> = { ...OPTIONS, nodes: DATA.nodes || [], edges: DATA.edges || [] };
const listeners = new Map<string, Set<(...args: any[]) => void>>();

const model: WidgetModel = {
  get: (key: string) => values[key],
  set: (key: string, value: any) => {
    if (values[key] === value) return;
    values[key] = value;
    for (const callback of listeners.get(`change:${key}`) ?? []) callback();
  },
  save_changes: () => {},
  on: (event: string, callback: (...args: any[]) => void) => {
    const set = listeners.get(event) ?? new Set();
    set.add(callback);
    listeners.set(event, set);
  },
  off: (event: string, callback: (...args: any[]) => void) => {
    listeners.get(event)?.delete(callback);
  },
};

const wrapper = document.getElementById("wrapper")!;
wrapper.classList.toggle("awg-dark", Boolean(OPTIONS.dark_mode));
// A host theme's colours win over the light and dark defaults, as in the widget
for (const [name, value] of Object.entries(themeVariables(OPTIONS.theme))) wrapper.style.setProperty(name, value);
createCanvas3D(model, document.getElementById("container")!);
