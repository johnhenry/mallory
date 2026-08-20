import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsComplexGraph3D, type CellIdsComplexGraph3D } from "../lib/cell-ids.ts";
import {
  COMPONENT_LABELS,
  isValidCurveAxisAssignment,
  sampleComplexGraphCurve,
  type ComplexComponent,
} from "../lib/sample-complex-graph.ts";
import type { SpaceCurvePoint } from "../lib/sample-space-curve.ts";
import {
  DEFAULT_COMPLEX_GRAPH_STATE,
  decodeComplexGraphState,
  encodeComplexGraphState,
  type ComplexGraphState,
} from "../lib/complex-graph-state.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { getThemeColors, subscribeToThemeChange } from "../lib/theme-colors.ts";
import { buildAxesLabelGroup, setupCss2DOverlay } from "../lib/axes-3d-labels.ts";
import { PngExportButton } from "./PngExportButton.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const WIDTH = 500;
const HEIGHT = 500;
const RESOLUTION = 300;
const TUBE_RADIUS = 0.05;
const TUBE_RADIAL_SEGMENTS = 8;
const CURVE_COLOR = 0x9333ea;

const ALL_COMPONENTS: ComplexComponent[] = ["reX", "imX", "reY", "imY"];
/** Only Re(x)/Im(x) are valid drop choices in this panel -- dropping a range component (Re(y)/Im(y)) produces a surface, issue #345's own documented follow-up, not this panel's job. */
const DROPPABLE_COMPONENTS: ComplexComponent[] = ["reX", "imX"];

function seedComplexGraphState(graph: CellGraph, ids: CellIdsComplexGraph3D, state: ComplexGraphState): void {
  graph.set(ids.yExpr, state.yExpr);
  graph.set(ids.drop, state.drop);
  graph.set(ids.axisX, state.axisX);
  graph.set(ids.axisY, state.axisY);
  graph.set(ids.axisZ, state.axisZ);
  graph.set(ids.tMin, state.tMin);
  graph.set(ids.tMax, state.tMax);
}

function getCurrentComplexGraphState(graph: CellGraph, ids: CellIdsComplexGraph3D): ComplexGraphState {
  return {
    v: 1,
    yExpr: graph.get<string>(ids.yExpr),
    drop: graph.get<ComplexComponent>(ids.drop),
    axisX: graph.get<ComplexComponent>(ids.axisX),
    axisY: graph.get<ComplexComponent>(ids.axisY),
    axisZ: graph.get<ComplexComponent>(ids.axisZ),
    tMin: graph.get<string>(ids.tMin),
    tMax: graph.get<string>(ids.tMax),
  };
}

