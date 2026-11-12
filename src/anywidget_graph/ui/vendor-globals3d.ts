// The bundled Three.js and OrbitControls under the names the 3D view (canvas3d.ts) uses. ui/__init__.py puts
// vendor/three.min.js in front of the widget's module, where it defines anywidgetGraph3dVendor (no CDN needed).
import type * as THREE_TYPES from "three";
import type { OrbitControls as OrbitControlsType } from "three/addons/controls/OrbitControls.js";

declare global {
  // eslint-disable-next-line no-var
  var anywidgetGraph3dVendor: { THREE: typeof THREE_TYPES; OrbitControls: typeof OrbitControlsType };
}

export const { THREE, OrbitControls } = anywidgetGraph3dVendor;
