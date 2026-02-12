/**
 * Toolbar component with query input and action buttons.
 */
import { ICONS } from "./icons.js";
import { updateStatusDot } from "./settings.js";

/**
 * Create the toolbar component.
 * @param {object} panels - { schema, settings, properties } panel objects with toggle/close/isOpen
 */
export function createToolbar(model, onExecuteQuery, panels) {
  const toolbar = document.createElement("div");
  toolbar.className = "awg-toolbar";

  // Schema sidebar toggle (left)
  const schemaBtn = document.createElement("button");
  schemaBtn.className = "awg-btn";
  schemaBtn.innerHTML = ICONS.sidebar;
  schemaBtn.title = "Toggle schema browser";
  schemaBtn.addEventListener("click", () => {
    panels.schema?.toggle();
  });
  toolbar.appendChild(schemaBtn);

  // Query container (collapsible input)
  if (model.get("show_query_input")) {
    const queryContainer = document.createElement("div");
    queryContainer.className = "awg-query-container";

    const queryInput = document.createElement("input");
    queryInput.type = "text";
    queryInput.className = "awg-query-input";
    queryInput.placeholder = "Enter query (e.g., MATCH (n) RETURN n LIMIT 25)";
    queryInput.value = model.get("query") || "";

    queryInput.addEventListener("input", (e) => {
      model.set("query", e.target.value);
      model.save_changes();
    });

    queryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onExecuteQuery();
      }
    });

    model.on("change:query", () => {
      if (queryInput.value !== model.get("query")) {
        queryInput.value = model.get("query") || "";
      }
    });

    queryContainer.appendChild(queryInput);

    // Play button
    const playBtn = document.createElement("button");
    playBtn.className = "awg-btn awg-btn-primary";
    playBtn.innerHTML = ICONS.play;
    playBtn.title = "Run query";
    playBtn.addEventListener("click", () => onExecuteQuery());

    model.on("change:query_running", () => {
      playBtn.disabled = model.get("query_running");
      playBtn.innerHTML = model.get("query_running")
        ? '<span class="awg-spinner"></span>'
        : ICONS.play;
    });

    queryContainer.appendChild(playBtn);
    toolbar.appendChild(queryContainer);
  }

  // Settings button (mutual exclusion with properties)
  if (model.get("show_settings")) {
    const settingsBtn = document.createElement("button");
    settingsBtn.className = "awg-btn";
    settingsBtn.innerHTML = ICONS.settings;
    settingsBtn.title = "Connection settings";

    // Status dot
    const statusDot = document.createElement("span");
    statusDot.className = "awg-status-dot";
    updateStatusDot(statusDot, model.get("connection_status"));
    settingsBtn.appendChild(statusDot);

    model.on("change:connection_status", () => {
      updateStatusDot(statusDot, model.get("connection_status"));
    });

    settingsBtn.addEventListener("click", () => {
      // Mutual exclusion: close properties before toggling settings
      if (panels.properties?.isOpen()) {
        panels.properties.close();
      }
      panels.settings?.toggle();
    });

    toolbar.appendChild(settingsBtn);
  }

  // Properties panel toggle (right, mutual exclusion with settings)
  const propsBtn = document.createElement("button");
  propsBtn.className = "awg-btn";
  propsBtn.innerHTML = ICONS.property;
  propsBtn.title = "Toggle properties panel";
  propsBtn.addEventListener("click", () => {
    // Mutual exclusion: close settings before toggling properties
    if (panels.settings?.isOpen()) {
      panels.settings.close();
    }
    panels.properties?.toggle();
  });
  toolbar.appendChild(propsBtn);

  return toolbar;
}
