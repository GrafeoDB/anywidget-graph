/**
 * The 3D view of the widget (model `view` = "3d", or Graph3D): the same toolbar, schema, settings, properties and
 * results panels as the 2D view (index.ts), but the graph canvas is the Three.js scene from canvas3d.ts: nodes and
 * edges laid out in three dimensions (force3d.ts), flown through with OrbitControls. index.ts's render mounts this
 * instead of render2D when the model says so, and re-mounts when `view` changes.
 */

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
import { executeQuery } from "./query.ts";
import * as grafeoEmbedBackend from "./grafeo-embed.ts";

export function render3D({ model: host, el }: { model: WidgetModel; el: HTMLElement }): () => void {
  const model = withDefaults(host);
  const wrapper = document.createElement("div");
  wrapper.className = "awg-wrapper awg-wrapper-3d";

  // fill: take the host element's size and follow it; otherwise the fixed width and height
  function applySize() {
    const fill = model.get("fill");
    wrapper.style.width = fill ? "100%" : model.get("width") + "px";
    wrapper.style.height = fill ? "100%" : model.get("height") + "px";
    wrapper.style.maxHeight = fill ? "" : model.get("height") + "px";
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

  const schema = createSchemaPanel(model, onExecuteQuery, null, onFilterChange, onColorChange, onRefreshLayout);
  const properties = createPropertiesPanel(model);
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

  content.appendChild(properties.element);
  if (settings) content.appendChild(settings.element);
  wrapper.appendChild(content);

  const results = createResultsDrawer(model);
  wrapper.appendChild(results.element);

  el.appendChild(wrapper);

  model.set("_features", WIDGET_FEATURES);
  model.save_changes();

  canvas = createCanvas3D(model, container, {
    onHover: () => {},
  });

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
