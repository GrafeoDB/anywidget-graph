// Panels show node and edge data as text, never as markup. Run with: node --test "tests/js/*.test.mjs"
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
  style: Record<string, string> = {};
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
