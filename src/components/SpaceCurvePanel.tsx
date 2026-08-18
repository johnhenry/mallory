import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsSpaceCurve } from "../lib/cell-ids.ts";
import { sampleSpaceCurve, SPACE_CURVE_PRESETS, type SpaceCurvePoint } from "../lib/sample-space-curve.ts";
import { DEFAULT_SPACE_CURVE_STATE, decodeSpaceCurveState, encodeSpaceCurveState, type SpaceCurveRowState } from "../lib/space-curve-state.ts";
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

/** Seeds one curve row's own cells (issue #251, unlimited expressions): its own x(t)/y(t)/z(t), t domain, color and visibility, and its own derived points. */
export function seedSpaceCurveRow(graph: CellGraph, rowId: string, row: SpaceCurveRowState): void {
  const ids = cellIdsSpaceCurve(rowId);
  graph.set(ids.exprX, row.exprX);
  graph.set(ids.exprY, row.exprY);
  graph.set(ids.exprZ, row.exprZ);
  graph.set(ids.tMin, row.tMin);
  graph.set(ids.tMax, row.tMax);
  graph.set(ids.color, row.color);
  graph.set(ids.visible, row.visible);

  graph.define(ids.points, (): Result<SpaceCurvePoint[]> => {
    try {
      const tMin = Number(graph.get<string>(ids.tMin));
      const tMax = Number(graph.get<string>(ids.tMax));
      if (Number.isNaN(tMin) || Number.isNaN(tMax)) throw new Error("t-min and t-max must both be numbers.");
      if (tMin >= tMax) throw new Error("t-min must be less than t-max.");
      const points = sampleSpaceCurve(
        graph.get<string>(ids.exprX),
        graph.get<string>(ids.exprY),
        graph.get<string>(ids.exprZ),
        { min: tMin, max: tMax },
        RESOLUTION,
      );
      if (points.length < 2) throw new Error("Not enough valid samples to draw a curve -- widen the t range or check the expressions.");
      return { ok: true, value: points };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
}

function seedSpaceCurveRowDefault(graph: CellGraph, rowId: string, index: number): void {
  seedSpaceCurveRow(graph, rowId, { ...(DEFAULT_SPACE_CURVE_STATE.rows[0] as SpaceCurveRowState), color: paletteColor(index) });
}

function useSpaceCurveGraph(containerId: string): { graph: CellGraph; containerIds: ReturnType<typeof cellIdsSpaceCurve> } {
  // `containerIds` is memoized on the ref itself, not recomputed every
  // render -- see ImplicitPanel's identical `useImplicitGraph` doc comment
  // for why (issue #236's stale-reference bug class, reintroduced by this
  // hook's own container-id object; here it would also double the
  // Three.js group rebuild on every edit, not just the redraw).
  const ref = useRef<{ graph: CellGraph; containerIds: ReturnType<typeof cellIdsSpaceCurve> } | null>(null);
  if (!ref.current) {
    const containerIds = cellIdsSpaceCurve(containerId);
    const graph = new CellGraph();
    const decoded = typeof window !== "undefined" ? decodeSpaceCurveState(window.location.hash.slice(1)) : null;
    const state = decoded ?? DEFAULT_SPACE_CURVE_STATE;
    const rowIds = state.rows.map(() => crypto.randomUUID());
    rowIds.forEach((id, i) => seedSpaceCurveRow(graph, id, state.rows[i] as SpaceCurveRowState));
    graph.set(containerIds.list, rowIds, { auxiliary: true });
    ref.current = { graph, containerIds };
  }
  return ref.current;
}

/** One curve row's controls (issue #251): preset picker, x/y/z(t) inputs, t domain, color/visibility. */
function SpaceCurveRow({ graph, rowId, onRemove }: { graph: CellGraph; rowId: string; onRemove?: () => void }) {
  const ids = cellIdsSpaceCurve(rowId);
  const exprX = useCell<string>(graph, ids.exprX);
  const exprY = useCell<string>(graph, ids.exprY);
  const exprZ = useCell<string>(graph, ids.exprZ);
  const tMin = useCell<string>(graph, ids.tMin);
  const tMax = useCell<string>(graph, ids.tMax);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const pointsResult = useCell<Result<SpaceCurvePoint[]>>(graph, ids.points);

  function loadPreset(key: string) {
    const preset = SPACE_CURVE_PRESETS[key];
    if (!preset) return;
    graph.set(ids.exprX, preset.exprX);
    graph.set(ids.exprY, preset.exprY);
    graph.set(ids.exprZ, preset.exprZ);
    graph.set(ids.tMin, String(preset.tDomain.min));
    graph.set(ids.tMax, String(preset.tDomain.max));
  }

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this curve" />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        <label>
          preset:{" "}
          <select defaultValue="helix" onChange={(e) => loadPreset(e.target.value)}>
            {Object.entries(SPACE_CURVE_PRESETS).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this curve">
            ✕
          </button>
        )}
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          x(t) = <input value={exprX} onChange={(e) => graph.set(ids.exprX, e.target.value)} style={{ font: "inherit", width: "16ch" }} />
        </label>
        <label>
          y(t) = <input value={exprY} onChange={(e) => graph.set(ids.exprY, e.target.value)} style={{ font: "inherit", width: "16ch" }} />
        </label>
        <label>
          z(t) = <input value={exprZ} onChange={(e) => graph.set(ids.exprZ, e.target.value)} style={{ font: "inherit", width: "16ch" }} />
        </label>
        <label>
          t: [<input value={tMin} onChange={(e) => graph.set(ids.tMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />,{" "}
          <input value={tMax} onChange={(e) => graph.set(ids.tMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
      </div>
      {!pointsResult.ok && <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{pointsResult.message}</p>}
    </div>
  );
}

/**
 * Unlimited parametric space curves r(t) = (x(t), y(t), z(t)) (issue #251),
 * each rendered as a real 3D tube via `THREE.CatmullRomCurve3` +
 * `THREE.TubeGeometry` (issue #30 item 2) -- deliberately bypassing
 * `Graph3DUtils`/`Mesh` entirely, unlike `sample-parametric-surface.ts`
 * (see this file's own history for why). v1 was a single curve only; every
 * curve now gets its own color/visibility, added to one shared Three.js
 * group, the same "shared scene, unlimited rows" shape ParametricSurfacePanel
 * (its issue #251 sibling) established for surfaces. Same standalone-panel
 * convention as before: own CellGraph, no keyframe/video-export, no
 * externalGraph/notebook embedding, no undo/redo.
 */
export function SpaceCurvePanel({ cellId = "space-curve-1" }: { cellId?: string } = {}) {
  const { graph, containerIds } = useSpaceCurveGraph(cellId);
  useCellGraphTools(`surface3d_spacecurve_${cellId}`, graph);
  const rowIds = useCell<string[]>(graph, containerIds.list);
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);

  function addCurve() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedSpaceCurveRowDefault(graph, id, index);
  }

  function removeCurve(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsSpaceCurve(rowId));
  }

  useEffect(() => {
    function writeUrl() {
      const rows = graph.get<string[]>(containerIds.list).map((rowId) => {
        const ids = cellIdsSpaceCurve(rowId);
        return {
          exprX: graph.get<string>(ids.exprX),
          exprY: graph.get<string>(ids.exprY),
          exprZ: graph.get<string>(ids.exprZ),
          tMin: graph.get<string>(ids.tMin),
          tMax: graph.get<string>(ids.tMax),
          color: graph.get<number>(ids.color),
          visible: graph.get<boolean>(ids.visible),
        };
      });
      window.history.replaceState(null, "", `#${encodeSpaceCurveState({ v: 2, rows })}`);
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
    };
  }, []);

  // Rebuilds every visible row's tube into the shared group whenever the
  // row list changes or any row's own points/color/visibility does --
  // graph.subscribeAll rather than per-row useCell hooks, same reasoning as
  // every other multi-row panel.
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
        const ids = cellIdsSpaceCurve(rowId);
        try {
          if (!graph.get<boolean>(ids.visible)) continue;
          const pointsResult = graph.get<Result<SpaceCurvePoint[]>>(ids.points);
          if (!pointsResult.ok) continue;
          const vectors = pointsResult.value.map((p) => new THREE.Vector3(p.x, p.y, p.z));
          const curve = new THREE.CatmullRomCurve3(vectors);
          const tubularSegments = Math.max(2, vectors.length);
          const geometry = new THREE.TubeGeometry(curve, tubularSegments, TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, false);
          const material = new THREE.MeshStandardMaterial({ color: graph.get<number>(ids.color) });
          group.add(new THREE.Mesh(geometry, material));
        } catch {
          // A row whose cells haven't registered yet -- skip it this pass.
        }
      }
    }
    rebuild();
    return graph.subscribeAll(rebuild);
  }, [graph, containerIds]);

  return (
    <div>
      {rowIds.map((rowId) => (
        <SpaceCurveRow key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeCurve(rowId) : undefined} />
      ))}
      <button type="button" onClick={addCurve} style={{ margin: "0.35rem 0" }}>
        + Add curve
      </button>
      <div ref={containerRef} style={{ position: "relative", maxWidth: WIDTH, border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => rendererCanvasRef.current} label="space-curve" />
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag to orbit, scroll to zoom.</p>
    </div>
  );
}
