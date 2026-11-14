/**
 * What the canvas says when it has nothing to draw (the 2D and the 3D view): an empty widget says how to fill it,
 * a running query says so. Over a graph, over lanes, or while the query banner shows an error or a note, it is
 * quiet: the banner speaks.
 */
import type { WidgetModel } from "./types.ts";

export const EMPTY_NOTE = "Nothing to show yet. Run a query, or pass nodes and edges from Python.";
export const RUNNING_NOTE = "Running query…";

/** The canvas's note for the model's state, or "" for none. */
export function canvasNote(model: WidgetModel): string {
  if (model.get("query_running")) return RUNNING_NOTE;
  if (model.get("query_error") || model.get("query_note")) return "";
  if ((model.get("nodes") ?? []).length > 0 || (model.get("lanes") ?? []).length > 0) return "";
  return EMPTY_NOTE;
}

/** Show the note centred over `container`, following the model. */
export function mountCanvasNote(container: HTMLElement, model: WidgetModel): void {
  const note = document.createElement("div");
  note.className = "awg-canvas-note";
  note.setAttribute("role", "status");
  const update = () => {
    const text = canvasNote(model);
    note.textContent = text;
    note.classList.toggle("awg-canvas-note-running", text === RUNNING_NOTE);
    note.style.display = text ? "" : "none";
  };
  for (const name of ["nodes", "lanes", "query_running", "query_error", "query_note"]) model.on(`change:${name}`, update);
  update();
  container.appendChild(note);
}
