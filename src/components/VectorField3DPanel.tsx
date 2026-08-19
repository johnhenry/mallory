import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsVectorField3D } from "../lib/cell-ids.ts";
import { sampleVectorField3D, type VectorField3DPoint } from "../lib/sample-vector-field-3d.ts";
import { DEFAULT_VECTOR_FIELD_3D_STATE, decodeVectorField3DState, encodeVectorField3DState, type VectorField3DRowState } from "../lib/vector-field-3d-state.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
import { useCell } from "../lib/use-cell.ts";
import { getThemeColors, subscribeToThemeChange } from "../lib/theme-colors.ts";
import { buildAxesLabelGroup, setupCss2DOverlay } from "../lib/axes-3d-labels.ts";
import { PngExportButton } from "./PngExportButton.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const WIDTH = 500;
const HEIGHT = 500;
const GRID_DENSITY = 5;
// Caps arrow length so a large-magnitude sample doesn't dwarf the plot --
// direction still reads correctly, matching drawVectorField's 2D convention
// of a fixed glyph size rather than raw-magnitude length. Normalized PER
// ROW (issue #251) against that row's own max sampled magnitude, the same
// "each row draws independently of its siblings" convention every other
// multi-row panel in this app follows -- two overlaid fields of very
// different overall scale both still read as full-length arrows near their
// own strongest sample, rather than one field's arrows shrinking to
// near-invisible next to a much stronger sibling field.
const MAX_ARROW_LENGTH = 0.8;

