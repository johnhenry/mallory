/**
 * Shared Three.js scene setup for the Omnigraph panel -- the ~45-line
 * mount-once boilerplate that Graph3DCanvas, ParametricSurfacePanel,
 * SpaceCurvePanel, VectorField3DPanel, ComplexGraph3DPanel,
 * GradientDescentPanel (and TilesPanel/CellularAutomataPanel twice each)
 * all repeat verbatim, extracted once. EXISTING PANELS ARE DELIBERATELY
 * NOT REFACTORED onto this helper -- Omnigraph is a purely additive
 * feature, and a 10-panel refactor is its own change with its own risk;
 * they can migrate later if ever worth it.
 *
 * Also home to `toThreePoint`, the single axis-convention adapter every
 * point-producing Omnigraph item goes through -- see its doc comment for
 * the reconciliation story (the top correctness risk this panel carries).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildAxesLabelGroup, buildSymmetricAxesHelper, setupCss2DOverlay } from "./axes-3d-labels.ts";
import { getThemeColors, subscribeToThemeChange } from "./theme-colors.ts";

export interface ThreeSceneOptions {
  width: number;
  height: number;
  /** Camera sits at (d, d, d) looking at the origin -- 6 matches most existing panels; Graph3DCanvas/GradientDescent use 8. */
  cameraDistance?: number;
  /** AxesHelper + label extent -- 3 matches most existing panels; Graph3DCanvas uses its DOMAIN.max of 5. */
  axesExtent?: number;
}

export interface ThreeSceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** The live WebGL canvas -- feed to PngExportButton's getCanvas (renderer has preserveDrawingBuffer). */
  getCanvas: () => HTMLCanvasElement;
  /** Starts the rAF render loop (controls damping + label overlay included). Idempotent-ish: call once after mounting. */
  start: () => void;
  /** Full teardown INCLUDING forceContextLoss -- Omnigraph creates/destroys its renderer as the surface up/downgrades between 2D and 3D, and browsers cap live WebGL contexts at ~8-16, so an eagerly-released context (not just a GC-eventually one) is the difference between "downgrade is free" and "a few mode flips exhaust the tab's contexts". */
  dispose: () => void;
}

/**
 * Builds the standard scene: theme-reactive background, PerspectiveCamera
 * 50 deg at (d,d,d), antialiased renderer with preserveDrawingBuffer (PNG
 * export), OrbitControls with damping, ambient 0.6 + directional 0.8 at
 * (5,10,7), AxesHelper + CSS2D axis labels. The caller adds its own
 * content groups to `scene` and calls `start()`.
 */
export function createThreeScene(container: HTMLElement, options: ThreeSceneOptions): ThreeSceneHandle {
  const { width, height, cameraDistance = 6, axesExtent = 3 } = options;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(getThemeColors().surface);
  const unsubscribeTheme = subscribeToThemeChange(() => {
    scene.background = new THREE.Color(getThemeColors().surface);
  });

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
  camera.position.set(cameraDistance, cameraDistance, cameraDistance);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(5, 10, 7);
  scene.add(directional);
  scene.add(buildSymmetricAxesHelper(axesExtent));
  scene.add(buildAxesLabelGroup(axesExtent));
  const labelOverlay = setupCss2DOverlay(container, width, height);

  let raf = 0;
  let disposed = false;
  function tick() {
    controls.update();
    renderer.render(scene, camera);
    labelOverlay.renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    getCanvas: () => renderer.domElement,
    start: () => {
      if (!disposed && raf === 0) raf = requestAnimationFrame(tick);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      unsubscribeTheme();
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
      labelOverlay.dispose();
    },
  };
}

/** Disposes every child of a group (geometry + materials, meshes/lines/sprites alike) and empties it -- the per-rebuild cleanup every 3D panel hand-rolls. */
export function disposeGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      const mesh = node as Partial<THREE.Mesh> & THREE.Object3D;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = (mesh as THREE.Mesh).material;
      if (material) (Array.isArray(material) ? material : [material]).forEach((m) => m.dispose());
    });
  }
}

/**
 * THE axis-convention adapter (Omnigraph's top correctness risk, handled
 * in exactly one place): maps a math-library-convention point -- x/y the plane,
 * z the height -- to Three.js's y-up world as (x, z, y).
 *
 * Why this exists: the codebase has TWO conventions today.
 * `meshToGeometry` (surfaces, parametric surfaces) performs this exact
 * swap internally, so surface meshes land with height on Three's y-up
 * axis and their input plane on Three's x-z plane. But the point-list
 * samplers' consumers (SpaceCurvePanel, VectorField3DPanel,
 * ComplexGraph3DPanel) feed sampler output RAW into Vector3(x, y, z) --
 * user-z becomes screen depth there, inconsistent with the surface
 * panels. A single mixed scene has to pick one convention; Omnigraph
 * picks the surface one (it needs zero changes to the mesh pipeline) and
 * routes every point-producing item through this adapter:
 *
 * | Item type          | Sampler output meaning     | Mapping here        |
 * |--------------------|----------------------------|---------------------|
 * | spaceCurve         | (x, y, z) user coords      | (x, z, y)           |
 * | vectorField3d      | position AND direction     | both through (x,z,y)|
 * | complexGraph3d     | (x, y, z) axis-assigned    | (x, z, y)           |
 * | 2D items in 3D     | (x, y) plane, no height    | (x, 0, y)           |
 * | gradientDescent    | pre-swapped {x, f, y}      | consumed directly   |
 *
 * DOCUMENTED DIVERGENCE: a space curve's orientation here differs from
 * SpaceCurvePanel's for identical formulas (that panel renders user-z as
 * depth). Consistency within the shared scene wins over consistency with
 * the standalone panel.
 */
export function toThreePoint(p: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(p.x, p.z, p.y);
}

/** A 2D data point embedded flat on the 3D ground plane -- the surface's input plane after meshToGeometry's swap IS Three's x-z plane, so 2D (x, y) lands at (x, 0, y), consistent with where a surface evaluated over the same (x, y) sits. */
export function planePointToThree(p: { x: number; y: number }): THREE.Vector3 {
  return new THREE.Vector3(p.x, 0, p.y);
}
