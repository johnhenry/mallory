import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsComplexGraph3D } from "../lib/cell-ids.ts";
import {
  ALL_COMPONENTS,
  COMPONENT_LABELS,
  isValidComplexAxisAssignment,
  sampleComplexGraph,
  usedDomainComponents,
  type AxisChoice,
  type ComplexGraphSampleResult,
  type DomainSweepFlags,
} from "../lib/sample-complex-graph.ts";
import {
  DEFAULT_COMPLEX_GRAPH_STATE,
  decodeComplexGraphState,
  encodeComplexGraphState,
  type ComplexGraphRowState,
  type ComplexGraphState,
} from "../lib/complex-graph-state.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
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
const POINT_SIZE = 0.06;

type SharedAxisIds = { axisX: string; axisY: string; axisZ: string; sweepReX: string; sweepImX: string };

/** Seeds one function row's own cells: its own y(x), t domain, color and visibility, and its own derived points -- reads the SHARED (container-level) axis assignment and domain-sweep toggles (#365) via `axisIds`, so every row replots automatically when the shared view changes. */
function seedComplexGraphRow(graph: CellGraph, rowId: string, axisIds: SharedAxisIds, row: ComplexGraphRowState): void {
  const ids = cellIdsComplexGraph3D(rowId);
  graph.set(ids.yExpr, row.yExpr);
  graph.set(ids.tMin, row.tMin);
  graph.set(ids.tMax, row.tMax);
  graph.set(ids.color, row.color);
  graph.set(ids.visible, row.visible);

  graph.define(ids.points, (): Result<ComplexGraphSampleResult> => {
    try {
      const assignment = {
        x: graph.get<AxisChoice>(axisIds.axisX),
        y: graph.get<AxisChoice>(axisIds.axisY),
        z: graph.get<AxisChoice>(axisIds.axisZ),
      };
      if (!isValidComplexAxisAssignment(assignment)) {
        throw new Error("Assign at least one axis to a component, and don't assign the same component to two axes.");
      }
      const tMin = Number(graph.get<string>(ids.tMin));
      const tMax = Number(graph.get<string>(ids.tMax));
      if (Number.isNaN(tMin) || Number.isNaN(tMax)) throw new Error("t-min and t-max must both be numbers.");
      if (tMin >= tMax) throw new Error("t-min must be less than t-max.");
      const sweep: DomainSweepFlags = { reX: graph.get<boolean>(axisIds.sweepReX), imX: graph.get<boolean>(axisIds.sweepImX) };
      const sample = sampleComplexGraph(graph.get<string>(ids.yExpr), assignment, { min: tMin, max: tMax }, RESOLUTION, sweep);
      return { ok: true, value: sample };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
}

function seedComplexGraphRowDefault(graph: CellGraph, rowId: string, axisIds: SharedAxisIds, index: number): void {
  seedComplexGraphRow(graph, rowId, axisIds, { ...(DEFAULT_COMPLEX_GRAPH_STATE.rows[0] as ComplexGraphRowState), color: paletteColor(index) });
}

function useComplexGraphGraph(containerId: string): { graph: CellGraph; containerIds: ReturnType<typeof cellIdsComplexGraph3D> } {
  const ref = useRef<{ graph: CellGraph; containerIds: ReturnType<typeof cellIdsComplexGraph3D> } | null>(null);
  if (!ref.current) {
    const containerIds = cellIdsComplexGraph3D(containerId);
    const graph = new CellGraph();
    const decoded = typeof window !== "undefined" ? decodeComplexGraphState(window.location.hash.slice(1)) : null;
    const state = decoded ?? DEFAULT_COMPLEX_GRAPH_STATE;

    graph.set(containerIds.axisX, state.axisX);
    graph.set(containerIds.axisY, state.axisY);
    graph.set(containerIds.axisZ, state.axisZ);
    graph.set(containerIds.sweepReX, state.sweepReX);
    graph.set(containerIds.sweepImX, state.sweepImX);

    const rowIds = state.rows.map(() => crypto.randomUUID());
    rowIds.forEach((id, i) => seedComplexGraphRow(graph, id, containerIds, state.rows[i] as ComplexGraphRowState));
    graph.set(containerIds.list, rowIds, { auxiliary: true });

    ref.current = { graph, containerIds };
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

/** One function row's controls: y(x) expression, its own t domain, color/visibility. */
function ComplexGraphRow({ graph, rowId, onRemove }: { graph: CellGraph; rowId: string; onRemove?: () => void }) {
  const ids = cellIdsComplexGraph3D(rowId);
  const yExpr = useCell<string>(graph, ids.yExpr);
  const tMin = useCell<string>(graph, ids.tMin);
  const tMax = useCell<string>(graph, ids.tMax);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const pointsResult = useCell<Result<ComplexGraphSampleResult>>(graph, ids.points);

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this function" />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        <label>
          y ={" "}
          <input value={yExpr} onChange={(e) => graph.set(ids.yExpr, e.target.value)} style={{ font: "inherit", width: "20ch" }} placeholder="e.g. exp(i*x)" />
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this function">
            ✕
          </button>
        )}
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          t: [<input value={tMin} onChange={(e) => graph.set(ids.tMin, e.target.value)} style={{ font: "inherit", width: "8ch" }} />,{" "}
          <input value={tMax} onChange={(e) => graph.set(ids.tMax, e.target.value)} style={{ font: "inherit", width: "8ch" }} />]
        </label>
      </div>
      {!pointsResult.ok && <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{pointsResult.message}</p>}
    </div>
  );
}

/**
 * y = f(x) with x, y both complex (issue #345), now unlimited functions
 * (multi-function follow-up): a complex "graph" has 4 real degrees of
 * freedom (Re(x), Im(x), Re(y), Im(y)), and a 3D plot can only show 3 at
 * once. Any axis (X/Y/Z) may be assigned to any of the 4 components, or
 * left "None" (reads as a constant 0) -- there's no rule requiring exactly
 * one domain component to be dropped. The axis assignment is shared across
 * every function (a single "view" everything is plotted against, see
 * cellIdsComplexGraph3D's own doc comment); each function gets its own
 * y(x) expression, t domain, color and visibility, the same per-row shape
 * SpaceCurvePanel/ParametricSurfacePanel/etc. (issue #251) already use.
 *
 * How many of the 2 domain components (Re(x)/Im(x)) end up assigned to a
 * screen axis decides EACH function's own render mode, auto-detected
 * rather than chosen: exactly 1 used sweeps a clean 1D CURVE (e.g. the
 * classic {Re(x), Re(y), Im(y)} spiral for `e^(i*x)`, rendered as a tube);
 * 0 or 2 used can't be captured by a single sweep, so a grid is sampled
 * instead and rendered as a SCATTER (point cloud) -- see
 * sample-complex-graph.ts's `sampleComplexGraph` for the full reasoning.
 * Mode depends only on the shared axis assignment, not on any one row's
 * own expression, so every row is in the same mode (all curves, or all
 * scatters) at any given moment.
 *
 * Reuses SpaceCurvePanel's exact Three.js tube-rendering approach
 * (CatmullRomCurve3 + TubeGeometry) for the curve case unmodified; the
 * scatter case uses a plain InstancedMesh of small spheres per row.
 */
export function ComplexGraph3DPanel({ cellId = "complex-graph-1" }: { cellId?: string } = {}) {
  const { graph, containerIds } = useComplexGraphGraph(cellId);
  useCellGraphTools(`surface3d_complexgraph_${cellId}`, graph);
  const rowIds = useCell<string[]>(graph, containerIds.list);
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const axisX = useCell<AxisChoice>(graph, containerIds.axisX);
  const axisY = useCell<AxisChoice>(graph, containerIds.axisY);
  const axisZ = useCell<AxisChoice>(graph, containerIds.axisZ);
  const sweepReX = useCell<boolean>(graph, containerIds.sweepReX);
  const sweepImX = useCell<boolean>(graph, containerIds.sweepImX);

  function addFunction() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedComplexGraphRowDefault(graph, id, containerIds, index);
  }

  function removeFunction(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsComplexGraph3D(rowId));
  }

  useEffect(() => {
    function writeUrl() {
      const state: ComplexGraphState = {
        v: 3,
        axisX: graph.get<AxisChoice>(containerIds.axisX),
        axisY: graph.get<AxisChoice>(containerIds.axisY),
        axisZ: graph.get<AxisChoice>(containerIds.axisZ),
        sweepReX: graph.get<boolean>(containerIds.sweepReX),
        sweepImX: graph.get<boolean>(containerIds.sweepImX),
        rows: graph.get<string[]>(containerIds.list).map((rowId) => {
          const ids = cellIdsComplexGraph3D(rowId);
          return {
            yExpr: graph.get<string>(ids.yExpr),
            tMin: graph.get<string>(ids.tMin),
            tMax: graph.get<string>(ids.tMax),
            color: graph.get<number>(ids.color),
            visible: graph.get<boolean>(ids.visible),
          };
        }),
      };
      window.history.replaceState(null, "", `#${encodeComplexGraphState(state)}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, containerIds]);

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

  // Rebuilds every visible row's tube/scatter into the shared group
  // whenever the row list changes or any row's own points/color/visibility
  // (or the shared axis assignment, which every row's own points depend
  // on) does -- graph.subscribeAll, same reasoning as every other
  // multi-row panel's identical rebuild.
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
      for (const rowId of graph.get<string[]>(containerIds.list)) {
        const ids = cellIdsComplexGraph3D(rowId);
        try {
          if (!graph.get<boolean>(ids.visible)) continue;
          const result = graph.get<Result<ComplexGraphSampleResult>>(ids.points);
          if (!result.ok) continue;
          const { mode, points } = result.value;
          if (points.length === 0) continue;
          const color = graph.get<number>(ids.color);
          if (mode === "curve") {
            const vectors = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
            const curve = new THREE.CatmullRomCurve3(vectors);
            const tubularSegments = Math.max(2, vectors.length);
            const geometry = new THREE.TubeGeometry(curve, tubularSegments, TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, false);
            const material = new THREE.MeshStandardMaterial({ color });
            group.add(new THREE.Mesh(geometry, material));
          } else {
            // scatter: 0 or 2 domain components used (see
            // sampleComplexGraph's own doc comment) -- no single parameter
            // order to draw a tube through, so render each sample as its
            // own small sphere instead.
            const geometry = new THREE.SphereGeometry(POINT_SIZE, 6, 6);
            const material = new THREE.MeshStandardMaterial({ color });
            const mesh = new THREE.InstancedMesh(geometry, material, points.length);
            const dummy = new THREE.Object3D();
            points.forEach((p, i) => {
              dummy.position.set(p.x, p.y, p.z);
              dummy.updateMatrix();
              mesh.setMatrixAt(i, dummy.matrix);
            });
            group.add(mesh);
          }
        } catch {
          // A row whose cells haven't registered yet -- skip it this pass.
        }
      }
    }
    rebuild();
    return graph.subscribeAll(rebuild);
  }, [graph, containerIds]);

  const domainUsed = usedDomainComponents({ x: axisX, y: axisY, z: axisZ }, { reX: sweepReX, imX: sweepImX });
  const modeHint =
    domainUsed.length === 1
      ? `${COMPONENT_LABELS[domainUsed[0] as "reX" | "imX"]} sweeps t; the other domain component is held fixed at 0. Curve.`
      : domainUsed.length === 2
        ? "Both Re(x) and Im(x) sweep t (a grid). Scatter."
        : "Neither Re(x) nor Im(x) is assigned to an axis -- x is fixed at 0. A single point.";

  return (
    <div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Axis X: <AxisSelect value={axisX} otherA={axisY} otherB={axisZ} onChange={(v) => graph.set(containerIds.axisX, v)} />
        </label>
        <label>
          Axis Y: <AxisSelect value={axisY} otherA={axisX} otherB={axisZ} onChange={(v) => graph.set(containerIds.axisY, v)} />
        </label>
        <label>
          Axis Z: <AxisSelect value={axisZ} otherA={axisX} otherB={axisY} onChange={(v) => graph.set(containerIds.axisZ, v)} />
        </label>
      </div>
      <div
        style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}
        title="Off (default): a domain component not assigned to any axis stays fixed at 0 (e.g. exp(i*x) with only Re(x)/Re(y)/Im(y) shown traces a clean curve, since Im(x) never varies). On: sweep that component across t even when it isn't shown -- lets its hidden variation show up as scatter on the visible axes (#365)."
      >
        <label>
          <input type="checkbox" checked={sweepReX} onChange={(e) => graph.set(containerIds.sweepReX, e.target.checked)} /> Re(x): complex (sweep even
          if unassigned)
        </label>
        <label>
          <input type="checkbox" checked={sweepImX} onChange={(e) => graph.set(containerIds.sweepImX, e.target.checked)} /> Im(x): complex (sweep even
          if unassigned)
        </label>
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>{modeHint}</p>
      {rowIds.map((rowId) => (
        <ComplexGraphRow key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeFunction(rowId) : undefined} />
      ))}
      <button type="button" onClick={addFunction} style={{ margin: "0.35rem 0" }}>
        + Add function
      </button>
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
