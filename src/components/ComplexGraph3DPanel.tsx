import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsComplexGraph3D, type CellIdsComplexGraph3D } from "../lib/cell-ids.ts";
import {
  ALL_COMPONENTS,
  COMPONENT_LABELS,
  isValidComplexAxisAssignment,
  sampleComplexGraph,
  usedDomainComponents,
  type AxisChoice,
  type ComplexGraphSampleResult,
} from "../lib/sample-complex-graph.ts";
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
const POINT_SIZE = 0.06;

function seedComplexGraphState(graph: CellGraph, ids: CellIdsComplexGraph3D, state: ComplexGraphState): void {
  graph.set(ids.yExpr, state.yExpr);
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
    axisX: graph.get<AxisChoice>(ids.axisX),
    axisY: graph.get<AxisChoice>(ids.axisY),
    axisZ: graph.get<AxisChoice>(ids.axisZ),
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

    graph.define(ids.points, (): Result<ComplexGraphSampleResult> => {
      try {
        const assignment = {
          x: graph.get<AxisChoice>(ids.axisX),
          y: graph.get<AxisChoice>(ids.axisY),
          z: graph.get<AxisChoice>(ids.axisZ),
        };
        if (!isValidComplexAxisAssignment(assignment)) {
          throw new Error("Assign at least one axis to a component, and don't assign the same component to two axes.");
        }
        const tMin = Number(graph.get<string>(ids.tMin));
        const tMax = Number(graph.get<string>(ids.tMax));
        if (Number.isNaN(tMin) || Number.isNaN(tMax)) throw new Error("t-min and t-max must both be numbers.");
        if (tMin >= tMax) throw new Error("t-min must be less than t-max.");
        const sample = sampleComplexGraph(graph.get<string>(ids.yExpr), assignment, { min: tMin, max: tMax }, RESOLUTION);
        return { ok: true, value: sample };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = { graph, ids };
  }
  return ref.current;
}

/**
 * All 4 components plus "None" are always listed (never removed from the
 * list) -- an option is `disabled` only when it's an exact duplicate of
 * whatever the OTHER two axis dropdowns currently show; "None" is never
 * disabled, and picking it never disables anything elsewhere (multiple
 * axes can be "None" at once -- that's just an incomplete assignment,
 * surfaced as a plain error message once sampling is attempted, not
 * blocked here).
 *
 * A first version of this control ALSO disabled any choice that would
 * violate the "exactly one domain component" curve-validity rule directly
 * here, on the theory that an unreachable state is better than a
 * confusing one. In practice that made ordinary reassignment (moving
 * Im(x) from Axis Z to Axis X, say) look stuck: the value you just moved
 * OFF of an axis wouldn't reliably free up on another axis until the
 * in-between state also happened to satisfy that same strict rule. Now
 * the only thing blocked here is a literal duplicate; the domain-count
 * rule moved entirely to the sampling layer above.
 */
function AxisSelect({
  value,
  otherA,
  otherB,
  onChange,
}: {
  value: AxisChoice;
  otherA: AxisChoice;
  otherB: AxisChoice;
  onChange: (next: AxisChoice) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as AxisChoice)}>
      <option value="none">None</option>
      {ALL_COMPONENTS.map((c) => (
        <option key={c} value={c} disabled={c !== value && (c === otherA || c === otherB)}>
          {COMPONENT_LABELS[c]}
        </option>
      ))}
    </select>
  );
}

