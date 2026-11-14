/**
 * Settings panel component.
 */
import { panelControls, setPanelOpen } from "./panel.ts";
import { ICONS } from "./icons.ts";
import * as neo4jBackend from "./neo4j.ts";
import * as grafeoBackend from "./grafeo.ts";
import * as grafeoEmbedBackend from "./grafeo-embed.ts";
import type { Panel, WidgetModel } from "./types.ts";

// Configuration constants
const BACKENDS = [
  { id: "grafeo", name: "Grafeo", modes: ["embedded", "server", "wasm"] },
  { id: "neo4j", name: "Neo4j" },
  { id: "ladybug", name: "LadybugDB" },
  { id: "arango", name: "ArangoDB" },
  { id: "cosmosdb", name: "Azure CosmosDB" },
];

const QUERY_LANGUAGES = [
  { id: "gql", name: "GQL" },
  { id: "cypher", name: "Cypher" },
  { id: "sparql", name: "SPARQL" },
  { id: "gremlin", name: "Gremlin" },
  { id: "graphql", name: "GraphQL" },
  { id: "sql", name: "SQL/PGQ" },
  { id: "aql", name: "AQL" },
];

// Which language each non-Grafeo backend forces
const BACKEND_LANGUAGE: Record<string, string> = {
  neo4j: "cypher",
  ladybug: "cypher",
  arango: "aql",
  cosmosdb: "gremlin",
};

/**
 * Create the settings panel.
 */
