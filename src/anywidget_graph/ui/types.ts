// Shared types for the widget's front end: the anywidget model contract and the synced trait shapes.

/** The anywidget model contract (a host may provide exactly this). */
export interface WidgetModel {
  /** anywidget hands each view a proxy of the shared model; the host model behind them is the shared key. */
  host?: object;
  get(key: string): any;
  set(key: string, value: any): void;
  save_changes(): void;
  send?(): void;
  on(event: string, callback: (...args: any[]) => void): void;
  off?(event: string, callback: (...args: any[]) => void): void;
}

/** A synced graph node (the `nodes` trait). */
export interface GraphNode {
  id: string;
  label?: string;
  name?: string;
  labels?: string[];
  x?: number;
  y?: number;
  z?: number;
  lane?: string;
  size?: number;
  color?: string;
  [key: string]: unknown;
}

/** A synced graph edge (the `edges` trait). */
export interface GraphEdge {
  type?: string;
  cross?: boolean;
  id?: string;
  source: string;
  target: string;
  label?: string;
  size?: number;
  color?: string;
  [key: string]: unknown;
}

/** A side panel (schema, settings, properties, results): the toolbar toggles these. */
export interface Panel {
  element: HTMLElement;
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
}

/** Callbacks render() hands to the toolbar. */
export interface ToolbarCallbacks {
  onExecuteQuery?: () => void;
  onSearch?: (term: string) => void;
}

/** Read a well-known symbol key off globalThis (pages share state through Symbol.for keys). */
export function globalSymbol<T>(key: symbol): T | undefined {
  return (globalThis as Record<PropertyKey, unknown>)[key] as T | undefined;
}

/** Write a well-known symbol key onto globalThis. */
export function setGlobalSymbol(key: symbol, value: unknown): void {
  (globalThis as Record<PropertyKey, unknown>)[key] = value;
}

/** Remove a well-known symbol key from globalThis. */
export function deleteGlobalSymbol(key: symbol): void {
  delete (globalThis as Record<PropertyKey, unknown>)[key];
}

/** The message of a caught value, for `catch (error)` blocks under `useUnknownInCatchVariables`. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
