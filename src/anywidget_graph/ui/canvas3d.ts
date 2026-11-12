/**
 * The 3D view's canvas (used when the model's `view` is "3d"): nodes and edges drawn with the bundled Three.js in a
 * scene you can fly through with OrbitControls (drag to orbit, right-drag to pan, wheel to zoom). The layout runs
 * in three dimensions (force3d.js): the "bloom" (force3d_repulsion, the push between every pair of nodes) and the
 * "spread" (force3d_link_distance, the rest length of an edge) spread the graph through the volume instead of a
 * plane. Reads the same model traits as the 2D view, so queries, styling, selection and the panels work the same.
 */

import { THREE, OrbitControls } from "./vendor-globals3d.ts";
import { createForce3D, fitPositions } from "./force3d.ts";
import { autoLabel, computeEdgeColor, computeNodeColor, computeNodeSize, getStylingOpts, pointInPolygon } from "./styling.ts";
import { labelColor, levelState } from "./lanes.ts";
import { ICONS } from "./icons.ts";
import type * as THREE_NS from "three";
import type { OrbitControls as OrbitControlsNS } from "three/addons/controls/OrbitControls.js";
import type { GraphEdge, GraphNode, WidgetModel } from "./types.ts";
import type { Vec3 } from "./force3d.ts";
import type { StylingOpts } from "./styling.ts";

/** One drawn node and its scene objects. */
interface NodeRecord {
  id: string | number;
  key: string;
  data: GraphNode;
  label: string;
  sizePx: number;
  radius: number;
  colorCss: string;
  color: THREE_NS.Color;
  baseColor: THREE_NS.Color;
  level: string;
  pinned: boolean;
  pos: Vec3;
  mesh: THREE_NS.Mesh | null;
  instanceIndex?: number;
  labelSprite: THREE_NS.Sprite | null;
}

/** One drawn edge and its scene objects. */
interface EdgeRecord {
  source: string;
  target: string;
  key: string;
  data: GraphEdge;
  label: string;
  edgeType: string;
  colorCss: string;
  color: THREE_NS.Color;
  size: number;
  selfLoop: boolean;
  segOffset?: number;
  segCount?: number;
  arrowIndex?: number;
}

/** Callbacks createCanvas3D takes (the 3D view passes hover). */
export interface Canvas3DCallbacks { onHover?: (info: unknown) => void }

const SCENE_SIZE = 2; // the layout is shown in a cube of about this side
const LABEL_BUDGET = 400; // label sprites are built only for graphs up to this many nodes
const ARROW_BUDGET = 5000; // cone arrowheads only up to this many edges (beyond that, plain lines)
const INSTANCE_THRESHOLD = 100; // below this many nodes, individual meshes (simpler raycasting)
const TICKS_PER_FRAME = 4;

// The widget's canvas colours, as in widget.py: the light/dark canvas, unless `background` or the host theme says otherwise
const CANVAS_LIGHT = "#ffffff";
const CANVAS_DARK = "#181c1a";
const DEFAULT_BACKGROUND = "#fafafa";

