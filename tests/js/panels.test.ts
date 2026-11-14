// Panels show node and edge data as text, never as markup. Run with: node --test tests/js/*.test.ts
// Node has no DOM, so a small fake stands in: it records every innerHTML write
// (where markup would be parsed) and keeps textContent as plain text.
import assert from "node:assert/strict";
import { test } from "node:test";

const htmlWrites: string[] = [];

class FakeText {
  textContent: string;
  constructor(text: string) {
    this.textContent = text;
  }
}

class FakeElement {
  tagName: string;
  className = "";
  children: (FakeElement | FakeText)[] = [];
  title = "";
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  style: any = { setProperty(k: string, v: string) { (this as any)[k] = v; } };
  listeners?: Record<string, ((event: any) => void)[]>;
  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }
  appendChild<T>(child: T): T {
    this.children.push(child as FakeElement);
    return child;
  }
  append(...nodes: (FakeElement | FakeText | string)[]) {
    nodes.forEach((n) => this.appendChild(typeof n === "string" ? new FakeText(n) : n));
  }
  attrs: Record<string, string> = {};
  setAttribute(name: string, value: string) {
    this.attrs[name] = String(value);
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  addEventListener(type: string, listener: (event: any) => void) {
    (this.listeners ??= {})[type] = [...(this.listeners?.[type] || []), listener];
  }
  click() {
    (this.listeners?.click || []).forEach((listener) => listener({ preventDefault() {}, stopPropagation() {} }));
  }
  set innerHTML(html: string) {
    htmlWrites.push(html);
    this.children = [];
  }
  set textContent(text: string) {
    this.children = [new FakeText(String(text))];
  }
  get textContent() {
    return this.children.map((c) => c.textContent).join("");
  }
  descendants(): FakeElement[] {
    return this.children.flatMap((c) => (c instanceof FakeElement ? [c, ...c.descendants()] : []));
  }
}

globalThis.document = {
  createElement: (tag: string): any => new FakeElement(tag),
  createTextNode: (text: string): any => new FakeText(text),
} as unknown as Document;

const { renderNodeProperties, renderEdgeProperties } = await import("../../src/anywidget_graph/ui/properties.ts");
const { createFilterItem, createSchemaPanel, FILTER_PAGE } = await import("../../src/anywidget_graph/ui/schema.ts");

const HOSTILE = {
  id: "<img src=x onerror=alert(1)>",
  label: "<b>x</b>",
  name: "<script>bad()</script>",
  path: "<svg onload=bad()>",
};

function assertShownAsText(panel: FakeElement, values: string[]) {
  const leaked = htmlWrites.filter((html) => values.some((v) => html.includes(v)));
  assert.deepEqual(leaked, [], "no data value reaches innerHTML");
  const tags = panel.descendants().map((el) => el.tagName);
  for (const tag of ["IMG", "B", "SCRIPT"]) assert.ok(!tags.includes(tag), `no ${tag} element`);
  for (const value of values) assert.ok(panel.textContent.includes(value), `shows ${value} literally`);
}

test("node properties show hostile ids, labels, keys and values as text", () => {
  htmlWrites.length = 0;
  const panel = document.createElement("div");
  const node = { id: HOSTILE.id, labels: [HOSTILE.label], name: HOSTILE.name, path: HOSTILE.path, [HOSTILE.label]: 1 };
  renderNodeProperties(panel as unknown as HTMLElement, node);
  assertShownAsText(panel as unknown as FakeElement, Object.values(HOSTILE));
});

test("edge properties show hostile types, endpoints, keys and values as text", () => {
  htmlWrites.length = 0;
  const panel = document.createElement("div");
  const edge = { source: HOSTILE.id, target: HOSTILE.path, edgeType: HOSTILE.label, name: HOSTILE.name, [HOSTILE.path]: 1 };
  renderEdgeProperties(panel as unknown as HTMLElement, edge);
  assertShownAsText(panel as unknown as FakeElement, Object.values(HOSTILE));
});

test("a filter item shows hostile type and property names as text", () => {
  htmlWrites.length = 0;
  const item = createFilterItem({
    name: HOSTILE.label, count: 1, total: 1, color: "#000000", kind: "node",
    properties: [HOSTILE.name, HOSTILE.path], isHidden: false,
    onToggle() {}, onColorChange() {}, onQuery() {},
  });
  assertShownAsText(item as unknown as FakeElement, [HOSTILE.label, HOSTILE.name, HOSTILE.path]);
});

