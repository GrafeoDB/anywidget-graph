/**
 * The side panels (filter, properties, settings) open and close by their awg-panel-open class. A closed panel is
 * only collapsed, so it is also made inert: Tab and screen readers skip its controls.
 */
import type { Panel } from "./types.ts";

/** Open or close a side panel. */
export function setPanelOpen(panel: HTMLElement, open: boolean): void {
  panel.classList.toggle("awg-panel-open", open);
  panel.inert = !open;
}

/** The Panel controls of a side panel element; it starts closed. */
export function panelControls(panel: HTMLElement): Panel {
  setPanelOpen(panel, false);
  const isOpen = () => panel.classList.contains("awg-panel-open");
  return {
    element: panel,
    open: () => setPanelOpen(panel, true),
    close: () => setPanelOpen(panel, false),
    toggle: () => setPanelOpen(panel, !isOpen()),
    isOpen,
  };
}
