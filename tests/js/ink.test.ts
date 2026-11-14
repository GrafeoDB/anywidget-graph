// Ink points (ink.ts): the lit shapes get the graph's look, a light fill (the colour at 38% over the background)
// with the full colour at the silhouette (a fresnel rim). Run with: node --test tests/js/*.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { applyInk, INK_FILL, INK_SHADE, inkFragment } from "../../src/anywidget_graph/ui/ink.ts";

// The three anchors ink.ts hooks into, in the order the Phong fragment shader has them
const PHONG = [
  "#include <common>",
  "void main() {",
  "#include <color_fragment>",
  "#include <lights_fragment_end>",
  "#include <opaque_fragment>",
  "#include <dithering_fragment>",
  "}",
].join("\n");

test("the fill is the colour at 38% over the background, before lighting", () => {
  const out = inkFragment(PHONG);
  assert.equal(INK_FILL, 0.38);
  assert.match(out, /#include <common>\nuniform vec3 uInkBackground;\nuniform float uInkFill;/);
  assert.match(out, /#include <color_fragment>\n\s*vec3 inkColor = diffuseColor\.rgb;\n\s*vec3 inkFill = inkMix\(uInkBackground, inkColor, uInkFill\);\n\s*diffuseColor\.rgb = inkFill;/);
  assert.ok(out.indexOf("inkColor =") < out.indexOf("lights_fragment_end"), "the fill is lit");
});

test("the fill stays mostly flat: lighting adds only a hint of shape, like the flat 2D fill", () => {
  const out = inkFragment(PHONG);
  assert.equal(INK_SHADE, 0.35);
  const shade = out.indexOf("gl_FragColor.rgb = mix(inkFill, gl_FragColor.rgb, uInkShade);");
  assert.ok(shade > out.indexOf("#include <opaque_fragment>"), "after lighting");
  assert.match(out, /uniform float uInkShade;/);
});

test("the fill mixes in sRGB, as the 2D fill does (three.js works in linear light)", () => {
  const out = inkFragment(PHONG);
  assert.match(out, /vec3 inkMix\(vec3 a, vec3 b, float t\) \{ return pow\(mix\(pow\(a, vec3\(1\.0 \/ 2\.2\)\), pow\(b, vec3\(1\.0 \/ 2\.2\)\), t\), vec3\(2\.2\)\); \}/);
  assert.ok(out.indexOf("vec3 inkMix") < out.indexOf("void main()"), "defined before main");
});

test("the silhouette gets the full colour, after lighting", () => {
  const out = inkFragment(PHONG);
  const shade = out.indexOf("uInkShade);");
  const rim = out.indexOf("gl_FragColor.rgb = mix(gl_FragColor.rgb, inkColor");
  assert.ok(rim > shade && rim < out.indexOf("#include <dithering_fragment>"), "the rim comes last, over the shaded fill");
});

test("a shader without the anchors is refused (a three.js upgrade must not silently drop the look)", () => {
  assert.throws(() => inkFragment("void main() {}"), /has no #include <\w+> to hook into/);
  assert.throws(() => inkFragment("#include <common>\nvoid main() {}"), /color_fragment/);
});

test("applyInk wires the shared background uniform and keys the program", () => {
  const background = { value: "bg" };
  const material = { onBeforeCompile: (_: unknown) => {}, customProgramCacheKey: () => "" };
  applyInk(material, background);
  const shader = { uniforms: {} as Record<string, { value: unknown }>, fragmentShader: PHONG };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uInkBackground, background, "the same object, so a theme change reaches every point");
  assert.equal(shader.uniforms.uInkFill.value, INK_FILL);
  assert.match(shader.fragmentShader, /inkColor/);
  assert.equal(material.customProgramCacheKey(), "anywidgets-ink");
});

test("the vendored three.js Phong shader has the anchors", () => {
  const three = readFileSync(new URL("../../src/anywidget_graph/ui/vendor/three.min.js", import.meta.url), "utf8");
  for (const anchor of ["#include <color_fragment>", "#include <opaque_fragment>", "#include <dithering_fragment>"]) {
    assert.ok(three.includes(anchor), anchor);
  }
});