function useComplexGraphGraph(cellId: string): { graph: CellGraph; ids: CellIdsComplexGraph3D } {
  const ref = useRef<{ graph: CellGraph; ids: CellIdsComplexGraph3D } | null>(null);
  if (!ref.current) {
    const ids = cellIdsComplexGraph3D(cellId);
    const graph = new CellGraph();
    const decoded = typeof window !== "undefined" ? decodeComplexGraphState(window.location.hash.slice(1)) : null;
    seedComplexGraphState(graph, ids, decoded ?? DEFAULT_COMPLEX_GRAPH_STATE);

    graph.define(ids.points, (): Result<SpaceCurvePoint[]> => {
      try {
        const assignment = {
          drop: graph.get<ComplexComponent>(ids.drop),
          x: graph.get<ComplexComponent>(ids.axisX),
          y: graph.get<ComplexComponent>(ids.axisY),
          z: graph.get<ComplexComponent>(ids.axisZ),
        };
        if (!isValidCurveAxisAssignment(assignment)) {
          throw new Error("Every one of Re(x)/Im(x)/Re(y)/Im(y) must be assigned to exactly one of Drop/X/Y/Z, and Drop must be Re(x) or Im(x).");
        }
        const tMin = Number(graph.get<string>(ids.tMin));
        const tMax = Number(graph.get<string>(ids.tMax));
        if (Number.isNaN(tMin) || Number.isNaN(tMax)) throw new Error("t-min and t-max must both be numbers.");
        if (tMin >= tMax) throw new Error("t-min must be less than t-max.");
        const points = sampleComplexGraphCurve(graph.get<string>(ids.yExpr), assignment, { min: tMin, max: tMax }, RESOLUTION);
        if (points.length < 2) throw new Error("Not enough valid samples to draw a curve -- widen the t range or check the expression.");
        return { ok: true, value: points };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = { graph, ids };
  }
  return ref.current;
}

/**
 * A dropdown restricted to whichever components AREN'T already used
 * elsewhere in the assignment (plus its own current value, so it doesn't
 * disappear from its own list) -- this is what keeps "Drop + X + Y + Z" a
 * valid bijection onto the 4 components by construction, rather than
 * needing a separate validation-error path the user has to notice and fix.
 */
function ComponentSelect({
  value,
  usedElsewhere,
  restrictToDroppable,
  onChange,
}: {
  value: ComplexComponent;
  usedElsewhere: Set<ComplexComponent>;
  restrictToDroppable?: boolean;
  onChange: (next: ComplexComponent) => void;
}) {
  const pool = restrictToDroppable ? DROPPABLE_COMPONENTS : ALL_COMPONENTS;
  const options = pool.filter((c) => c === value || !usedElsewhere.has(c));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as ComplexComponent)}>
      {options.map((c) => (
        <option key={c} value={c}>
          {COMPONENT_LABELS[c]}
        </option>
      ))}
    </select>
  );
}

/**
 * y = f(x) with x, y both complex (issue #345): a complex "graph" has 4
 * real degrees of freedom (Re(x), Im(x), Re(y), Im(y)), and a 3D plot can
 * only show 3 -- so one is always dropped (held fixed at 0). Dropping a
 * DOMAIN component (Re(x) or Im(x), this panel's only supported case)
 * leaves the other domain component as a single free real parameter `t`
 * tracing a CURVE, up to 2 of whose remaining axes come from Re(y)/Im(y).
 * The classic example: drop Im(x), axes {Re(x), Re(y), Im(y)} -- `e^(i*x)`
 * traces a spiral (a unit circle in the Re(y)/Im(y) plane while Re(x) runs
 * along the third axis).
 *
 * Dropping a RANGE component instead (Re(y) or Im(y)) would leave BOTH
 * domain components free, sweeping a 2D surface -- a well-defined, separate
 * follow-up (see #345), not implemented here; this panel only accepts a
 * domain-component drop.
 *
 * Reuses SpaceCurvePanel's exact Three.js tube-rendering approach
 * (CatmullRomCurve3 + TubeGeometry) unmodified -- the only new code is the
 * complex-valued sampling layer (`sample-complex-graph.ts`) that feeds it
 * plain {x,y,z} points in the same shape SpaceCurvePanel already renders.
 * Single-curve v1 (not the multi-row "unlimited expressions" shape most
 * other panels use) -- see complex-graph-state.ts's own doc comment.
 */
