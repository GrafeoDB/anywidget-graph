// Ink points (shared, byte for byte, by anywidget-vector and anywidget-graph's 3D view): the lit 3D shapes take
// the graph's 2D look. The body is the point's colour at 38% over the background (mostly flat, a hint of lighting),
// and the silhouette turns to the full colour (a fresnel rim), like the 2px ring of a 2D node. Opaque, so a cloud of
// hundreds of points has no depth-sorting artifacts. It hooks three.js's Phong shader at three anchors; a three.js
// whose shader lacks them is refused (tests/js/ink.test.ts checks the vendored one).

/** How much of the colour fills the body (the same share as a 2D node's fill) */
export const INK_FILL = 0.38;

/** How much of the lighting shows on the fill: a hint of shape, the rest the flat fill (a 2D node is flat) */
export const INK_SHADE = 0.35;

/** Where the rim starts and is complete, on 1 - |n·v| (0 facing the camera, 1 at the silhouette) */
const RIM_FROM = 0.55;
const RIM_TO = 0.8;

const ANCHORS = ["#include <common>", "#include <color_fragment>", "#include <opaque_fragment>"];

/** The Phong fragment shader with the ink fill and rim. */
export function inkFragment(fragment: string): string {
  for (const anchor of ANCHORS) {
    if (!fragment.includes(anchor)) throw new Error(`ink.ts: the shader has no ${anchor} to hook into`);
  }
  return fragment
    .replace(
      "#include <common>",
      "#include <common>\nuniform vec3 uInkBackground;\nuniform float uInkFill;\nuniform float uInkShade;\n" +
        // three.js works in linear light; the 2D fill mixes the sRGB colours, so mix in sRGB to look the same
        "vec3 inkMix(vec3 a, vec3 b, float t) { return pow(mix(pow(a, vec3(1.0 / 2.2)), pow(b, vec3(1.0 / 2.2)), t), vec3(2.2)); }",
    )
    .replace(
      "#include <color_fragment>",
      "#include <color_fragment>\n\tvec3 inkColor = diffuseColor.rgb;\n\tvec3 inkFill = inkMix(uInkBackground, inkColor, uInkFill);\n\tdiffuseColor.rgb = inkFill;",
    )
    .replace(
      "#include <opaque_fragment>",
      "#include <opaque_fragment>\n" +
        "\tgl_FragColor.rgb = mix(inkFill, gl_FragColor.rgb, uInkShade);\n" +
        "\tfloat inkRim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));\n" +
        `\tgl_FragColor.rgb = mix(gl_FragColor.rgb, inkColor, smoothstep(${RIM_FROM.toFixed(2)}, ${RIM_TO.toFixed(2)}, inkRim));`,
    );
}

interface InkShader {
  uniforms: Record<string, { value: unknown }>;
  fragmentShader: string;
}

/**
 * Give a MeshPhongMaterial the ink look. `background` is one uniform object shared by every inked material of a
 * view: setting its value (a THREE.Color) on a theme change updates them all without recompiling.
 */
export function applyInk(target: object, background: { value: unknown }): void {
  // A three.js material; typed loosely here, so this module needs no three.js types (and runs in the tests without it)
  const material = target as { onBeforeCompile: (shader: InkShader) => void; customProgramCacheKey: () => string };
  material.onBeforeCompile = (shader: InkShader) => {
    shader.uniforms.uInkBackground = background;
    shader.uniforms.uInkFill = { value: INK_FILL };
    shader.uniforms.uInkShade = { value: INK_SHADE };
    shader.fragmentShader = inkFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => "anywidgets-ink";
}
