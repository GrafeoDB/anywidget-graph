/**
 * Settings panel component.
 */
import { ICONS } from "./icons.js";
import * as neo4jBackend from "./neo4j.js";
import * as grafeoBackend from "./grafeo.js";
import * as grafeoEmbedBackend from "./grafeo-embed.js";

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
  { id: "aql", name: "AQL" },
];

// Which language each non-Grafeo backend forces
const BACKEND_LANGUAGE = {
  neo4j: "cypher",
  ladybug: "cypher",
  arango: "aql",
  cosmosdb: "gremlin",
};

/**
 * Create the settings panel.
 */
export function createSettingsPanel(model, callbacks) {
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
    panel.classList.remove("awg-panel-open");
    callbacks?.onClose?.();
  });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Form
  const form = document.createElement("div");
  form.className = "awg-panel-form";

  // Dark mode toggle
  form.appendChild(
    createFormGroup("Theme", () => {
      const toggle = document.createElement("label");
      toggle.className = "awg-toggle";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = model.get("dark_mode");
      checkbox.addEventListener("change", (e) => {
        model.set("dark_mode", e.target.checked);
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
    })
  );

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
        model.set("database_backend", e.target.value);
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
      model.set("grafeo_connection_mode", e.target.value);
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
        model.set("grafeo_server_url", e.target.value);
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
        model.set("connection_username", e.target.value);
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
        model.set("connection_password", e.target.value);
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
        model.set("connection_uri", e.target.value);
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
        model.set("connection_username", e.target.value);
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
        model.set("connection_password", e.target.value);
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
        model.set("connection_uri", e.target.value);
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
        model.set("connection_database", e.target.value);
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
      input.addEventListener("input", (e) => {
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
        model.set("connection_password", e.target.value);
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
      model.set("connection_database", e.target.value);
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
      model.set("query_language", e.target.value);
      model.save_changes();
    });
    return languageSelect;
  });
  form.appendChild(languageGroup);

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
        wasmStatus.textContent = "Downloading @grafeo-db/web from CDN...";
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
      statusIndicator.innerHTML =
        '<span class="awg-status-dot-inline awg-status-connected"></span> ' +
        (BACKENDS.find((b) => b.id === backend)?.name || backend);
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

  return {
    element: panel,
    open: () => panel.classList.add("awg-panel-open"),
    close: () => panel.classList.remove("awg-panel-open"),
    toggle: () => panel.classList.toggle("awg-panel-open"),
    isOpen: () => panel.classList.contains("awg-panel-open"),
  };
}

/**
 * Create a form group with label and input.
 */
function createFormGroup(label, inputFn) {
  const group = document.createElement("div");
  group.className = "awg-form-group";

  const labelEl = document.createElement("label");
  labelEl.className = "awg-label";
  labelEl.textContent = label;
  group.appendChild(labelEl);

  group.appendChild(inputFn());
  return group;
}

/**
 * Update the status dot appearance.
 */
export function updateStatusDot(dot, status) {
  dot.className = "awg-status-dot awg-status-" + status;
}