export function createSettingsPanel(model: WidgetModel, callbacks?: { onClose?: () => void }): Panel {
  const panel = document.createElement("div");
  panel.className = "awg-settings-panel";

  // Header with close button
  const header = document.createElement("div");
  header.className = "awg-panel-header";
  header.innerHTML = "<span>Settings</span>";
  const closeBtn = document.createElement("button");
  closeBtn.className = "awg-btn awg-btn-icon awg-btn-sm";
  closeBtn.innerHTML = ICONS.close;
  closeBtn.title = "Close settings";
  closeBtn.addEventListener("click", () => {
    setPanelOpen(panel, false);
    callbacks?.onClose?.();
  });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Form
  const form = document.createElement("div");
  form.className = "awg-panel-form";

  // Dark mode toggle (hidden when host provides theme)
  const themeGroup = createFormGroup("Theme", () => {
      const toggle = document.createElement("label");
      toggle.className = "awg-toggle";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = model.get("dark_mode");
      checkbox.addEventListener("change", (e) => {
        model.set("dark_mode", (e.target as HTMLInputElement).checked);
        model.save_changes();
      });
      model.on("change:dark_mode", () => {
        checkbox.checked = model.get("dark_mode");
      });
      const slider = document.createElement("span");
      slider.className = "awg-toggle-slider";
      const label = document.createElement("span");
      label.className = "awg-toggle-label";
      label.textContent = "Dark mode";
      toggle.appendChild(checkbox);
      toggle.appendChild(slider);
      toggle.appendChild(label);
      return toggle;
    });
  themeGroup.classList.add("awg-theme-toggle");
  form.appendChild(themeGroup);

  // Backend selector
  const backendSelect = document.createElement("select");
  form.appendChild(
    createFormGroup("Backend", () => {
      backendSelect.className = "awg-select";
      BACKENDS.forEach((b) => {
        const opt = document.createElement("option");
        opt.value = b.id;
        opt.textContent = b.name;
        opt.selected = model.get("database_backend") === b.id;
        backendSelect.appendChild(opt);
      });
      backendSelect.addEventListener("change", (e) => {
        model.set("database_backend", (e.target as HTMLInputElement).value);
        model.save_changes();
        updateFormVisibility();
      });
      return backendSelect;
    })
  );

  // === Grafeo mode selector ===
  const grafeoModeGroup = createFormGroup("Connection Mode", () => {
    const select = document.createElement("select");
    select.className = "awg-select";
    [
      { id: "embedded", name: "Embedded (Python)" },
      { id: "server", name: "Server (HTTP)" },
      { id: "wasm", name: "WASM (Browser)" },
    ].forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name;
      opt.selected = model.get("grafeo_connection_mode") === m.id;
      select.appendChild(opt);
    });
    select.addEventListener("change", (e) => {
      model.set("grafeo_connection_mode", (e.target as HTMLInputElement).value);
      model.save_changes();
      updateFormVisibility();
    });
    model.on("change:grafeo_connection_mode", () => {
      select.value = model.get("grafeo_connection_mode");
      updateFormVisibility();
    });
    return select;
  });
  form.appendChild(grafeoModeGroup);

  // === Grafeo server fields ===
  const grafeoServerFields = document.createElement("div");
  grafeoServerFields.className = "awg-grafeo-server-fields";

  grafeoServerFields.appendChild(
    createFormGroup("Server URL", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "awg-input";
      input.placeholder = "http://localhost:7474";
      input.value = model.get("grafeo_server_url") || "http://localhost:7474";
      input.addEventListener("input", (e) => {
        model.set("grafeo_server_url", (e.target as HTMLInputElement).value);
        model.save_changes();
      });
      return input;
    })
  );

  grafeoServerFields.appendChild(
    createFormGroup("Username", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "awg-input";
      input.placeholder = "(optional)";
      input.value = model.get("connection_username") || "";
      input.addEventListener("input", (e) => {
        model.set("connection_username", (e.target as HTMLInputElement).value);
        model.save_changes();
      });
      return input;
    })
  );

  grafeoServerFields.appendChild(
    createFormGroup("Password", () => {
      const input = document.createElement("input");
      input.type = "password";
      input.className = "awg-input";
      input.value = model.get("connection_password") || "";
      input.addEventListener("input", (e) => {
        model.set("connection_password", (e.target as HTMLInputElement).value);
        model.save_changes();
      });
      return input;
    })
  );

  form.appendChild(grafeoServerFields);

  // === Neo4j fields ===
  const neo4jFields = document.createElement("div");
  neo4jFields.className = "awg-neo4j-fields";

  neo4jFields.appendChild(
    createFormGroup("URI", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "awg-input";
      input.placeholder = "neo4j+s://localhost:7687";
      input.value = model.get("connection_uri") || "";
      input.addEventListener("input", (e) => {
        model.set("connection_uri", (e.target as HTMLInputElement).value);
        model.save_changes();
      });
      return input;
    })
  );

  neo4jFields.appendChild(
    createFormGroup("Username", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "awg-input";
      input.placeholder = "neo4j";
      input.value = model.get("connection_username") || "";
      input.addEventListener("input", (e) => {
        model.set("connection_username", (e.target as HTMLInputElement).value);
        model.save_changes();
      });
      return input;
    })
  );

  neo4jFields.appendChild(
    createFormGroup("Password", () => {
      const input = document.createElement("input");
      input.type = "password";
      input.className = "awg-input";
      input.value = model.get("connection_password") || "";
      input.addEventListener("input", (e) => {
        model.set("connection_password", (e.target as HTMLInputElement).value);
        model.save_changes();
      });
      return input;
    })
  );

  form.appendChild(neo4jFields);

  // === CosmosDB fields ===
  const cosmosFields = document.createElement("div");
  cosmosFields.className = "awg-cosmos-fields";

  cosmosFields.appendChild(
    createFormGroup("Endpoint", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "awg-input";
      input.placeholder = "wss://your-account.gremlin.cosmos.azure.com:443/";
      input.value = model.get("connection_uri") || "";
      input.addEventListener("input", (e) => {
        model.set("connection_uri", (e.target as HTMLInputElement).value);
        model.save_changes();
      });
      return input;
    })
  );

  cosmosFields.appendChild(
    createFormGroup("Database", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "awg-input";
      input.placeholder = "graphdb";
      input.value = model.get("connection_database") || "";
      input.addEventListener("input", (e) => {
        model.set("connection_database", (e.target as HTMLInputElement).value);
        model.save_changes();
      });
      return input;
    })
  );

  cosmosFields.appendChild(
    createFormGroup("Container", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "awg-input";
      input.placeholder = "container1";
      input.addEventListener("input", () => {
        // Stored as part of connection config on Python side
      });
      return input;
    })
  );

  cosmosFields.appendChild(
    createFormGroup("Primary Key", () => {
      const input = document.createElement("input");
      input.type = "password";
      input.className = "awg-input";
      input.value = model.get("connection_password") || "";
      input.addEventListener("input", (e) => {
        model.set("connection_password", (e.target as HTMLInputElement).value);
        model.save_changes();
      });
      return input;
    })
  );

  form.appendChild(cosmosFields);

  // Database name (shared by multiple backends)
  const dbNameGroup = createFormGroup("Database", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "awg-input";
    input.placeholder = "default";
    input.value = model.get("connection_database") || "default";
    input.addEventListener("input", (e) => {
      model.set("connection_database", (e.target as HTMLInputElement).value);
      model.save_changes();
    });
    return input;
  });
  form.appendChild(dbNameGroup);

  // Query language selector
  const languageSelect = document.createElement("select");
  const languageGroup = createFormGroup("Language", () => {
    languageSelect.className = "awg-select";
    QUERY_LANGUAGES.forEach((lang) => {
      const opt = document.createElement("option");
      opt.value = lang.id;
      opt.textContent = lang.name;
      opt.selected = model.get("query_language") === lang.id;
      languageSelect.appendChild(opt);
    });
    languageSelect.addEventListener("change", (e) => {
      model.set("query_language", (e.target as HTMLInputElement).value);
      model.save_changes();
    });
    return languageSelect;
  });
  form.appendChild(languageGroup);

  // === 3D view (Graph3D / view="3d") ===
  const view3dGroup = document.createElement("div");
  view3dGroup.className = "awg-3d-settings";

  const viewSelect = document.createElement("select");
  const viewGroup = view3dGroup.appendChild(
    createFormGroup("View", () => {
      viewSelect.className = "awg-select";
      [
        { id: "2d", name: "2D (Sigma)" },
        { id: "3d", name: "3D (Three.js)" },
      ].forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = v.name;
        opt.selected = (model.get("view") || "2d") === v.id;
        viewSelect.appendChild(opt);
      });
      viewSelect.addEventListener("change", (e) => {
        model.set("view", (e.target as HTMLInputElement).value);
        model.save_changes();
      });
      model.on("change:view", () => {
        viewSelect.value = model.get("view") || "2d";
      });
      return viewSelect;
    })
  );
  // show_view_toggle false: a host with a fixed view keeps the 2D/3D choice out of the settings too
  if (model.get("show_view_toggle") === false) viewGroup.style.display = "none";

  // Bloom: how strongly nodes push apart in the 3D layout (force3d_repulsion)
  view3dGroup.appendChild(
    createFormGroup("3D bloom", () => {
      const wrap = document.createElement("div");
      wrap.className = "awg-range-wrap";
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "3";
      slider.step = "0.05";
      slider.value = String(model.get("force3d_repulsion") ?? 1);
      const value = document.createElement("span");
      value.className = "awg-range-value";
      value.textContent = Number(slider.value).toFixed(2);
      slider.addEventListener("input", (e) => {
        model.set("force3d_repulsion", Number((e.target as HTMLInputElement).value));
        value.textContent = Number((e.target as HTMLInputElement).value).toFixed(2);
        model.save_changes();
      });
      model.on("change:force3d_repulsion", () => {
        slider.value = String(model.get("force3d_repulsion") ?? 1);
        value.textContent = Number(slider.value).toFixed(2);
      });
      wrap.append(slider, value);
      return wrap;
    })
  );

  // Spread: rest length of an edge in the 3D layout (force3d_link_distance); empty means automatic
  view3dGroup.appendChild(
    createFormGroup("3D spread", () => {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "awg-input";
      input.placeholder = "auto";
      input.min = "1";
      input.step = "1";
      const current = model.get("force3d_link_distance");
      input.value = current === null || current === undefined ? "" : String(current);
      // On commit (enter or leaving the field), so a value is not cleared while it is being typed
      input.addEventListener("change", () => {
        const raw = input.value.trim();
        const value = Number(raw);
        // 0 or a negative rest length would collapse or invert the layout: anything but a positive number is automatic
        const next = raw !== "" && Number.isFinite(value) && value > 0 ? value : null;
        model.set("force3d_link_distance", next);
        model.save_changes();
        input.value = next === null ? "" : String(next);
      });
      model.on("change:force3d_link_distance", () => {
        const v = model.get("force3d_link_distance");
        input.value = v === null || v === undefined ? "" : String(v);
      });
      return input;
    })
  );

  for (const [label, trait] of [["3D axes", "show_axes"], ["3D grid", "show_grid"]]) {
    view3dGroup.appendChild(
      createFormGroup(label, () => {
        const toggle = document.createElement("label");
        toggle.className = "awg-toggle";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = Boolean(model.get(trait));
        checkbox.addEventListener("change", (e) => {
          model.set(trait, (e.target as HTMLInputElement).checked);
          model.save_changes();
        });
        model.on(`change:${trait}`, () => {
          checkbox.checked = Boolean(model.get(trait));
        });
        const slider = document.createElement("span");
        slider.className = "awg-toggle-slider";
        toggle.append(checkbox, slider);
        return toggle;
      })
    );
  }
  form.appendChild(view3dGroup);

  panel.appendChild(form);

  // === Connect button + status ===
  const actions = document.createElement("div");
  actions.className = "awg-panel-actions";

  const connectBtn = document.createElement("button");
  connectBtn.className = "awg-btn awg-btn-primary awg-btn-full";

  const statusIndicator = document.createElement("div");
  statusIndicator.className = "awg-connection-status";

  // Grafeo WASM status text
  const wasmStatus = document.createElement("div");
  wasmStatus.className = "awg-connection-status";
  wasmStatus.style.display = "none";

  function updateConnectButton() {
    const status = model.get("connection_status");
    const backend = model.get("database_backend");
    const mode = model.get("grafeo_connection_mode");

    if (backend === "grafeo" && mode === "embedded") {
      connectBtn.textContent = "Python Backend";
      connectBtn.disabled = true;
      statusIndicator.innerHTML =
        '<span class="awg-status-dot-inline awg-status-connected"></span> Grafeo (Embedded)';
      wasmStatus.style.display = "none";
    } else if (backend === "grafeo" && mode === "wasm") {
      wasmStatus.style.display = "block";
      if (status === "connected") {
        connectBtn.textContent = "Disconnect WASM";
        connectBtn.disabled = false;
        statusIndicator.innerHTML =
          '<span class="awg-status-dot-inline awg-status-connected"></span> WASM Ready';
        wasmStatus.textContent = "";
      } else if (status === "connecting") {
        connectBtn.textContent = "Initializing...";
        connectBtn.disabled = true;
        statusIndicator.innerHTML =
          '<span class="awg-status-dot-inline awg-status-connecting"></span> Loading WASM';
        wasmStatus.textContent = "Downloading the Grafeo WASM engine from CDN...";
      } else {
        connectBtn.textContent = "Initialize WASM";
        connectBtn.disabled = false;
        statusIndicator.innerHTML =
          '<span class="awg-status-dot-inline awg-status-disconnected"></span> Not initialized';
        wasmStatus.textContent = "";
      }
    } else if (
      backend === "grafeo" && mode === "server" ||
      backend === "neo4j"
    ) {
      wasmStatus.style.display = "none";
      if (status === "connected") {
        connectBtn.textContent = "Disconnect";
        connectBtn.disabled = false;
        statusIndicator.innerHTML =
          '<span class="awg-status-dot-inline awg-status-connected"></span> Connected';
      } else if (status === "connecting") {
        connectBtn.textContent = "Connecting...";
        connectBtn.disabled = true;
        statusIndicator.innerHTML =
          '<span class="awg-status-dot-inline awg-status-connecting"></span> Connecting';
      } else if (status === "error") {
        connectBtn.textContent = "Retry";
        connectBtn.disabled = false;
        statusIndicator.innerHTML =
          '<span class="awg-status-dot-inline awg-status-error"></span> Error';
      } else {
        connectBtn.textContent = "Connect";
        connectBtn.disabled = false;
        statusIndicator.innerHTML =
          '<span class="awg-status-dot-inline awg-status-disconnected"></span> Disconnected';
      }
    } else {
      // Python-side backends (ladybug, arango, cosmosdb)
      connectBtn.textContent = "Python Backend";
      connectBtn.disabled = true;
      wasmStatus.style.display = "none";
      statusIndicator.innerHTML = '<span class="awg-status-dot-inline awg-status-connected"></span> ';
      statusIndicator.append(BACKENDS.find((b) => b.id === backend)?.name || String(backend));
    }
  }

  function updateFormVisibility() {
    const backend = model.get("database_backend");
    const mode = model.get("grafeo_connection_mode");

    // Show/hide Grafeo mode selector
    grafeoModeGroup.style.display = backend === "grafeo" ? "flex" : "none";

    // Show/hide Grafeo server fields
    grafeoServerFields.style.display =
      backend === "grafeo" && mode === "server" ? "block" : "none";

    // Show/hide Neo4j fields
    neo4jFields.style.display = backend === "neo4j" ? "block" : "none";

    // Show/hide CosmosDB fields
    cosmosFields.style.display = backend === "cosmosdb" ? "block" : "none";

    // Show/hide database name (relevant for neo4j, grafeo-server, arango)
    const showDbName = backend === "neo4j" ||
      (backend === "grafeo" && mode === "server") ||
      backend === "arango";
    dbNameGroup.style.display = showDbName ? "flex" : "none";

    // Language auto-switching
    const forcedLang = BACKEND_LANGUAGE[backend];
    if (forcedLang) {
      // Force the language for non-Grafeo backends
      languageSelect.value = forcedLang;
      languageSelect.disabled = true;
      model.set("query_language", forcedLang);
      model.save_changes();
    } else {
      // Grafeo: all languages enabled
      languageSelect.disabled = false;
    }

    updateConnectButton();
  }

  connectBtn.addEventListener("click", async () => {
    const backend = model.get("database_backend");
    const mode = model.get("grafeo_connection_mode");
    const status = model.get("connection_status");

    if (backend === "neo4j") {
      if (status === "connected") {
        await neo4jBackend.disconnect(model);
      } else {
        await neo4jBackend.connect(
          model.get("connection_uri"),
          model.get("connection_username"),
          model.get("connection_password"),
          model
        );
      }
    } else if (backend === "grafeo" && mode === "server") {
      if (status === "connected") {
        await grafeoBackend.disconnect(model);
      } else {
        await grafeoBackend.connect(
          model.get("grafeo_server_url"),
          model.get("connection_username"),
          model.get("connection_password"),
          model
        );
      }
    } else if (backend === "grafeo" && mode === "wasm") {
      if (status === "connected") {
        await grafeoEmbedBackend.disconnect(model);
      } else {
        await grafeoEmbedBackend.connect(model);
      }
    }
  });

  model.on("change:connection_status", updateConnectButton);
  model.on("change:database_backend", updateFormVisibility);

  actions.appendChild(statusIndicator);
  actions.appendChild(wasmStatus);
  actions.appendChild(connectBtn);
  panel.appendChild(actions);

  // Error display
  const errorDiv = document.createElement("div");
  errorDiv.className = "awg-panel-error";
  function updateError() {
    const err = model.get("query_error");
    errorDiv.textContent = err || "";
    errorDiv.style.display = err ? "block" : "none";
  }
  model.on("change:query_error", updateError);
  updateError();
  panel.appendChild(errorDiv);

  // Initialize
  updateFormVisibility();

  return panelControls(panel);
}

/**
 * Create a form group with label and input.
 */
function createFormGroup(label: string, inputFn: () => Node): HTMLDivElement {
  const group = document.createElement("div");
  group.className = "awg-form-group";

  const labelEl = document.createElement("label");
  labelEl.className = "awg-label";
  labelEl.textContent = label;
  group.appendChild(labelEl);

  const control = inputFn() as HTMLElement;
  group.appendChild(control);
  // The label names its control (screen readers, and a click on it focuses the control); a toggle whose own label
  // already has text (Dark mode) keeps that name
  const field = isField(control) ? control : (control.querySelector?.("input, select, textarea") as HTMLElement | null);
  if (field && !(control.tagName === "LABEL" && control.textContent?.trim())) {
    field.id ||= `awg-field-${++fieldIds}`;
    labelEl.htmlFor = field.id;
  }
  return group;
}

let fieldIds = 0;

function isField(el: HTMLElement): boolean {
  return ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
}

/**
 * Update the status dot appearance.
 */
export function updateStatusDot(dot: HTMLElement, status: string): void {
  dot.className = "awg-status-dot awg-status-" + status;
}