export function createCanvas3D(model: WidgetModel, container: HTMLElement, callbacks: Canvas3DCallbacks = {}) {
  let scene: THREE_NS.Scene, camera: THREE_NS.PerspectiveCamera, renderer: THREE_NS.WebGLRenderer, controls: OrbitControlsNS;
  let nodesGroup: THREE_NS.Group, edgesGroup: THREE_NS.Group, arrowsGroup: THREE_NS.Group, labelsGroup: THREE_NS.Group, axesGroup: THREE_NS.Group;
  let raycaster: THREE_NS.Raycaster, mouse: THREE_NS.Vector2;
  let tooltip: HTMLDivElement;
  let animationId = 0;
  let resizeObserver: ResizeObserver;
  let destroyed = false;

  // Graph data: one record per node, one per edge
  let records: NodeRecord[] = [];
  let byKey = new Map<string, NodeRecord>();
  let edgeRecords: EdgeRecord[] = [];
  let sim: ReturnType<typeof createForce3D> | null = null;
  let worldScale = 1;
  let layoutName = "spring";
  let hovered: { kind: "node" | "edge"; key: string; rec?: NodeRecord; edge?: EdgeRecord } | null = null;
  let searchTerm = "";
  let hiddenNodeTypes = new Set<string>();
  let hiddenEdgeTypes = new Set<string>();
  let typeColorOverrides = new Map<string, string>();
  let selectionRect: HTMLDivElement | null = null;
  let boxOverlay: HTMLDivElement | null = null;
  let lassoOverlayEl: HTMLDivElement | null = null;
  let lassoSvg: SVGSVGElement | null = null;
  let lassoPathEl: SVGPathElement | null = null;
  let isLassoing = false;
  let lassoCoords: [number, number][] = [];
  let currentMode = model.get("selection_mode") || "click";

  function pinnedSet() {
    return new Set(Object.keys(model.get("pinned_nodes") || {}).map(String));
  }

  function effectiveBackground() {
    // A host theme's canvas colour wins, then a `background` the host set, else the light/dark canvas colour
    const custom = model.get("theme")?.background;
    if (custom) return custom;
    const bg = model.get("background") || DEFAULT_BACKGROUND;
    if (bg !== DEFAULT_BACKGROUND) return bg;
    return model.get("dark_mode") ? CANVAS_DARK : CANVAS_LIGHT;
  }

  // ------------------------------------------------------------------ //
  //  Scene setup                                                        //
  // ------------------------------------------------------------------ //

  function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(effectiveBackground());

    const initW = container.clientWidth || model.get("width") || 800;
    const initH = container.clientHeight || model.get("height") || 600;

    camera = new THREE.PerspectiveCamera(60, initW / initH, 0.005, 500);
    const camPos = model.get("camera_position") || [2, 2, 2];
    camera.position.set(camPos[0], camPos[1], camPos[2]);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(initW, initH);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.className = "awg3-canvas";
    container.appendChild(renderer.domElement);

    resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      }
    });
    resizeObserver.observe(container);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 0.05;
    controls.maxDistance = 50;
    const target = model.get("camera_target") || [0, 0, 0];
    controls.target.set(target[0], target[1], target[2]);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.5));
    const directional = new THREE.DirectionalLight(0xffffff, 0.9);
    directional.position.set(5, 10, 7);
    scene.add(directional);

    nodesGroup = new THREE.Group();
    edgesGroup = new THREE.Group();
    arrowsGroup = new THREE.Group();
    labelsGroup = new THREE.Group();
    axesGroup = new THREE.Group();
    scene.add(nodesGroup, edgesGroup, arrowsGroup, labelsGroup, axesGroup);

    raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = 0.04;
    mouse = new THREE.Vector2();

    setupAxesAndGrid();
    setupTooltip();
    setupRaycasting();
    setupZoomControls();
    setupBoxSelection();
    setupLassoSelection();
    setupKeyboard();

    rebuild();
    bindModelEvents();
    animate();
  }

  // ------------------------------------------------------------------ //
  //  Data -> records, meshes                                            //
  // ------------------------------------------------------------------ //

  function disposeGroup(group: THREE_NS.Group): void {
    while (group.children.length > 0) {
      const obj = group.children[0] as THREE_NS.Object3D & { geometry?: THREE_NS.BufferGeometry; material?: THREE_NS.Material | THREE_NS.Material[] };
      group.remove(obj);
      obj.traverse?.((raw: THREE_NS.Object3D) => {
        const o = raw as THREE_NS.Object3D & { geometry?: THREE_NS.BufferGeometry; material?: THREE_NS.Material | THREE_NS.Material[] };
        o.geometry?.dispose?.();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE_NS.Material) => m.dispose?.());
      });
      if (!obj.traverse) {
        obj.geometry?.dispose?.();
        (obj.material as THREE_NS.Material | undefined)?.dispose?.();
      }
    }
  }

  function nodeRadius(sizePx: number): number {
    return (sizePx / 30) * 0.03 * SCENE_SIZE;
  }

  function rebuild() {
    disposeGroup(nodesGroup);
    disposeGroup(edgesGroup);
    disposeGroup(arrowsGroup);
    disposeGroup(labelsGroup);

    const nodes = (model.get("nodes") ?? []) as GraphNode[];
    const edges = (model.get("edges") ?? []) as GraphEdge[];
    const optsNow: StylingOpts = getStylingOpts(model, nodes, edges);
    const pinned = pinnedSet();

    records = nodes.map((data, i) => {
      const key = String(data.id ?? `node_${i}`);
      const label = autoLabel(data);
      const sizePx = computeNodeSize(data, optsNow.sizeField, optsNow.sizeDomain, optsNow.sizeRange, optsNow.degreeMap.get(String(data.id)));
      const colorCss = computeNodeColor(data, optsNow.colorField, optsNow.colorScale, optsNow.colorDomain, optsNow.typeColors.nodes);
      return {
        id: data.id ?? key,
        key,
        data,
        label,
        sizePx,
        radius: nodeRadius(sizePx),
        colorCss,
        color: new THREE.Color(colorCss),
        baseColor: new THREE.Color(colorCss),
        level: "shown",
        pinned: pinned.has(key),
        pos: { x: 0, y: 0, z: 0 },
        mesh: null,
        labelSprite: null,
      };
    });
    byKey = new Map(records.map((r) => [r.key, r]));

    const edgeTypeOf = (e: GraphEdge): string => e.type || e.label || "unknown";
    edgeRecords = [];
    const seen = new Set<string>();
    for (const e of edges) {
      const s = String(e.source);
      const t = String(e.target);
      if (!byKey.has(s) || !byKey.has(t)) continue; // edges to unknown nodes are skipped, as in the 2D view
      const ekey = `${s}|${t}|${e.label ?? ""}`;
      if (seen.has(ekey)) continue;
      seen.add(ekey);
      const colorCss = computeEdgeColor(e, optsNow);
      edgeRecords.push({
        source: s,
        target: t,
        key: ekey,
        data: e,
        label: e.label || "",
        edgeType: edgeTypeOf(e),
        colorCss,
        color: new THREE.Color(colorCss),
        size: typeof e.width === "number" && e.width > 0 ? e.width : (e.size || 2),
        selfLoop: s === t,
      });
    }

    buildNodeMeshes();
    buildEdgeLines();
    buildArrowCones();
    buildLabels();
    applyLayout(model.get("layout") || "spring");
    applyLevelStates();
    applyColors();
    updateTransforms();
    fitToView();
  }

  function buildNodeMeshes() {
    const useInstancing = records.length > INSTANCE_THRESHOLD;
    if (useInstancing) {
      const geometry = new THREE.SphereGeometry(1, 16, 12);
      const material = new THREE.MeshPhongMaterial({ vertexColors: true });
      const mesh = new THREE.InstancedMesh(geometry, material, records.length);
      const colors = new Float32Array(records.length * 3);
      geometry.setAttribute("color", new THREE.InstancedBufferAttribute(colors, 3));
      mesh.userData = { isInstanced: true, keys: records.map((r) => r.key) };
      records.forEach((r, i) => { r.mesh = mesh; r.instanceIndex = i; });
      nodesGroup.add(mesh);
    } else {
      const geometry = new THREE.SphereGeometry(1, 20, 14);
      records.forEach((r, i) => {
        const material = new THREE.MeshPhongMaterial({ color: r.color });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = { isInstanced: false, key: r.key, index: i };
        r.mesh = mesh;
        r.instanceIndex = i;
        nodesGroup.add(mesh);
      });
    }
  }

  function buildEdgeLines() {
    // One LineSegments for all edges: two vertices per edge; a self-loop becomes a small triangle loop
    const segs = [];
    for (const e of edgeRecords) {
      if (e.selfLoop) segs.push(3);
      else segs.push(1);
    }
    const totalVerts = segs.reduce((a, b) => a + b * 2, 0);
    const positions = new Float32Array(totalVerts * 3);
    const colors = new Float32Array(totalVerts * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38 });
    const lines = new THREE.LineSegments(geometry, material);
    lines.userData = { isEdges: true };
    let offset = 0;
    for (const e of edgeRecords) {
      e.segOffset = offset;
      e.segCount = e.selfLoop ? 3 : 1;
      offset += e.segCount * 2;
    }
    edgesGroup.add(lines);
  }

  function buildArrowCones() {
    const showArrows = model.get("edge_arrows") && edgeRecords.length <= ARROW_BUDGET;
    if (!showArrows) return;
    const nonLoop = edgeRecords.filter((e) => !e.selfLoop);
    if (nonLoop.length === 0) return;
    const geometry = new THREE.ConeGeometry(1, 1, 10);
    const material = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
    const mesh = new THREE.InstancedMesh(geometry, material, nonLoop.length);
    mesh.userData = { isArrows: true, edges: nonLoop };
    nonLoop.forEach((e, i) => { e.arrowIndex = i; });
    arrowsGroup.add(mesh);
  }

  function buildLabels() {
    const show = model.get("show_labels");
    if (!show || records.length > LABEL_BUDGET) return;
    const textColor = labelColor(model.get("theme") || {}, model.get("dark_mode"));
    for (const r of records) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.font = "30px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = textColor;
      ctx.fillText(r.label.length > 26 ? r.label.slice(0, 25) + "…" : r.label, 128, 32);
      const texture = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
      sprite.renderOrder = 999;
      sprite.scale.set(0.3, 0.075, 1);
      labelsGroup.add(sprite);
      r.labelSprite = sprite;
    }
  }

  // ------------------------------------------------------------------ //
  //  Layout (3D force: bloom and spread in three dimensions)           //
  // ------------------------------------------------------------------ //

  function applyLayout(name: string): void {
    layoutName = name;
    const n = records.length;
    if (n === 0) return;

    if (name === "preset") {
      // The host placed the nodes: x, y and z as given (z=0 when only x and y are set)
      for (const r of records) {
        r.pos = { x: r.data.x ?? 0, y: r.data.y ?? 0, z: r.data.z ?? 0 };
      }
      const fitted = fitPositions(new Map(records.map((r) => [r.key, r.pos])), SCENE_SIZE);
      for (const r of records) r.pos = fitted.get(r.key) ?? r.pos;
      sim = null;
      updateTransforms();
      fitToView();
      return;
    }

    if (name === "circular" || name === "random") {
      // On a sphere (circular) or in a ball (random), spread through the volume
      const R = SCENE_SIZE * 0.45;
      records.forEach((r, i) => {
        if (name === "circular") {
          const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
          const theta = Math.PI * (1 + Math.sqrt(5)) * i;
          r.pos = { x: R * Math.sin(phi) * Math.cos(theta), y: R * Math.cos(phi), z: R * Math.sin(phi) * Math.sin(theta) };
        } else {
          const u = Math.random() * 2 - 1;
          const theta = Math.random() * Math.PI * 2;
          const s = Math.sqrt(1 - u * u);
          const rr = R * Math.cbrt(Math.random());
          r.pos = { x: rr * s * Math.cos(theta), y: rr * u, z: rr * s * Math.sin(theta) };
        }
      });
      sim = null;
      updateTransforms();
      fitToView();
      return;
    }

    // spring / force / cluster and anything else: the 3D force layout
    sim = createForce3D({
      repulsion: model.get("force3d_repulsion") ?? 1,
      linkDistance: model.get("force3d_link_distance") ?? null,
      ticks: 300,
    });
    sim.setData(
      records.map((r) => ({ id: r.key, x: r.data.x, y: r.data.y, z: r.data.z, size: r.sizePx, pinned: r.pinned })),
      edgeRecords.map((e) => ({ source: e.source, target: e.target }))
    );
    updateTransforms();
  }

  /** One animation step: advance the simulation a few ticks, then push positions to the meshes. */
  function stepSimulation() {
    if (!sim) return;
    for (let k = 0; k < TICKS_PER_FRAME; k++) {
      if (sim.tick() === 0) break;
    }
    const pos = sim.positions();
    // Fit the current extent to the scene (gravity keeps the cloud centred, so scaling alone suffices)
    let extent = 0;
    for (const p of pos.values()) {
      extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
    }
    worldScale = extent > 0 ? (SCENE_SIZE * 0.5) / extent : 1;
    for (const r of records) {
      const p = pos.get(r.key);
      if (p) r.pos = { x: p.x * worldScale, y: p.y * worldScale, z: p.z * worldScale };
    }
    updateTransforms();
    if (sim.alpha === 0) {
      // Settled: fit exactly and stop the simulation
      const fitted = fitPositions(new Map(records.map((r) => [r.key, r.pos])), SCENE_SIZE);
      for (const r of records) r.pos = fitted.get(r.key) ?? r.pos;
      worldScale = 1;
      updateTransforms();
      fitToView();
    }
  }

  // ------------------------------------------------------------------ //
  //  Mesh updates                                                       //
  // ------------------------------------------------------------------ //

  function updateTransforms(): void {
    const matrix = new THREE.Matrix4();
    const selected = new Set((model.get("selected_nodes") || []).map(String));
    for (const r of records) {
      const scale = r.level === "hidden" ? 0 : r.radius * (selected.has(r.key) ? 1.6 : 1);
      const mesh = r.mesh;
      if (!mesh) continue;
      if (mesh.userData.isInstanced) {
        matrix.identity();
        matrix.makeScale(scale, scale, scale);
        matrix.setPosition(r.pos.x, r.pos.y, r.pos.z);
        (mesh as THREE_NS.InstancedMesh).setMatrixAt(r.instanceIndex ?? 0, matrix);
      } else {
        mesh.visible = r.level !== "hidden";
        mesh.position.set(r.pos.x, r.pos.y, r.pos.z);
        mesh.scale.set(scale, scale, scale);
      }
      if (r.labelSprite) {
        r.labelSprite.visible = r.level !== "hidden" && Boolean(model.get("show_labels")) && records.length <= LABEL_BUDGET;
        r.labelSprite.position.set(r.pos.x, r.pos.y + r.radius * 1.8, r.pos.z);
      }
    }
    const instanced = nodesGroup.children.find((c) => c.userData.isInstanced) as THREE_NS.InstancedMesh | undefined;
    if (instanced) instanced.instanceMatrix.needsUpdate = true;

    // Edges
    const lines = edgesGroup.children.find((c) => c.userData.isEdges) as THREE_NS.LineSegments | undefined;
    if (lines) {
      const posAttr = lines.geometry.getAttribute("position") as THREE_NS.BufferAttribute;
      const colAttr = lines.geometry.getAttribute("color") as THREE_NS.BufferAttribute;
      const a = new THREE.Color();
      for (const e of edgeRecords) {
        const s = byKey.get(e.source);
        if (!s) continue;
        const t = byKey.get(e.target);
        if (!t) continue;
        const hidden = hiddenEdgeTypes.has(e.edgeType) || s.level === "hidden" || t.level === "hidden";
        const base = e.color;
        for (let k = 0; k < (e.segCount ?? 0); k++) {
          const vi = ((e.segOffset ?? 0) + k * 2) * 3;
          if (e.selfLoop) {
            // A small loop above the node
            const ang = (k / 3) * Math.PI * 2;
            const loopR = s.radius * 2.2;
            const p1 = { x: s.pos.x + Math.cos(ang) * loopR, y: s.pos.y + s.radius * 1.5, z: s.pos.z + Math.sin(ang) * loopR };
            const ang2 = ((k + 1) / 3) * Math.PI * 2;
            const p2 = { x: s.pos.x + Math.cos(ang2) * loopR, y: s.pos.y + s.radius * 1.5, z: s.pos.z + Math.sin(ang2) * loopR };
            posAttr.setXYZ(vi / 3, hidden ? s.pos.x : p1.x, hidden ? s.pos.y : p1.y, hidden ? s.pos.z : p1.z);
            posAttr.setXYZ(vi / 3 + 1, hidden ? s.pos.x : p2.x, hidden ? s.pos.y : p2.y, hidden ? s.pos.z : p2.z);
          } else {
            posAttr.setXYZ(vi / 3, hidden ? s.pos.x : s.pos.x, hidden ? s.pos.y : s.pos.y, hidden ? s.pos.z : s.pos.z);
            posAttr.setXYZ(vi / 3 + 1, hidden ? s.pos.x : t.pos.x, hidden ? s.pos.y : t.pos.y, hidden ? s.pos.z : t.pos.z);
          }
          a.copy(hidden ? base : base).multiplyScalar(hidden ? 0 : 1);
          colAttr.setXYZ(vi / 3, a.r, a.g, a.b);
          colAttr.setXYZ(vi / 3 + 1, a.r, a.g, a.b);
        }
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }

    // Arrowheads on directed edges
    const arrows = arrowsGroup.children.find((c) => c.userData.isArrows);
    if (arrows) {
      const up = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3();
      const q = new THREE.Quaternion();
      for (const e of arrows.userData.edges) {
        const s = byKey.get(e.source);
        if (!s) continue;
        const t = byKey.get(e.target);
        if (!t) continue;
        if (!s || !t) continue;
        dir.set(t.pos.x - s.pos.x, t.pos.y - s.pos.y, t.pos.z - s.pos.z);
        const len = dir.length();
        if (len < 1e-6) continue;
        dir.divideScalar(len);
        q.setFromUnitVectors(up, dir);
        const h = Math.min(0.06 * SCENE_SIZE, len * 0.2);
        const w = Math.max(s.radius, t.radius) * 1.6;
        matrix.identity();
        matrix.makeRotationFromQuaternion(q);
        matrix.scale(new THREE.Vector3(w, h, w));
        matrix.setPosition(
          s.pos.x + dir.x * (len * 0.82),
          s.pos.y + dir.y * (len * 0.82),
          s.pos.z + dir.z * (len * 0.82)
        );
        (arrows as THREE_NS.InstancedMesh).setMatrixAt(e.arrowIndex ?? 0, matrix);
      }
      (arrows as THREE_NS.InstancedMesh).instanceMatrix.needsUpdate = true;
    }
  }

  /** Recompute every node's drawn color from level, search, type filters, overrides and the selection. */
  function applyColors() {
    const selected = new Set((model.get("selected_nodes") || []).map(String));
    const highlightNeighbors = model.get("highlight_neighbors") && selected.size === 1;
    let neighbors = new Set<string>();
    if (highlightNeighbors) {
      const only = [...selected][0];
      for (const e of edgeRecords) {
        if (e.source === only) neighbors.add(e.target);
        if (e.target === only) neighbors.add(e.source);
      }
    }
    const instanced = nodesGroup.children.find((c) => c.userData.isInstanced) as THREE_NS.InstancedMesh | undefined;
    const colAttr = instanced?.geometry.getAttribute("color") as THREE_NS.BufferAttribute | undefined;
    for (const r of records) {
      let c = r.baseColor.clone();
      // Type color overrides from the schema panel's filter
      const override = typeColorOverrides.get(String(r.data.labels?.[0] ?? r.data.label ?? ""));
      if (override) c = new THREE.Color(override);
      if (r.level === "dim") c.multiplyScalar(0.25);
      if (hiddenNodeTypes.has(r.data.labels?.[0] ?? r.data.label ?? "")) c.multiplyScalar(0);
      if (searchTerm && !matchesSearch(r)) c.multiplyScalar(0.08);
      if (highlightNeighbors && !selected.has(r.key) && !neighbors.has(r.key)) c.multiplyScalar(0.15);
      if (selected.has(r.key)) c.lerp(new THREE.Color(0xffffff), 0.35);
      r.color = c;
      if (instanced) {
        colAttr?.setXYZ(r.instanceIndex ?? 0, c.r, c.g, c.b);
      } else if (r.mesh) {
        (r.mesh.material as THREE_NS.MeshStandardMaterial).color.copy(c);
      }
    }
    if (instanced && colAttr) colAttr.needsUpdate = true;
  }

  function matchesSearch(r: NodeRecord): boolean {
    const term = searchTerm;
    const type = (r.data.labels && r.data.labels[0]) || r.data.label || "";
    return r.label.toLowerCase().includes(term) || r.key.toLowerCase().includes(term) || String(type).toLowerCase().includes(term);
  }

  function applyLevelStates() {
    const levels = model.get("levels") || [];
    const current = model.get("current_level") || 0;
    const levelField = model.get("level_field") || "level";
    const style = model.get("filtered_style") || "dim";
    for (const r of records) {
      r.level = levelState(r.data[levelField], current, levels, style);
    }
  }

  // ------------------------------------------------------------------ //
  //  Camera                                                             //
  // ------------------------------------------------------------------ //

  function fitToView() {
    if (records.length === 0) return;
    const box = new THREE.Box3();
    for (const r of records) {
      if (r.level === "hidden") continue;
      box.expandByPoint(new THREE.Vector3(r.pos.x, r.pos.y, r.pos.z));
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || SCENE_SIZE;
    const distance = (size / (2 * Math.tan((Math.PI * camera.fov) / 360))) * 1.15;
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.5, 0.8);
    dir.normalize();
    controls.target.copy(center);
    camera.position.copy(center).add(dir.multiplyScalar(Math.max(distance, 0.2)));
    camera.near = Math.max(0.001, distance * 0.001);
    camera.far = Math.max(500, distance * 20);
    camera.updateProjectionMatrix();
    controls.update();
  }

  // ------------------------------------------------------------------ //
  //  Interaction: hover, click, box/lasso selection                     //
  // ------------------------------------------------------------------ //

  function eventMouse(event: MouseEvent): DOMRect {
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return rect;
  }

  function pickAt(event: MouseEvent): { kind: "node"; rec: NodeRecord } | { kind: "edge"; edge: EdgeRecord } | null {
    eventMouse(event);
    raycaster.setFromCamera(mouse, camera);
    const nodeHits = raycaster.intersectObjects(nodesGroup.children, false);
    if (nodeHits.length > 0) {
      const hit = nodeHits[0];
      const key = hit.object.userData.isInstanced ? hit.object.userData.keys[hit.instanceId ?? 0] : hit.object.userData.key;
      const rec = byKey.get(key);
      if (rec && rec.level !== "hidden") return { kind: "node", rec };
    }
    const edgeHits = raycaster.intersectObjects(edgesGroup.children, false);
    if (edgeHits.length > 0) {
      // Line raycasting does not say which segment was hit, so find the edge closest to the hit point
      const p = edgeHits[0].point;
      let best = null;
      let bestD = Infinity;
      for (const e of edgeRecords) {
        if (e.selfLoop) continue;
        const s = byKey.get(e.source);
        if (!s) continue;
        const t = byKey.get(e.target);
        if (!t) continue;
        if (!s || !t) continue;
        const d = pointToSegment(p, s.pos, t.pos);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (best) return { kind: "edge", edge: best };
    }
    return null;
  }

  function pointToSegment(p: THREE_NS.Vector3, a: Vec3, b: Vec3): number {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + abx * t, cy = a.y + aby * t, cz = a.z + abz * t;
    return Math.hypot(p.x - cx, p.y - cy, p.z - cz);
  }

  function nodePayload(rec: NodeRecord): GraphNode {
    return { ...rec.data, id: rec.data.id ?? rec.id, label: rec.label, x: rec.pos.x, y: rec.pos.y, z: rec.pos.z, size: rec.sizePx, color: rec.colorCss };
  }

  function edgePayload(e: EdgeRecord): GraphEdge {
    return { ...e.data, source: e.data.source, target: e.data.target, label: e.label, size: e.size, color: e.colorCss };
  }

  function setSelection(ids: string[]): void {
    model.set("selected_nodes", ids);
    model.save_changes();
  }

  function setupRaycasting() {
    container.addEventListener("mousemove", (event: MouseEvent) => {
      if (currentMode !== "click" && currentMode !== "multi") return;
      const hit = pickAt(event);
      const key = hit ? `${hit.kind}:${hit.kind === "node" ? hit.rec.key : hit.edge.key}` : null;
      if (key === hovered?.key) return;
      hovered = hit && key !== null ? (hit.kind === "node" ? { kind: "node", key, rec: hit.rec } : { kind: "edge", key, edge: hit.edge }) : null;
      if (hit?.kind === "node") {
        model.set("hovered_node", nodePayload(hit.rec));
        model.save_changes();
        callbacks.onHover?.(hit.rec.data);
        showTooltip(event, hit.rec);
      } else if (hit?.kind === "edge") {
        model.set("hovered_edge", edgePayload(hit.edge));
        model.save_changes();
        showTooltip(event, null, hit.edge as EdgeRecord);
      } else {
        model.set("hovered_node", null);
        model.set("hovered_edge", null);
        model.save_changes();
        callbacks.onHover?.(null);
        hideTooltip();
      }
    });

    container.addEventListener("click", (event: MouseEvent) => {
      if (currentMode === "box" || currentMode === "lasso") return;
      const hit = pickAt(event);
      if (hit?.kind === "node") {
        const rec = hit.rec;
        model.set("selected_node", nodePayload(rec));
        const mode = model.get("selection_mode") || "click";
        const current = (model.get("selected_nodes") || []).map(String);
        if (mode === "multi" || event.shiftKey) {
          if (current.includes(rec.key)) setSelection(current.filter((id: string) => id !== rec.key));
          else setSelection([...current, rec.key]);
        } else {
          setSelection([rec.key]);
        }
        model.save_changes();
      } else if (hit?.kind === "edge") {
        model.set("selected_edge", edgePayload(hit.edge));
        model.save_changes();
      } else {
        model.set("selected_node", null);
        model.set("selected_edge", null);
        setSelection([]);
        model.set("selected_edges", []);
        model.save_changes();
      }
    });
  }

  function setupTooltip() {
    tooltip = document.createElement("div");
    tooltip.className = "awg3-tooltip";
    container.appendChild(tooltip);
  }

  function showTooltip(event: MouseEvent, rec: NodeRecord | null, edge?: EdgeRecord): void {
    if (!model.get("show_tooltip")) return;
    const fields = model.get("tooltip_fields") || ["label", "id"];
    const source = rec ? nodePayload(rec) : edgePayload(edge as EdgeRecord);
    // Node/edge data can come from a database: textContent only, never markup
    const children: HTMLElement[] = [];
    if (source.label) {
      const labelEl = document.createElement("div");
      labelEl.className = "awg3-tooltip-label";
      labelEl.textContent = String(source.label);
      children.push(labelEl);
    }
    for (const f of fields) {
      if (f === "label" || source[f] === undefined) continue;
      const row = document.createElement("div");
      row.className = "awg3-tooltip-row";
      const keyEl = document.createElement("span");
      keyEl.className = "awg3-tooltip-key";
      keyEl.textContent = f + ":";
      const valueEl = document.createElement("span");
      const v = source[f];
      valueEl.textContent = typeof v === "number" ? v.toFixed(3) : String(v);
      row.append(keyEl, valueEl);
      children.push(row);
    }
    tooltip.replaceChildren(...children);
    tooltip.style.display = "block";
    const rect = container.getBoundingClientRect();
    tooltip.style.left = event.clientX - rect.left + 15 + "px";
    tooltip.style.top = event.clientY - rect.top + 15 + "px";
  }

  function hideTooltip() {
    tooltip.style.display = "none";
  }

  function setupZoomControls() {
    const zoomControls = document.createElement("div");
    zoomControls.className = "awg3-zoom-controls";

    const modeGroup = document.createElement("div");
    modeGroup.className = "awg3-mode-group";
    const clickBtn = mkBtn(ICONS.cursor, "Click / multi-select mode");
    const boxBtn = mkBtn(ICONS.boxSelect, "Box select mode");
    const lassoBtn = mkBtn(ICONS.lasso, "Lasso select mode");

    function setActiveMode(mode: string): void {
      currentMode = mode;
      model.set("selection_mode", mode);
      model.save_changes();
      clickBtn.classList.toggle("awg3-mode-active", mode === "click" || mode === "multi");
      boxBtn.classList.toggle("awg3-mode-active", mode === "box");
      lassoBtn.classList.toggle("awg3-mode-active", mode === "lasso");
      controls.enabled = mode === "click" || mode === "multi";
      if (boxOverlay) boxOverlay.style.display = mode === "box" ? "block" : "none";
      if (lassoOverlayEl) lassoOverlayEl.style.display = mode === "lasso" ? "block" : "none";
    }
    clickBtn.addEventListener("click", () => setActiveMode("click"));
    boxBtn.addEventListener("click", () => setActiveMode("box"));
    lassoBtn.addEventListener("click", () => setActiveMode("lasso"));
    model.on("change:selection_mode", () => {
      const mode = model.get("selection_mode") || "click";
      if (mode !== currentMode) setActiveMode(mode);
    });
    setActiveMode(currentMode);
    modeGroup.append(clickBtn, boxBtn, lassoBtn);
    zoomControls.appendChild(modeGroup);

    const zoomInBtn = mkBtn(ICONS.zoomIn, "Zoom in");
    zoomInBtn.addEventListener("click", () => {
      camera.position.lerp(controls.target, 0.3);
      controls.update();
    });
    const zoomOutBtn = mkBtn(ICONS.zoomOut, "Zoom out");
    zoomOutBtn.addEventListener("click", () => {
      const offset = camera.position.clone().sub(controls.target);
      camera.position.add(offset.multiplyScalar(0.3));
      controls.update();
    });
    const zoomFitBtn = mkBtn(ICONS.zoomFit, "Fit to view");
    zoomFitBtn.addEventListener("click", fitToView);
    zoomControls.append(zoomInBtn, zoomOutBtn, zoomFitBtn);
    container.appendChild(zoomControls);
  }

  function mkBtn(icon: string, title: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "awg3-zoom-btn";
    btn.innerHTML = icon;
    btn.title = title;
    return btn;
  }

  function projectToScreen(rec: NodeRecord): { x: number; y: number } {
    const v = new THREE.Vector3(rec.pos.x, rec.pos.y, rec.pos.z).project(camera);
    const rect = container.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height };
  }

  function setupBoxSelection() {
    boxOverlay = document.createElement("div");
    boxOverlay.className = "awg3-overlay";
    boxOverlay.style.display = "none";
    boxOverlay.style.cursor = "crosshair";
    container.appendChild(boxOverlay);

    selectionRect = document.createElement("div");
    selectionRect.className = "awg3-selection-rect";
    container.appendChild(selectionRect);

    let dragging = false;
    let startX = 0;
    let startY = 0;

    boxOverlay.addEventListener("mousedown", (e: MouseEvent) => {
      if (!selectionRect) return;
      if (currentMode !== "box") return;
      e.preventDefault();
      dragging = true;
      const rect = container.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
      Object.assign(selectionRect.style, { left: startX + "px", top: startY + "px", width: "0px", height: "0px", display: "block" });
    });
    boxOverlay.addEventListener("mousemove", (e: MouseEvent) => {
      if (!selectionRect) return;
      if (!dragging) return;
      const rect = container.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;
      Object.assign(selectionRect.style, {
        left: Math.min(startX, curX) + "px",
        top: Math.min(startY, curY) + "px",
        width: Math.abs(curX - startX) + "px",
        height: Math.abs(curY - startY) + "px",
      });
    });
    boxOverlay.addEventListener("mouseup", (e: MouseEvent) => {
      if (!selectionRect) return;
      if (!dragging) return;
      dragging = false;
      selectionRect.style.display = "none";
      const rect = container.getBoundingClientRect();
      const x1 = Math.min(startX, e.clientX - rect.left);
      const y1 = Math.min(startY, e.clientY - rect.top);
      const x2 = Math.max(startX, e.clientX - rect.left);
      const y2 = Math.max(startY, e.clientY - rect.top);
      if (x2 - x1 < 4 && y2 - y1 < 4) return;
      const ids = [];
      for (const r of records) {
        if (r.level === "hidden") continue;
        const p = projectToScreen(r);
        if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) ids.push(r.key);
      }
      setSelection(ids);
    });
  }

  function setupLassoSelection() {
    lassoSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    lassoSvg.setAttribute("class", "awg3-overlay");
    lassoSvg.style.pointerEvents = "none";
    lassoSvg.style.display = "none";
    container.appendChild(lassoSvg);
    lassoPathEl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    lassoPathEl.setAttribute("fill", "rgba(99, 102, 241, 0.1)");
    lassoPathEl.setAttribute("stroke", "#6366f1");
    lassoPathEl.setAttribute("stroke-width", "2");
    lassoPathEl.setAttribute("stroke-dasharray", "4 2");
    lassoSvg.appendChild(lassoPathEl);

    lassoOverlayEl = document.createElement("div");
    lassoOverlayEl.className = "awg3-overlay";
    lassoOverlayEl.style.display = "none";
    lassoOverlayEl.style.cursor = "crosshair";
    container.appendChild(lassoOverlayEl);

    lassoOverlayEl.addEventListener("mousedown", (e: MouseEvent) => {
      if (!lassoSvg || !lassoPathEl) return;
      if (currentMode !== "lasso") return;
      e.preventDefault();
      isLassoing = true;
      lassoCoords = [];
      const rect = container.getBoundingClientRect();
      lassoCoords.push([e.clientX - rect.left, e.clientY - rect.top]);
      lassoSvg.style.display = "block";
      lassoPathEl.setAttribute("points", "");
    });
    lassoOverlayEl.addEventListener("mousemove", (e: MouseEvent) => {
      if (!lassoPathEl) return;
      if (!isLassoing) return;
      const rect = container.getBoundingClientRect();
      lassoCoords.push([e.clientX - rect.left, e.clientY - rect.top]);
      lassoPathEl.setAttribute("points", lassoCoords.map(([x, y]) => `${x},${y}`).join(" "));
    });
    lassoOverlayEl.addEventListener("mouseup", () => {
      if (!lassoSvg) return;
      if (!isLassoing) return;
      isLassoing = false;
      lassoSvg.style.display = "none";
      if (lassoCoords.length < 3) return;
      lassoCoords.push(lassoCoords[0]);
      const ids = [];
      for (const r of records) {
        if (r.level === "hidden") continue;
        const p = projectToScreen(r);
        if (pointInPolygon(p.x, p.y, lassoCoords)) ids.push(r.key);
      }
      setSelection(ids);
      lassoCoords = [];
    });
  }

  function setupKeyboard() {
    container.tabIndex = 0;
    container.style.outline = "none";
    container.addEventListener("keydown", (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        fitToView();
      } else if (e.key === "Escape") {
        model.set("selected_node", null);
        model.set("selected_edge", null);
        setSelection([]);
        model.set("selected_edges", []);
        model.save_changes();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const selected = new Set((model.get("selected_nodes") || []).map(String));
        if (selected.size === 0) return;
        e.preventDefault();
        const nodes = ((model.get("nodes") ?? []) as GraphNode[]).filter((n) => !selected.has(String(n.id)));
        const edges = ((model.get("edges") ?? []) as GraphEdge[]).filter((e) => !selected.has(String(e.source)) && !selected.has(String(e.target)));
        model.set("nodes", nodes);
        model.set("edges", edges);
        model.set("selected_node", null);
        model.set("selected_edge", null);
        setSelection([]);
        model.save_changes();
      }
    });
  }

  // ------------------------------------------------------------------ //
  //  Axes and grid                                                      //
  // ------------------------------------------------------------------ //

  function setupAxesAndGrid() {
    disposeGroup(axesGroup);

    if (model.get("show_axes")) {
      axesGroup.add(new THREE.AxesHelper(SCENE_SIZE * 0.6));
      const labels = model.get("axis_labels") || { x: "X", y: "Y", z: "Z" };
      addAxisLabel(labels.x, [SCENE_SIZE * 0.65, 0, 0], 0xff4444);
      addAxisLabel(labels.y, [0, SCENE_SIZE * 0.65, 0], 0x44ff44);
      addAxisLabel(labels.z, [0, 0, SCENE_SIZE * 0.65], 0x4444ff);
    }
    if (model.get("show_grid")) {
      axesGroup.add(new THREE.GridHelper(SCENE_SIZE, model.get("grid_divisions") || 10, 0x888888, 0x555555));
    }
  }

  function addAxisLabel(text: string, position: [number, number, number], color: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 24px Arial";
    ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
    ctx.textAlign = "center";
    ctx.fillText(String(text ?? ""), 32, 24);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sprite.position.set(position[0], position[1], position[2]);
    sprite.scale.set(0.12, 0.06, 1);
    axesGroup.add(sprite);
  }

  // ------------------------------------------------------------------ //
  //  Model events                                                       //
  // ------------------------------------------------------------------ //

  function bindModelEvents() {
    model.on("change:nodes", rebuild);
    model.on("change:edges", rebuild);
    model.on("change:layout", () => { applyLayout(model.get("layout") || "spring"); });
    for (const name of ["color_field", "color_scale", "color_domain", "size_field", "size_range", "edge_color_field", "edge_color_scale", "edge_size_field", "edge_size_range", "type_colors", "edge_arrows"]) {
      model.on(`change:${name}`, rebuild);
    }
    model.on("change:show_labels", () => { disposeGroup(labelsGroup); buildLabels(); updateTransforms(); });
    model.on("change:background", () => { scene.background = new THREE.Color(effectiveBackground()); });
    model.on("change:dark_mode", () => { scene.background = new THREE.Color(effectiveBackground()); });
    model.on("change:theme", () => { scene.background = new THREE.Color(effectiveBackground()); });
    model.on("change:show_axes", setupAxesAndGrid);
    model.on("change:show_grid", setupAxesAndGrid);
    model.on("change:grid_divisions", setupAxesAndGrid);
    model.on("change:axis_labels", setupAxesAndGrid);
    model.on("change:selected_nodes", () => { applyColors(); updateTransforms(); });
    model.on("change:highlight_neighbors", () => { applyColors(); });
    model.on("change:levels", () => { applyLevelStates(); applyColors(); updateTransforms(); });
    model.on("change:current_level", () => { applyLevelStates(); applyColors(); updateTransforms(); });
    model.on("change:level_field", () => { applyLevelStates(); applyColors(); updateTransforms(); });
    model.on("change:filtered_style", () => { applyLevelStates(); applyColors(); updateTransforms(); });
    model.on("change:pinned_nodes", () => {
      const pinned = pinnedSet();
      for (const r of records) r.pinned = pinned.has(r.key);
      if (sim) sim.reheat(0.4);
    });
    model.on("change:force3d_repulsion", () => { if (layoutName !== "preset" && layoutName !== "circular" && layoutName !== "random") applyLayout(layoutName); });
    model.on("change:force3d_link_distance", () => { if (layoutName !== "preset" && layoutName !== "circular" && layoutName !== "random") applyLayout(layoutName); });
    model.on("change:camera_position", () => {
      const pos = model.get("camera_position");
      if (pos) camera.position.set(pos[0], pos[1], pos[2]);
    });
    model.on("change:camera_target", () => {
      const target = model.get("camera_target");
      if (target) controls.target.set(target[0], target[1], target[2]);
    });
  }

  // ------------------------------------------------------------------ //
  //  Animation loop and cleanup                                         //
  // ------------------------------------------------------------------ //

  function animate() {
    if (destroyed) return;
    animationId = requestAnimationFrame(animate);
    stepSimulation();
    controls.update();
    renderer.render(scene, camera);
  }

  function cleanup() {
    destroyed = true;
    cancelAnimationFrame(animationId);
    resizeObserver?.disconnect();
    controls?.dispose();
    renderer?.dispose();
    scene?.traverse((raw) => {
      const obj = raw as THREE_NS.Object3D & { geometry?: THREE_NS.BufferGeometry; material?: THREE_NS.Material | THREE_NS.Material[] };
      obj.geometry?.dispose?.();
      if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m: THREE_NS.Material) => m.dispose?.());
    });
  }

  // Called by the 3D view's wiring (index3d.js): toolbar search, schema panel filters and color overrides
  function applySearch(term: string): void {
    searchTerm = (term || "").toLowerCase().trim();
    applyColors();
  }
  function setTypeFilter(nodeTypes: Set<string>, edgeTypes: Set<string>): void {
    hiddenNodeTypes = nodeTypes || new Set();
    hiddenEdgeTypes = edgeTypes || new Set();
    applyColors();
    updateTransforms();
  }
  function setTypeColorOverrides(colorMap: Map<string, string>): void {
    typeColorOverrides = colorMap || new Map();
    rebuild();
  }

  init();

  return { cleanup, redraw: rebuild, applyLayout, fitToView, applySearch, setTypeFilter, setTypeColorOverrides };
}