/**
 * y = f(x) with x, y both complex (issue #345): a complex "graph" has 4
 * real degrees of freedom (Re(x), Im(x), Re(y), Im(y)), and a 3D plot can
 * only show 3 at once. Any axis (X/Y/Z) may be assigned to any of the 4
 * components, or left "None" (reads as a constant 0) -- there's no longer
 * a rule requiring exactly one domain component to be dropped.
 *
 * How many of the 2 domain components (Re(x)/Im(x)) end up assigned to a
 * screen axis decides the render mode, auto-detected rather than chosen:
 * exactly 1 used sweeps a clean 1D CURVE (e.g. the classic {Re(x), Re(y),
 * Im(y)} spiral for `e^(i*x)`, rendered as a tube same as before); 0 or 2
 * used can't be captured by a single sweep, so a grid is sampled instead
 * and rendered as a SCATTER (point cloud) -- see sample-complex-graph.ts's
 * `sampleComplexGraph` for the full reasoning.
 *
 * Reuses SpaceCurvePanel's exact Three.js tube-rendering approach
 * (CatmullRomCurve3 + TubeGeometry) for the curve case unmodified; the
 * scatter case uses a plain InstancedMesh of small spheres. Single-curve
 * v1 (not the multi-row "unlimited expressions" shape most other panels
 * use) -- see complex-graph-state.ts's own doc comment.
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
  const axisX = useCell<AxisChoice>(graph, ids.axisX);
  const axisY = useCell<AxisChoice>(graph, ids.axisY);
  const axisZ = useCell<AxisChoice>(graph, ids.axisZ);
  const tMin = useCell<string>(graph, ids.tMin);
  const tMax = useCell<string>(graph, ids.tMax);
  const pointsResult = useCell<Result<ComplexGraphSampleResult>>(graph, ids.points);

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
      const result = graph.get<Result<ComplexGraphSampleResult>>(ids.points);
      if (!result.ok) return;
      const { mode, points } = result.value;
      if (points.length === 0) return;
      if (mode === "curve") {
        const vectors = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
        const curve = new THREE.CatmullRomCurve3(vectors);
        const tubularSegments = Math.max(2, vectors.length);
        const geometry = new THREE.TubeGeometry(curve, tubularSegments, TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, false);
        const material = new THREE.MeshStandardMaterial({ color: CURVE_COLOR });
        group.add(new THREE.Mesh(geometry, material));
      } else {
        // scatter: 0 or 2 domain components used (see sampleComplexGraph's
        // own doc comment) -- no single parameter order to draw a tube
        // through, so render each sample as its own small sphere instead.
        const geometry = new THREE.SphereGeometry(POINT_SIZE, 6, 6);
        const material = new THREE.MeshStandardMaterial({ color: CURVE_COLOR });
        const mesh = new THREE.InstancedMesh(geometry, material, points.length);
        const dummy = new THREE.Object3D();
        points.forEach((p, i) => {
          dummy.position.set(p.x, p.y, p.z);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        });
        group.add(mesh);
      }
    }
    rebuild();
    return graph.subscribeAll(rebuild);
  }, [graph, ids]);

  const domainUsed = usedDomainComponents({ x: axisX, y: axisY, z: axisZ });
  const modeHint =
    domainUsed.length === 1
      ? `${COMPONENT_LABELS[domainUsed[0] as "reX" | "imX"]} sweeps t from ${tMin} to ${tMax}; the other domain component is held fixed at 0. Curve.`
      : domainUsed.length === 2
        ? `Both Re(x) and Im(x) sweep t from ${tMin} to ${tMax} (a grid). Scatter.`
        : "Neither Re(x) nor Im(x) is assigned to an axis -- x is fixed at 0. A single point.";

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          y ={" "}
          <input value={yExpr} onChange={(e) => graph.set(ids.yExpr, e.target.value)} style={{ font: "inherit", width: "20ch" }} placeholder="e.g. exp(i*x)" />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Axis X: <AxisSelect value={axisX} otherA={axisY} otherB={axisZ} onChange={(v) => graph.set(ids.axisX, v)} />
        </label>
        <label>
          Axis Y: <AxisSelect value={axisY} otherA={axisX} otherB={axisZ} onChange={(v) => graph.set(ids.axisY, v)} />
        </label>
        <label>
          Axis Z: <AxisSelect value={axisZ} otherA={axisX} otherB={axisY} onChange={(v) => graph.set(ids.axisZ, v)} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          t: [<input value={tMin} onChange={(e) => graph.set(ids.tMin, e.target.value)} style={{ font: "inherit", width: "8ch" }} />,{" "}
          <input value={tMax} onChange={(e) => graph.set(ids.tMax, e.target.value)} style={{ font: "inherit", width: "8ch" }} />]
        </label>
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>{modeHint}</p>
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