test("a large schema shows its first types per section, and \"Show more\" shows the rest", () => {
  const nodes = Array.from({ length: FILTER_PAGE + 30 }, (_, i) => ({ id: `n${i}`, labels: [`Type${i}`] }));
  const values: Record<string, any> = { nodes, edges: [], schema_node_types: [], schema_edge_types: [], type_colors: {}, totals: {} };
  const model = { get: (k: string) => values[k], set: (k: string, v: any) => { values[k] = v; }, on() {}, save_changes() {} };
  const panel = createSchemaPanel(model, () => {}, null, () => {}, () => {}, () => {});
  const items = () => (panel.element as unknown as FakeElement).descendants().filter((el) => el.className.split(" ")[0] === "awg-schema-item");
  const more = () => (panel.element as unknown as FakeElement).descendants().find((el) => el.className === "awg-filter-more");
  assert.equal(items().length, FILTER_PAGE);
  assert.equal(more()!.textContent, "Show 30 more");
  more()!.click();
  assert.equal(items().length, FILTER_PAGE + 30);
  assert.equal(more(), undefined);
});

test("filter swatches show the colours the canvas draws, even when the panel is built first", async () => {
  const { Registries } = await import("../../src/anywidget_graph/ui/styling.ts");
  const { LIGHT } = await import("../../src/anywidget_graph/ui/palette.ts");
  const nodes = [
    { id: "a", labels: ["Person"] }, { id: "b", labels: ["Person"] }, { id: "c", labels: ["Person"] },
    { id: "d", labels: ["Company"] }, { id: "e", labels: ["Company"] }, { id: "f", labels: ["City"] },
  ];
  const values: Record<string, any> = { nodes, edges: [], schema_node_types: [], schema_edge_types: [], type_colors: {}, totals: {} };
  const model = { get: (k: string) => values[k], set: (k: string, v: any) => { values[k] = v; }, on() {}, save_changes() {} };
  const registries = new Registries();
  const panel = createSchemaPanel(model, () => {}, null, () => {}, () => {}, () => {}, { registries, palette: () => LIGHT });
  const swatch = (name: string) => {
    const item = (panel.element as unknown as FakeElement).descendants()
      .find((el) => el.className.split(" ")[0] === "awg-schema-item" && el.textContent.includes(name))!;
    return (item.descendants().find((el) => el.className === "awg-filter-color-picker") as any).value;
  };
  assert.equal(swatch("Person"), LIGHT.data[0]);
  assert.equal(swatch("Company"), LIGHT.data[1]);
  assert.equal(swatch("City"), LIGHT.data[2]);
  // The canvas reads the same registry afterwards and gets the same slots
  assert.equal(registries.for("node-type").slot("Company"), 1);
});

test("node properties show each label in its type colour, and the header dot in the first label's colour", () => {
  const panel = document.createElement("div") as unknown as FakeElement;
  const colorOf = (label: string) => ({ Person: "#5c93d9", Admin: "#d9825c" })[label] ?? "#8a918d";
  renderNodeProperties(panel as unknown as HTMLElement, { id: "p1", labels: ["Person", "Admin"] }, colorOf);
  const tags = panel.descendants().filter((el) => el.className === "awg-label-tag");
  assert.deepEqual(tags.map((el) => el.style["--awg-tag"]), ["#5c93d9", "#d9825c"]);
  const header = panel.descendants().find((el) => el.className === "awg-properties-header")!;
  assert.equal(header.style["--awg-tag"], "#5c93d9");
});

test("filter swatches follow a theme switch", async () => {
  const { Registries } = await import("../../src/anywidget_graph/ui/styling.ts");
  const { LIGHT, DARK } = await import("../../src/anywidget_graph/ui/palette.ts");
  const handlers = new Map<string, (() => void)[]>();
  const values: Record<string, any> = {
    nodes: [{ id: "a", labels: ["Person"] }], edges: [], schema_node_types: [], schema_edge_types: [], type_colors: {}, totals: {}, dark_mode: false,
  };
  const model = {
    get: (k: string) => values[k],
    set: (k: string, v: any) => { values[k] = v; for (const h of handlers.get(`change:${k}`) ?? []) h(); },
    on: (e: string, h: () => void) => handlers.set(e, [...(handlers.get(e) ?? []), h]),
    save_changes() {},
  };
  const panel = createSchemaPanel(model, () => {}, null, () => {}, () => {}, () => {}, {
    registries: new Registries(), palette: () => (values.dark_mode ? DARK : LIGHT),
  });
  const swatch = () => ((panel.element as unknown as FakeElement).descendants().find((el) => el.className === "awg-filter-color-picker") as any).value;
  assert.equal(swatch(), LIGHT.data[0]);
  model.set("dark_mode", true);
  assert.equal(swatch(), DARK.data[0]);
});

test("show_view_toggle false: the toolbar has no 2D/3D switch", async () => {
  const { createToolbar } = await import("../../src/anywidget_graph/ui/toolbar.ts");
  const make = (values: Record<string, any>) => {
    const model = { get: (k: string) => values[k], set() {}, on() {}, save_changes() {} };
    return createToolbar(model as any, () => {}, {}) as unknown as FakeElement;
  };
  const titles = (el: FakeElement) => el.descendants().map((d) => d.title);
  assert.ok(titles(make({ show_view_toggle: true, nodes: [], edges: [] })).some((t) => /3D/.test(t)));
  assert.ok(!titles(make({ show_view_toggle: false, nodes: [], edges: [] })).some((t) => /3D|2D/.test(t)));
});