/** Seeds one field row's own cells (issue #251, unlimited expressions): its own dx/dy/dz(x,y,z), sampling box, color and visibility, and its own derived points. */
export function seedVectorField3DRow(graph: CellGraph, rowId: string, row: VectorField3DRowState): void {
  const ids = cellIdsVectorField3D(rowId);
  graph.set(ids.exprDx, row.exprDx);
  graph.set(ids.exprDy, row.exprDy);
  graph.set(ids.exprDz, row.exprDz);
  graph.set(ids.xMin, row.xMin);
  graph.set(ids.xMax, row.xMax);
  graph.set(ids.yMin, row.yMin);
  graph.set(ids.yMax, row.yMax);
  graph.set(ids.zMin, row.zMin);
  graph.set(ids.zMax, row.zMax);
  graph.set(ids.color, row.color);
  graph.set(ids.visible, row.visible);

  graph.define(ids.points, (): Result<VectorField3DPoint[]> => {
    try {
      const xMin = Number(graph.get<string>(ids.xMin));
      const xMax = Number(graph.get<string>(ids.xMax));
      const yMin = Number(graph.get<string>(ids.yMin));
      const yMax = Number(graph.get<string>(ids.yMax));
      const zMin = Number(graph.get<string>(ids.zMin));
      const zMax = Number(graph.get<string>(ids.zMax));
      if ([xMin, xMax, yMin, yMax, zMin, zMax].some(Number.isNaN)) throw new Error("Domain bounds must all be numbers.");
      if (xMin >= xMax) throw new Error("x-min must be less than x-max.");
      if (yMin >= yMax) throw new Error("y-min must be less than y-max.");
      if (zMin >= zMax) throw new Error("z-min must be less than z-max.");
      const points = sampleVectorField3D(
        graph.get<string>(ids.exprDx),
        graph.get<string>(ids.exprDy),
        graph.get<string>(ids.exprDz),
        { min: xMin, max: xMax },
        { min: yMin, max: yMax },
        { min: zMin, max: zMax },
        GRID_DENSITY,
      );
      return { ok: true, value: points };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
}

function seedVectorField3DRowDefault(graph: CellGraph, rowId: string, index: number): void {
  seedVectorField3DRow(graph, rowId, { ...(DEFAULT_VECTOR_FIELD_3D_STATE.rows[0] as VectorField3DRowState), color: paletteColor(index) });
}

function useVectorField3DGraph(containerId: string): { graph: CellGraph; containerIds: ReturnType<typeof cellIdsVectorField3D> } {
  // `containerIds` is memoized on the ref itself, not recomputed every
  // render -- see ImplicitPanel's identical `useImplicitGraph` doc comment
  // for why (issue #236's stale-reference bug class, reintroduced by this
  // hook's own container-id object; here it would also double the
  // Three.js group rebuild on every edit, not just the redraw).
  const ref = useRef<{ graph: CellGraph; containerIds: ReturnType<typeof cellIdsVectorField3D> } | null>(null);
  if (!ref.current) {
    const containerIds = cellIdsVectorField3D(containerId);
    const graph = new CellGraph();
    const decoded = typeof window !== "undefined" ? decodeVectorField3DState(window.location.hash.slice(1)) : null;
    const state = decoded ?? DEFAULT_VECTOR_FIELD_3D_STATE;
    const rowIds = state.rows.map(() => crypto.randomUUID());
    rowIds.forEach((id, i) => seedVectorField3DRow(graph, id, state.rows[i] as VectorField3DRowState));
    graph.set(containerIds.list, rowIds, { auxiliary: true });
    ref.current = { graph, containerIds };
  }
  return ref.current;
}

/** One field row's controls (issue #251): dx/dy/dz(x,y,z) inputs, sampling box, color/visibility. */
function VectorField3DRow({ graph, rowId, onRemove }: { graph: CellGraph; rowId: string; onRemove?: () => void }) {
  const ids = cellIdsVectorField3D(rowId);
  const exprDx = useCell<string>(graph, ids.exprDx);
  const exprDy = useCell<string>(graph, ids.exprDy);
  const exprDz = useCell<string>(graph, ids.exprDz);
  const xMin = useCell<string>(graph, ids.xMin);
  const xMax = useCell<string>(graph, ids.xMax);
  const yMin = useCell<string>(graph, ids.yMin);
  const yMax = useCell<string>(graph, ids.yMax);
  const zMin = useCell<string>(graph, ids.zMin);
  const zMax = useCell<string>(graph, ids.zMax);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const pointsResult = useCell<Result<VectorField3DPoint[]>>(graph, ids.points);

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this field" />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this field">
            ✕
          </button>
        )}
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          dx(x,y,z) = <input value={exprDx} onChange={(e) => graph.set(ids.exprDx, e.target.value)} style={{ font: "inherit", width: "14ch" }} />
        </label>
        <label>
          dy(x,y,z) = <input value={exprDy} onChange={(e) => graph.set(ids.exprDy, e.target.value)} style={{ font: "inherit", width: "14ch" }} />
        </label>
        <label>
          dz(x,y,z) = <input value={exprDz} onChange={(e) => graph.set(ids.exprDz, e.target.value)} style={{ font: "inherit", width: "14ch" }} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          x: [<input value={xMin} onChange={(e) => graph.set(ids.xMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />,{" "}
          <input value={xMax} onChange={(e) => graph.set(ids.xMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
        <label>
          y: [<input value={yMin} onChange={(e) => graph.set(ids.yMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />,{" "}
          <input value={yMax} onChange={(e) => graph.set(ids.yMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
        <label>
          z: [<input value={zMin} onChange={(e) => graph.set(ids.zMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />,{" "}
          <input value={zMax} onChange={(e) => graph.set(ids.zMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
      </div>
      {!pointsResult.ok && <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{pointsResult.message}</p>}
    </div>
  );
}

/**
 * Unlimited 3D vector fields (dx,dy,dz) = F(x,y,z) (issue #251), each
 * sampled on its own cubic lattice and rendered as arrow glyphs (part of
 * #30, item 3) -- the 2D `sampleVectorField2D`/`drawVectorField` pattern
 * lifted one dimension. v1 was a single field only; every field now gets
 * its own color/visibility, added to one shared Three.js group, the same
 * "shared scene, unlimited rows" shape ParametricSurfacePanel/
 * SpaceCurvePanel (its issue #251 siblings) established. Same
 * standalone-panel convention as before: own CellGraph, no keyframe/
 * video-export machinery, no externalGraph/notebook embedding, no
 * undo/redo.
 */
export function VectorField3DPanel({ cellId = "vector-field-3d-1" }: { cellId?: string } = {}) {
  const { graph, containerIds } = useVectorField3DGraph(cellId);
  useCellGraphTools(`surface3d_vectorfield_${cellId}`, graph);
  const rowIds = useCell<string[]>(graph, containerIds.list);
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Populated by the mount-once effect below -- lets `renderThreeAtScale`
  // (issue #278) build a temporary offscreen renderer around this panel's
  // existing scene/camera without touching the live on-screen renderer.
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  function addField() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedVectorField3DRowDefault(graph, id, index);
  }

  function removeField(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsVectorField3D(rowId));
  }

  useEffect(() => {
    function writeUrl() {
      const rows = graph.get<string[]>(containerIds.list).map((rowId) => {
        const ids = cellIdsVectorField3D(rowId);
        return {
          exprDx: graph.get<string>(ids.exprDx),
          exprDy: graph.get<string>(ids.exprDy),
          exprDz: graph.get<string>(ids.exprDz),
          xMin: graph.get<string>(ids.xMin),
          xMax: graph.get<string>(ids.xMax),
          yMin: graph.get<string>(ids.yMin),
          yMax: graph.get<string>(ids.yMax),
          zMin: graph.get<string>(ids.zMin),
          zMax: graph.get<string>(ids.zMax),
          color: graph.get<number>(ids.color),
          visible: graph.get<boolean>(ids.visible),
        };
      });
      window.history.replaceState(null, "", `#${encodeVectorField3DState({ v: 2, rows })}`);
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

  // Rebuilds every visible row's arrows into the shared group whenever the
  // row list changes or any row's own points/color/visibility does --
  // graph.subscribeAll rather than per-row useCell hooks, same reasoning as
  // every other multi-row panel.
  useEffect(() => {
    function rebuild() {
      const group = groupRef.current;
      if (!group) return;
      for (const child of [...group.children]) {
        group.remove(child);
        // ArrowHelper has no top-level .geometry/.material -- its cone/line
        // sub-objects hold them, and ArrowHelper.dispose() (see three.js's
        // own source) is the sanctioned way to free the per-instance
        // materials.
        if (child instanceof THREE.ArrowHelper) child.dispose();
      }
      for (const rowId of graph.get<string[]>(containerIds.list)) {
        const ids = cellIdsVectorField3D(rowId);
        try {
          if (!graph.get<boolean>(ids.visible)) continue;
          const pointsResult = graph.get<Result<VectorField3DPoint[]>>(ids.points);
          if (!pointsResult.ok) continue;
          const color = graph.get<number>(ids.color);
          const maxMagnitude = Math.max(1e-9, ...pointsResult.value.map((p) => Math.hypot(p.dx, p.dy, p.dz)));
          for (const point of pointsResult.value) {
            const magnitude = Math.hypot(point.dx, point.dy, point.dz);
            if (magnitude < 1e-9) continue;
            const dir = new THREE.Vector3(point.dx, point.dy, point.dz).normalize();
            const origin = new THREE.Vector3(point.x, point.y, point.z);
            const length = (magnitude / maxMagnitude) * MAX_ARROW_LENGTH;
            const arrow = new THREE.ArrowHelper(dir, origin, length, color, length * 0.3, length * 0.2);
            group.add(arrow);
          }
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
        <VectorField3DRow key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeField(rowId) : undefined} />
      ))}
      <button type="button" onClick={addField} style={{ margin: "0.35rem 0" }}>
        + Add field
      </button>
      <div ref={containerRef} style={{ position: "relative", maxWidth: WIDTH, border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => rendererCanvasRef.current}
          label="vector-field-3d"
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