export function ComplexGraph3DPanel({ cellId = "complex-graph-1" }: { cellId?: string } = {}) {
  const { graph, ids } = useComplexGraphGraph(cellId);
  useCellGraphTools(`surface3d_complexgraph_${cellId}`, graph);
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const yExpr = useCell<string>(graph, ids.yExpr);
  const drop = useCell<ComplexComponent>(graph, ids.drop);
  const axisX = useCell<ComplexComponent>(graph, ids.axisX);
  const axisY = useCell<ComplexComponent>(graph, ids.axisY);
  const axisZ = useCell<ComplexComponent>(graph, ids.axisZ);
  const tMin = useCell<string>(graph, ids.tMin);
  const tMax = useCell<string>(graph, ids.tMax);
  const pointsResult = useCell<Result<SpaceCurvePoint[]>>(graph, ids.points);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeComplexGraphState(getCurrentComplexGraphState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, ids]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getThemeColors().surface);
    const unsubscribeTheme = subscribeToThemeChange(() => {
      scene.background = new THREE.Color(getThemeColors().surface);
    });

    const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 1000);
    camera.position.set(6, 6, 6);
    sceneRef.current = scene;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(WIDTH, HEIGHT, false);
    container.appendChild(renderer.domElement);
    rendererCanvasRef.current = renderer.domElement;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 7);
    scene.add(directional);
    scene.add(new THREE.AxesHelper(3));
    scene.add(buildAxesLabelGroup(3));
    const labelOverlay = setupCss2DOverlay(container, WIDTH, HEIGHT);

    const group = new THREE.Group();
    groupRef.current = group;
    scene.add(group);

    let raf = 0;
    function tick() {
      controls.update();
      renderer.render(scene, camera);
      labelOverlay.renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribeTheme();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      labelOverlay.dispose();
      groupRef.current = null;
      rendererCanvasRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  // Rebuilds the single tube whenever the curve's own cells change --
  // graph.subscribeAll, same reasoning as SpaceCurvePanel's identical rebuild.
  useEffect(() => {
    function rebuild() {
      const group = groupRef.current;
      if (!group) return;
      for (const child of [...group.children]) {
        group.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
        }
      }
      const result = graph.get<Result<SpaceCurvePoint[]>>(ids.points);
      if (!result.ok) return;
      const vectors = result.value.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const curve = new THREE.CatmullRomCurve3(vectors);
      const tubularSegments = Math.max(2, vectors.length);
      const geometry = new THREE.TubeGeometry(curve, tubularSegments, TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, false);
      const material = new THREE.MeshStandardMaterial({ color: CURVE_COLOR });
      group.add(new THREE.Mesh(geometry, material));
    }
    rebuild();
    return graph.subscribeAll(rebuild);
  }, [graph, ids]);

  const used = new Set<ComplexComponent>([drop, axisX, axisY, axisZ]);
  function usedElsewhere(current: ComplexComponent): Set<ComplexComponent> {
    const s = new Set(used);
    s.delete(current);
    return s;
  }

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          y ={" "}
          <input value={yExpr} onChange={(e) => graph.set(ids.yExpr, e.target.value)} style={{ font: "inherit", width: "20ch" }} placeholder="e.g. exp(i*x)" />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label title="Held fixed at 0 -- must be Re(x) or Im(x); dropping Re(y)/Im(y) would produce a surface, a separate follow-up (issue #345).">
          Drop: <ComponentSelect value={drop} usedElsewhere={usedElsewhere(drop)} restrictToDroppable onChange={(v) => graph.set(ids.drop, v)} />
        </label>
        <label>
          Axis X: <ComponentSelect value={axisX} usedElsewhere={usedElsewhere(axisX)} onChange={(v) => graph.set(ids.axisX, v)} />
        </label>
        <label>
          Axis Y: <ComponentSelect value={axisY} usedElsewhere={usedElsewhere(axisY)} onChange={(v) => graph.set(ids.axisY, v)} />
        </label>
        <label>
          Axis Z: <ComponentSelect value={axisZ} usedElsewhere={usedElsewhere(axisZ)} onChange={(v) => graph.set(ids.axisZ, v)} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          t: [<input value={tMin} onChange={(e) => graph.set(ids.tMin, e.target.value)} style={{ font: "inherit", width: "8ch" }} />,{" "}
          <input value={tMax} onChange={(e) => graph.set(ids.tMax, e.target.value)} style={{ font: "inherit", width: "8ch" }} />]
        </label>
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        {COMPONENT_LABELS[drop]} is held fixed at 0; {COMPONENT_LABELS[axisX]} sweeps t from {tMin} to {tMax}.
      </p>
      {!pointsResult.ok && <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{pointsResult.message}</p>}
      <div ref={containerRef} style={{ position: "relative", maxWidth: WIDTH, border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => rendererCanvasRef.current}
          label="complex-graph-3d"
          renderThreeAtScale={(canvas, width, height) => {
            if (!sceneRef.current || !cameraRef.current) return;
            const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
            renderer.setSize(width, height, false);
            renderer.render(sceneRef.current, cameraRef.current);
            renderer.dispose();
          }}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag to orbit, scroll to zoom.</p>
    </div>
  );
}
