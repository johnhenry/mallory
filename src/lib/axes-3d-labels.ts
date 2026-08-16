import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { computeNiceTicks } from "./render-path.ts";

/** Matches THREE.AxesHelper's own default red/green/blue X/Y/Z line coloring, so a tick label reads as "belonging" to its axis without needing an "x"/"y"/"z" name suffix -- same reasoning drawAxes' 2D tick labels carry no axis name, just the number. */
const AXIS_COLORS = { x: "#dc2626", y: "#16a34a", z: "#2563eb" } as const;

/**
 * Numeric tick labels for a `THREE.AxesHelper(extent)`'s 3 lines (issue
 * #150 item 2) -- the 3D companion to `drawAxes`/`axesToSvgElements`'s 2D
 * tick marks. Three has no built-in text-mesh primitive, so each label is a
 * `CSS2DObject` (a plain positioned `<div>`, rendered by a separate
 * `CSS2DRenderer` overlay -- see `setupCss2DOverlay` below), not a canvas
 * sprite texture.
 *
 * Ticks span `[-extent, extent]` on every axis, matching every current
 * `AxesHelper(extent)` call site's own symmetric domain, spaced via the
 * same `computeNiceTicks` D3-style "nice numbers" algorithm the 2D
 * `drawAxes`/`axesToSvgElements` already use, so tick density/rounding
 * matches the rest of the app rather than introducing a second convention.
 * The origin's "0" is labeled once (not once per axis), matching
 * `drawAxes`' own single-origin-label convention.
 */
export function buildAxesLabelGroup(extent: number, targetTickCount = 5): THREE.Group {
  const group = new THREE.Group();
  for (const v of computeNiceTicks(-extent, extent, targetTickCount)) {
    if (v === 0) {
      group.add(makeLabel(new THREE.Vector3(0, 0, 0), "0", AXIS_COLORS.x));
      continue;
    }
    group.add(makeLabel(new THREE.Vector3(v, 0, 0), String(v), AXIS_COLORS.x));
    group.add(makeLabel(new THREE.Vector3(0, v, 0), String(v), AXIS_COLORS.y));
    group.add(makeLabel(new THREE.Vector3(0, 0, v), String(v), AXIS_COLORS.z));
  }
  return group;
}

function makeLabel(position: THREE.Vector3, text: string, color: string): CSS2DObject {
  const div = document.createElement("div");
  div.textContent = text;
  div.style.color = color;
  div.style.fontSize = "11px";
  div.style.fontFamily = "system-ui, sans-serif";
  div.style.pointerEvents = "none";
  const label = new CSS2DObject(div);
  label.position.copy(position);
  return label;
}

/**
 * Creates and appends a `CSS2DRenderer` overlay sized to exactly match a
 * `WebGLRenderer`'s canvas -- the caller's `container` must already be
 * (or become) CSS-positioned (`position: relative` or similar) so the
 * overlay's `position: absolute` lands directly on top of the WebGL canvas
 * rather than the page's own top-left corner. `pointerEvents: "none"` keeps
 * label text from intercepting `OrbitControls`' own drag/scroll handling on
 * the WebGL canvas underneath. `dispose()` only needs to remove the
 * overlay's own root element -- `CSS2DObject`'s own `"removed"` listener
 * handles individual label `<div>`s, and removing the root takes its whole
 * subtree with it regardless.
 */
export function setupCss2DOverlay(container: HTMLElement, width: number, height: number): { renderer: CSS2DRenderer; dispose: () => void } {
  const renderer = new CSS2DRenderer();
  renderer.setSize(width, height);
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.top = "0";
  renderer.domElement.style.left = "0";
  renderer.domElement.style.pointerEvents = "none";
  container.appendChild(renderer.domElement);
  return {
    renderer,
    dispose: () => {
      container.removeChild(renderer.domElement);
    },
  };
}
