// Shared types for the widget's front end: the anywidget model contract and the synced trait shapes.

/** The anywidget model contract (a host may provide exactly this). */
export interface WidgetModel {
  /** anywidget hands each view a proxy of the shared model; the host model behind them is the shared key. */
  host?: object;
  get(key: string): any;
  set(key: string, value: any): void;
  save_changes(): void;
  send?(...args: any[]): void;
  on(event: string, callback: (...args: any[]) => void): void;
  off?(event: string, callback: (...args: any[]) => void): void;
}

/** A node or edge id as a host sends it: text, or a number (an engine id, a pandas index). */
export type ItemId = string | number;

/** A synced graph node (the `nodes` trait). */
export interface GraphNode {
  id: ItemId;
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
  id?: ItemId;
  source: ItemId;
  target: ItemId;
  label?: string;
  size?: number;
  color?: string;
  [key: string]: unknown;
}

/** A node as the widget draws it: its id as text, the key graphology and every lookup use. */
export type DrawnNode = GraphNode & { id: string };

/** An edge as the widget draws it: its ends (and id) as text. */
export type DrawnEdge = GraphEdge & { id?: string; source: string; target: string };

/** A host's node with its id as text; the node itself when it already is (most data), else a copy. */
export function drawnNode(node: GraphNode): DrawnNode {
  return typeof node.id === "string" ? (node as DrawnNode) : { ...node, id: String(node.id) };
}

/** A host's edge with its ends (and id) as text; the edge itself when they already are, else a copy. */
export function drawnEdge(edge: GraphEdge): DrawnEdge {
  const idText = edge.id === undefined || edge.id === null || typeof edge.id === "string";
  if (typeof edge.source === "string" && typeof edge.target === "string" && idText) return edge as DrawnEdge;
  const copy = { ...edge, source: String(edge.source), target: String(edge.target) } as DrawnEdge;
  if (edge.id !== undefined && edge.id !== null) copy.id = String(edge.id);
  return copy;
}

/** Ids from a host (a selection, pulse_nodes, a removal) as text; anything but a list gives none. */
export function idTexts(ids: unknown): string[] {
  return Array.isArray(ids) ? ids.filter((id) => id !== null && id !== undefined).map(String) : [];
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
