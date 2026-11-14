// The shared anywidgets look: styles.css and palette.ts carry the design tokens
// (tests/js/fixtures/anywidgets-tokens.json is a copy of the generated tokens; `npm run sync-tokens -- <tokens.json>`
// rewrites both from a newer one). Run with: node --test tests/js/*.test.ts

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { DARK, LIGHT } from "../../src/anywidget_graph/ui/palette.ts";

const UI = new URL("../../src/anywidget_graph/ui/", import.meta.url);
const tokens = JSON.parse(readFileSync(new URL("./fixtures/anywidgets-tokens.json", import.meta.url), "utf8"));
const css = readFileSync(new URL("styles.css", UI), "utf8");

function block(selector: string): string {
  const synced = css.match(/\/\* design-tokens:start[\s\S]*?\/\* design-tokens:end \*\//)?.[0] ?? "";
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return synced.match(new RegExp(`(^|\\n)${escaped} \\{([^}]*)\\}`))?.[2] ?? "";
}
const value = (body: string, name: string) => body.match(new RegExp(`--${name}: ([^;]+);`))?.[1];

test("the synced block holds the token values for every chrome variable", () => {
  const expected: Record<string, string> = {
    bg: "background",
    "bg-secondary": "surface",
    "bg-tertiary": "muted",
    border: "border",
    "border-strong": "border-strong",
    text: "foreground",
    "text-secondary": "muted-foreground",
    "text-muted": "muted-foreground",
    accent: "primary",
    "on-accent": "primary-foreground",
    "graph-bg": "background",
    "input-bg": "background",
    "input-border": "border",
    selected: "selected",
    ring: "ring",
    edge: "edge",
    other: "input",
    ok: "status-ok",
    warn: "status-warn",
    error: "status-error",
    "font-body": "font-body",
    "font-mono": "font-mono",
    "radius-box": "radius-box",
    "radius-control": "radius-control",
    "shadow-float": "shadow-float",
  };
  for (const [selector, mode] of [[".awg-wrapper", "light"], [".awg-wrapper.awg-dark", "dark"]] as const) {
    const body = block(selector);
    assert.ok(body, `${selector} in the synced block`);
    for (const [name, token] of Object.entries(expected)) assert.equal(value(body, `awg-${name}`), tokens[mode][token], `${selector} --awg-${name}`);
    const t = tokens[mode];
    assert.equal(value(body, "awg-accent-hover"), `color-mix(in srgb, ${t.primary} 80%, ${t.background})`, `${selector} --awg-accent-hover`);
  }
});

test("the synced block keeps the variable names and selectors", () => {
  const names = ["bg", "bg-secondary", "bg-tertiary", "border", "text", "text-secondary", "text-muted", "accent", "accent-hover", "graph-bg", "input-bg", "input-border"];
  for (const selector of [".awg-wrapper", ".awg-wrapper.awg-dark"]) {
    for (const name of names) assert.ok(value(block(selector), `awg-${name}`), `${selector} --awg-${name}`);
  }
});

test("palette.ts matches the tokens", () => {
  for (const [palette, mode] of [[LIGHT, "light"], [DARK, "dark"]] as const) {
    assert.deepEqual(palette.data, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => tokens[mode][`data-${n}`]));
    assert.equal(palette.other, tokens[mode].input);
    assert.equal(palette.edge, tokens[mode].edge);
    assert.equal(palette.background, tokens[mode].background);
  }
});

test("no hard-coded indigo, blue or slate is left in the styles", () => {
  for (const banned of ["#6366f1", "#0880ea", "#e2e8f0", "#0f172a", "99, 102, 241", "#ef4444"]) {
    assert.ok(!css.includes(banned), `${banned} still used in styles.css`);
  }
});

test("the canvas colours in canvas3d.ts and widget.py are the token backgrounds", () => {
  const canvas3d = readFileSync(new URL("canvas3d.ts", UI), "utf8");
  assert.match(canvas3d, /const CANVAS_LIGHT = LIGHT\.background;/);
  assert.match(canvas3d, /const CANVAS_DARK = DARK\.background;/);
  const widget = readFileSync(new URL("../widget.py", UI), "utf8");
  // "#fafafa" stays: it is the `background` trait's default and means "no background chosen"
  assert.ok(widget.includes(`_CANVAS_LIGHT, _CANVAS_DARK, _DEFAULT_BACKGROUND = "${tokens.light.background}", "${tokens.dark.background}", "#fafafa"`));
});

/** The ui scripts (not the bundles): checked by styling.test.ts once the colours come from the registry. */
export const uiScripts = () => readdirSync(UI).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(new URL(f, UI), "utf8"));

test("canvas labels (2D, 3D, export) use the tokens' mono face, and a lane label holds 18 characters of it", async () => {
  const { LABEL_FONT, LANE_LABEL_MAX, LABEL_COLUMN } = await import("../../src/anywidget_graph/ui/lanes.ts");
  assert.equal(LABEL_FONT, tokens.light["font-mono"]);
  // JetBrains Mono advances 0.6 em per character; labels are 12px
  assert.ok(LANE_LABEL_MAX >= 18 * 0.6 * 12, `cap ${LANE_LABEL_MAX}px`);
  assert.ok(LABEL_COLUMN >= LANE_LABEL_MAX + 12, "columns a label width apart, plus a gap");
  for (const file of ["index.ts", "export.ts", "canvas3d.ts"]) {
    const source = readFileSync(new URL(file, UI), "utf8");
    assert.ok(source.includes("LABEL_FONT"), `${file} draws labels in LABEL_FONT`);
  }
});

test("a toggle that is on shows it: a ring of 3:1 or more against its surface, and aria-pressed", () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const mode of ["light", "dark"] as const) {
    const ratio = contrast(tokens[mode]["muted-foreground"], tokens[mode].selected);
    assert.ok(ratio >= 3, `${mode}: ring ${ratio.toFixed(2)}:1`);
  }
  for (const rule of [".awg-mode-btn.awg-mode-active", ".awg-view-btn.awg-view-active", ".awg-level-chip-active"]) {
    const body = css.split(rule + " {")[1]?.split("}")[0] ?? css.split(rule + ",")[1]?.split("}")[0] ?? "";
    assert.match(body, /var\(--awg-text-secondary\)/, `${rule} draws its ring in --awg-text-secondary`);
  }
  for (const file of ["index.ts", "canvas3d.ts", "toolbar.ts"]) {
    assert.ok(readFileSync(new URL(file, UI), "utf8").includes('"aria-pressed"'), `${file} sets aria-pressed`);
  }
  // The pressed rule needs .awg-mode-btn: the 2D and 3D selection mode buttons both carry it
  assert.match(readFileSync(new URL("index.ts", UI), "utf8"), /ModeBtn\.className = "awg-zoom-btn awg-mode-btn/);
  assert.match(readFileSync(new URL("canvas3d.ts", UI), "utf8"), /for \(const btn of \[clickBtn, boxBtn, lassoBtn\]\) btn\.classList\.add\("awg-mode-btn"\)/);
});
