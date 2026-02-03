/**
 * Settings panel component.
 */
import { ICONS } from "./icons.js";
import * as neo4jBackend from "./neo4j.js";

// Configuration constants
const BACKENDS = [
  { id: "neo4j", name: "Neo4j" },
  { id: "grafeo", name: "Grafeo" },
];

const QUERY_LANGUAGES = [
  { id: "cypher", name: "Cypher", enabled: true },
  { id: "gql", name: "GQL", enabled: false },
  { id: "sparql", name: "SPARQL", enabled: false },
  { id: "gremlin", name: "Gremlin", enabled: false },
  { id: "graphql", name: "GraphQL", enabled: false },
];

/**
 * Create the settings panel.
 */
export function createSettingsPanel(model) {
  const panel = document.createElement("div");
  panel.className = "awg-settings-panel";

  // Header
  const header = document.createElement("div");
  header.className = "awg-panel-header";
  header.innerHTML = "<span>Settings</span>";
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
  form.appendChild(
    createFormGroup("Backend", () => {
      const select = document.createElement("select");
      select.className = "awg-select";
      BACKENDS.forEach((b) => {
        const opt = document.createElement("option");
        opt.value = b.id;
        opt.textContent = b.name;
        opt.selected = model.get("database_backend") === b.id;
        select.appendChild(opt);
      });
      select.addEventListener("change", (e) => {
        model.set("database_backend", e.target.value);
        model.save_changes();
        updateFormVisibility();
      });
      return select;
    })
  );

  // Neo4j fields container
  const neo4jFields = document.createElement("div");
  neo4jFields.className = "awg-neo4j-fields";

  // URI
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

  // Username
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

  // Password
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

  // Database name
  form.appendChild(
    createFormGroup("Database", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "awg-input";
      input.placeholder = "neo4j";
      input.value = model.get("connection_database") || "neo4j";
      input.addEventListener("input", (e) => {
        model.set("connection_database", e.target.value);
        model.save_changes();
      });
      return input;
    })
  );

  // Query language
  form.appendChild(
    createFormGroup("Language", () => {
      const select = document.createElement("select");
      select.className = "awg-select";
      QUERY_LANGUAGES.forEach((lang) => {
        const opt = document.createElement("option");
        opt.value = lang.id;
        opt.textContent = lang.name;
        opt.disabled = !lang.enabled;
        opt.selected = model.get("query_language") === lang.id;
        select.appendChild(opt);
      });
      select.addEventListener("change", (e) => {
        model.set("query_language", e.target.value);
        model.save_changes();
      });
      return select;
    })
  );

  panel.appendChild(form);

  // Connect button
  const actions = document.createElement("div");
  actions.className = "awg-panel-actions";

  const connectBtn = document.createElement("button");
  connectBtn.className = "awg-btn awg-btn-primary awg-btn-full";

  const statusIndicator = document.createElement("div");
  statusIndicator.className = "awg-connection-status";

  function updateConnectButton() {
    const status = model.get("connection_status");
    const backend = model.get("database_backend");

    if (backend === "grafeo") {
      connectBtn.textContent = "Python Backend";
      connectBtn.disabled = true;
      statusIndicator.innerHTML =
        '<span class="awg-status-dot-inline awg-status-connected"></span> Grafeo';
    } else if (status === "connected") {
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
  }

  function updateFormVisibility() {
    const backend = model.get("database_backend");
    neo4jFields.style.display = backend === "neo4j" ? "block" : "none";
    updateConnectButton();
  }

  connectBtn.addEventListener("click", async () => {
    const backend = model.get("database_backend");
    if (backend !== "neo4j") return;

    const status = model.get("connection_status");
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
  });

  model.on("change:connection_status", updateConnectButton);
  model.on("change:database_backend", updateFormVisibility);

  actions.appendChild(statusIndicator);
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

  return panel;
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
 * Toggle settings panel visibility.
 */
export function toggleSettingsPanel(wrapper) {
  const panel = wrapper.querySelector(".awg-settings-panel");
  if (panel) {
    panel.classList.toggle("awg-panel-open");
  }
}

/**
 * Update the status dot appearance.
 */
export function updateStatusDot(dot, status) {
  dot.className = "awg-status-dot awg-status-" + status;
}
