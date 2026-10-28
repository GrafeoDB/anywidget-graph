// Panels show node and edge data as text, never as markup. Run with: node --test "tests/js/*.test.mjs"
// Node has no DOM, so a small fake stands in: it records every innerHTML write
// (where markup would be parsed) and keeps textContent as plain text.
import assert from "node:assert/strict";
import { test } from "node:test";

const htmlWrites = [];

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.children = [];
    this.title = "";
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    this.style = {};
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    nodes.forEach((n) => this.appendChild(typeof n === "string" ? new FakeText(n) : n));
  }
  addEventListener(type, listener) {
    (this.listeners ??= {})[type] = [...(this.listeners?.[type] || []), listener];
  }
  click() {
    (this.listeners?.click || []).forEach((listener) => listener({ preventDefault() {}, stopPropagation() {} }));
  }
  set innerHTML(html) {
    htmlWrites.push(html);
    this.children = [];
  }
  set textContent(text) {
    this.children = [new FakeText(String(text))];
  }
  get textContent() {
    return this.children.map((c) => c.textContent).join("");
  }
  descendants() {
    return this.children.flatMap((c) => (c instanceof FakeElement ? [c, ...c.descendants()] : []));
  }
}

class FakeText {
  constructor(text) {
    this.textContent = text;
  }
}

globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (text) => new FakeText(text),
};

const { renderNodeProperties, renderEdgeProperties } = await import("../../src/anywidget_graph/ui/properties.js");
const { createFilterItem, createSchemaPanel, FILTER_PAGE } = await import("../../src/anywidget_graph/ui/schema.js");

const HOSTILE = {
  id: "<img src=x onerror=alert(1)>",
  label: "<b>x</b>",
  name: "<script>bad()</script>",
  path: "<svg onload=bad()>",
};

function assertShownAsText(panel, values) {
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
  renderNodeProperties(panel, node);
  assertShownAsText(panel, Object.values(HOSTILE));
});

test("edge properties show hostile types, endpoints, keys and values as text", () => {
  htmlWrites.length = 0;
  const panel = document.createElement("div");
  const edge = { source: HOSTILE.id, target: HOSTILE.path, edgeType: HOSTILE.label, name: HOSTILE.name, [HOSTILE.path]: 1 };
  renderEdgeProperties(panel, edge);
  assertShownAsText(panel, Object.values(HOSTILE));
});

test("a filter item shows hostile type and property names as text", () => {
  htmlWrites.length = 0;
  const item = createFilterItem({
    name: HOSTILE.label, count: 1, total: 1, color: "#000000", kind: "node",
    properties: [HOSTILE.name, HOSTILE.path], isHidden: false,
    onToggle() {}, onColorChange() {}, onQuery() {},
  });
  assertShownAsText(item, [HOSTILE.label, HOSTILE.name, HOSTILE.path]);
});

test("a large schema shows its first types per section, and \"Show more\" shows the rest", () => {
  const nodes = Array.from({ length: FILTER_PAGE + 30 }, (_, i) => ({ id: `n${i}`, labels: [`Type${i}`] }));
  const values = { nodes, edges: [], schema_node_types: [], schema_edge_types: [], type_colors: {}, totals: {} };
  const model = { get: (k) => values[k], set: (k, v) => { values[k] = v; }, on() {}, save_changes() {} };
  const panel = createSchemaPanel(model, () => {}, null, () => {}, () => {}, () => {});
  const items = () => panel.element.descendants().filter((el) => el.className.split(" ")[0] === "awg-schema-item");
  const more = () => panel.element.descendants().find((el) => el.className === "awg-filter-more");
  assert.equal(items().length, FILTER_PAGE);
  assert.equal(more().textContent, "Show 30 more");
  more().click();
  assert.equal(items().length, FILTER_PAGE + 30);
  assert.equal(more(), undefined);
});
