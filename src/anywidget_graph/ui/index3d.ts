/**
 * The 3D view of the widget (model `view` = "3d", or Graph3D): the same toolbar, schema, settings, properties and
 * results panels as the 2D view (index.ts), but the graph canvas is the Three.js scene from canvas3d.ts: nodes and
 * edges laid out in three dimensions (force3d.ts), flown through with OrbitControls. index.ts's render mounts this
 * instead of render2D when the model says so, and re-mounts when `view` changes.
 */

import { wrapperSize } from "./size.ts";
import { mountCanvasNote } from "./states.ts";
import { withDefaults, followHostTheme, detectDark, WIDGET_FEATURES } from "./defaults.ts";
import type { WidgetModel } from "./types.ts";
import { errorText } from "./types.ts";
import { themeVariables } from "./lanes.ts";
import { createToolbar } from "./toolbar.ts";
import { createSchemaPanel } from "./schema.ts";
import { createSettingsPanel } from "./settings.ts";
import { createPropertiesPanel } from "./properties.ts";
import { createResultsDrawer } from "./results.ts";
import { createCanvas3D } from "./canvas3d.ts";
import { DARK, LIGHT } from "./palette.ts";
import { registriesFor } from "./styling.ts";
import { executeQuery } from "./query.ts";
import * as grafeoEmbedBackend from "./grafeo-embed.ts";

export function render3D({ model: host, el }: { model: WidgetModel; el: HTMLElement }): () => void {
  const model = withDefaults(host);
  const wrapper = document.createElement("div");
  wrapper.className = "awg-wrapper awg-wrapper-3d";

  // fill: take the host element's size and follow it; otherwise the fixed width and height
  function applySize() {
    // fill: the host element's size; otherwise the shared rule (size.ts): the given width and height, or the
    // cell's width at 16:10 between what the chrome needs and 80% of the screen
    for (const name of ["width", "height", "aspectRatio", "minHeight", "maxHeight"] as const) wrapper.style[name] = "";
    if (model.get("fill")) {
      Object.assign(wrapper.style, { width: "100%", height: "100%" });
    } else {
      Object.assign(wrapper.style, wrapperSize(model.get("width") || 0, model.get("height") || 0));
    }
  }
  applySize();
  model.on("change:fill", applySize);
  model.on("change:width", applySize);
  model.on("change:height", applySize);

  // Host theme: the host's colours win over the widget's light and dark defaults, as in the 2D view
  function applyHostTheme() {
    const variables = themeVariables(model.get("theme"));
    for (const [name, value] of Object.entries(variables)) wrapper.style.setProperty(name, value);
  }
  model.on("change:theme", applyHostTheme);
  applyHostTheme();

  function updateTheme() {
    wrapper.classList.toggle("awg-dark", model.get("dark_mode"));
  }

  // The page's light or dark theme, until dark_mode is a choice (same contract as the 2D view)
  const hostTheme = followHostTheme(model, () => detectDark(el));
  model.on("change:dark_mode", hostTheme.onChange);
  model.on("change:dark_mode", updateTheme);
  hostTheme.sync();
  updateTheme();

  const themeObserver = new MutationObserver(hostTheme.sync);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
  if (document.body) {
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
  }
  const paneThemeObserver = new MutationObserver(hostTheme.sync);
  paneThemeObserver.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["data-theme"] });
  const darkScheme = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const onSchemeChange = hostTheme.sync;
  darkScheme?.addEventListener("change", onSchemeChange);

  const onExecuteQuery = () => executeQuery(model);

  let canvas: ReturnType<typeof createCanvas3D> | null = null;

  // Search and schema-panel filters dim or hide in the 3D scene too (canvas is created below; the closures read it)
  const onSearch = (term: string) => canvas?.applySearch(term);
  const onFilterChange = (nodeTypes: Set<string>, edgeTypes: Set<string>) => canvas?.setTypeFilter(nodeTypes, edgeTypes);
  const onColorChange = (colorMap: Map<string, string>) => canvas?.setTypeColorOverrides(colorMap);
  const onRefreshLayout = () => canvas?.applyLayout(model.get("layout") || "spring");

  const registries = registriesFor(host);
  const palette = () => (model.get("dark_mode") ? DARK : LIGHT);
  const schema = createSchemaPanel(model, onExecuteQuery, null, onFilterChange, onColorChange, onRefreshLayout, {
    registries,
    palette,
  });
  // Label tags in Properties take the type's colour as drawn (the host's type_colors, else the palette slot)
  const properties = createPropertiesPanel(model, undefined, (label) =>
    (model.get("type_colors")?.nodes || {})[label] || registries.for("node-type").colorFor(label, palette()));
  const settings = model.get("show_settings") ? createSettingsPanel(model) : null;
  const panels = { schema, settings, properties };

  if (model.get("show_toolbar")) {
    const toolbar = createToolbar(model, onExecuteQuery, panels, onSearch);
    wrapper.appendChild(toolbar);
  }

  const content = document.createElement("div");
  content.className = "awg-content";
  content.appendChild(schema.element);

  const container = document.createElement("div");
  container.className = "awg-graph-container awg3-container";
  content.appendChild(container);
  // An empty widget or a running query says so over the canvas (states.ts)
  mountCanvasNote(container, model);

  content.appendChild(properties.element);
  if (settings) content.appendChild(settings.element);
  wrapper.appendChild(content);

  const results = createResultsDrawer(model);
  wrapper.appendChild(results.element);

  el.appendChild(wrapper);

  model.set("_features", WIDGET_FEATURES);
  model.save_changes();

  try {
    canvas = createCanvas3D(model, container, {
      onHover: () => {},
      // The same colour assignments as the 2D view of this widget
      registries: registriesFor(host),
    });
  } catch (err) {
    // No WebGL (a headless browser, a blocked GPU): say so in the pane; the cleanup below still runs
    const note = document.createElement("div");
    note.className = "awg-query-error";
    note.textContent = `The 3D view could not start: ${errorText(err)}`;
    container.appendChild(note);
  }

  // Demo mode: auto-init WASM and populate data, as in the 2D view
  if (model.get("_demo_mode")) {
    (async () => {
      try {
        const demoDataStr = model.get("_demo_data");
        if (demoDataStr && (await grafeoEmbedBackend.connect(model))) {
          await grafeoEmbedBackend.loadStatements(JSON.parse(demoDataStr), model);
        }
      } catch (err) {
        console.warn("Demo WASM init:", errorText(err));
      }
    })();
  }

  // Cleanup on destroy: a view the host re-renders (or a switch to the 2D view) leaves nothing behind
  return () => {
    model.offAll();
    themeObserver.disconnect();
    paneThemeObserver.disconnect();
    darkScheme?.removeEventListener("change", onSchemeChange);
    canvas?.cleanup();
  };
}
