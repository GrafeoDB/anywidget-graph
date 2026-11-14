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
  /** Tag selectors only ("input, select"), enough for the panels */
  querySelector(selector: string): FakeElement | null {
    const tags = selector.split(",").map((s) => s.trim().toUpperCase());
    return this.descendants().find((el) => tags.includes(el.tagName)) ?? null;
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

test("the Unlabeled group takes no colour slot, and its swatch is the Other colour its nodes are drawn in", async () => {
  const { Registries, computeNodeColor, getStylingOpts } = await import("../../src/anywidget_graph/ui/styling.ts");
  const { LIGHT } = await import("../../src/anywidget_graph/ui/palette.ts");
  const nodes = [{ id: "p1", labels: ["Person"] }, { id: "p2", labels: ["Person"] }, { id: "c1", labels: ["Company"] }, { id: "u1" }, { id: "u2" }, { id: "u3" }];
  const values: Record<string, any> = { nodes, edges: [], schema_node_types: [], schema_edge_types: [], type_colors: {}, totals: {}, dark_mode: false };
  const model = { get: (k: string) => values[k], set() {}, on() {}, save_changes() {} };
  const registries = new Registries();
  const panel = createSchemaPanel(model, () => {}, null, () => {}, () => {}, () => {}, { registries, palette: () => LIGHT });
  const swatch = (name: string) => ((panel.element as unknown as FakeElement).descendants().find((el) => el.title === `Change color for ${name}`) as any).value;
  assert.equal(swatch("Unlabeled"), LIGHT.other);
  assert.equal(swatch("Person"), LIGHT.data[0]);
  assert.equal(swatch("Company"), LIGHT.data[1]);
  // The canvas draws an untyped node in the same colour, and the next new type takes the next slot
  const opts = getStylingOpts(model as any, nodes as any, [], registries);
  assert.equal(computeNodeColor(nodes[3] as any, opts), swatch("Unlabeled"));
  registries.for("node-type").assign(new Map([["Movie", 1]]));
  assert.equal(registries.for("node-type").colorFor("Movie", LIGHT), LIGHT.data[2]);
});

test("Properties label tags follow a theme switch", async () => {
  const { createPropertiesPanel } = await import("../../src/anywidget_graph/ui/properties.ts");
  const handlers = new Map<string, (() => void)[]>();
  const values: Record<string, any> = { selected_node: { id: "p1", labels: ["Person"] }, selected_edge: null, dark_mode: false };
  const model = {
    get: (k: string) => values[k],
    set: (k: string, v: any) => { values[k] = v; for (const h of handlers.get(`change:${k}`) ?? []) h(); },
    on: (e: string, h: () => void) => handlers.set(e, [...(handlers.get(e) ?? []), h]),
    save_changes() {},
  };
  const panel = createPropertiesPanel(model as any, undefined, () => (values.dark_mode ? "#dark00" : "#light0"));
  const tag = () => (panel.element as unknown as FakeElement).descendants().find((el) => el.className === "awg-label-tag")!.style["--awg-tag"];
  assert.equal(tag(), "#light0");
  model.set("dark_mode", true);
  assert.equal(tag(), "#dark00");
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

test("a closed side panel is inert, so Tab and screen readers skip its controls", async () => {
  const { panelControls } = await import("../../src/anywidget_graph/ui/panel.ts");
  const el = new FakeElement("div") as any;
  const classes = new Set<string>();
  el.classList = { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)), contains: (c: string) => classes.has(c) };
  const panel = panelControls(el);
  assert.equal(el.inert, true, "starts closed");
  panel.open();
  assert.deepEqual([el.inert, panel.isOpen()], [false, true]);
  panel.toggle();
  assert.deepEqual([el.inert, panel.isOpen()], [true, false]);
  // The panels' own close buttons close them the same way
  const { createPropertiesPanel } = await import("../../src/anywidget_graph/ui/properties.ts");
  const props = createPropertiesPanel({ get: () => null, set() {}, on() {}, save_changes() {} } as any);
  props.open();
  assert.equal((props.element as any).inert, false);
  (props.element as unknown as FakeElement).descendants().find((d) => d.title === "Close properties")!.click();
  assert.equal((props.element as any).inert, true);
});

test("every settings control has an accessible name", async () => {
  const { createSettingsPanel } = await import("../../src/anywidget_graph/ui/settings.ts");
  const panel = createSettingsPanel({ get: () => undefined, set() {}, on() {}, save_changes() {} } as any).element as unknown as FakeElement;
  const all = panel.descendants();
  const labelled = new Set(all.filter((el) => el.tagName === "LABEL" && (el as any).htmlFor).map((el) => (el as any).htmlFor));
  // A toggle's own label with text (Dark mode) names its checkbox
  const wrapped = new Set(all.filter((el) => el.tagName === "LABEL" && el.textContent.trim()).flatMap((el) => el.descendants()));
  const fields = all.filter((el) => ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName));
  assert.ok(fields.length >= 10);
  for (const field of fields) {
    const named = (field as any).id && labelled.has((field as any).id);
    assert.ok(named || wrapped.has(field), `${field.tagName} ${(field as any).type ?? ""} ${(field as any).placeholder ?? ""} has a name`);
  }
});

test("a filter row's type name is a button that runs the type query", () => {
  let queried = 0;
  const item = createFilterItem({ name: "Person", count: 3, kind: "node", color: "#000000", isHidden: false, onToggle() {}, onQuery: () => { queried++; } }) as unknown as FakeElement;
  const name = item.descendants().find((el) => el.className === "awg-schema-name")!;
  assert.equal(name.tagName, "BUTTON");
  assert.equal(name.title, "Query Person");
  name.click();
  assert.equal(queried, 1);
});
