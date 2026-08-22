import type { Mesh } from "@johnhenry/math";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CellGraph } from "@johnhenry/math";
import { cellIdsParametricSurface, type CellIdsParametricSurface } from "../lib/cell-ids.ts";
import { meshToGeometry, meshToMaterial } from "../lib/mesh-to-geometry.ts";
import { PARAMETRIC_PRESETS, sampleParametricSurface } from "../lib/sample-parametric-surface.ts";
import {
  DEFAULT_PARAMETRIC_SURFACE_STATE,
  decodeParametricSurfaceState,
  encodeParametricSurfaceState,
  type ParametricSurfaceRowState,
  type ParametricSurfaceState,
} from "../lib/parametric-surface-state.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useUndoHistory } from "../hooks/use-undo-history.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
import { useCell } from "../lib/use-cell.ts";
import { getThemeColors, subscribeToThemeChange } from "../lib/theme-colors.ts";
import { buildAxesLabelGroup, buildSymmetricAxesHelper, setupCss2DOverlay } from "../lib/axes-3d-labels.ts";
import { PngExportButton } from "./PngExportButton.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const WIDTH = 500;
const HEIGHT = 500;
const RESOLUTION = 30;

/** Seeds one surface row's own cells (issue #251, unlimited expressions): its own x(u,v)/y(u,v)/z(u,v), u/v domain, color and visibility, and its own derived mesh. */
export function seedParametricSurfaceRow(graph: CellGraph, rowId: string, row: ParametricSurfaceRowState): void {
  const ids = cellIdsParametricSurface(rowId);
  graph.set(ids.exprX, row.exprX);
  graph.set(ids.exprY, row.exprY);
  graph.set(ids.exprZ, row.exprZ);
  graph.set(ids.uMin, row.uMin);
  graph.set(ids.uMax, row.uMax);
  graph.set(ids.vMin, row.vMin);
  graph.set(ids.vMax, row.vMax);
  graph.set(ids.color, row.color);
  graph.set(ids.visible, row.visible);

  graph.define(ids.mesh, (): Result<Mesh[]> => {
    try {
      const uMin = Number(graph.get<string>(ids.uMin));
      const uMax = Number(graph.get<string>(ids.uMax));
      const vMin = Number(graph.get<string>(ids.vMin));
      const vMax = Number(graph.get<string>(ids.vMax));
      if ([uMin, uMax, vMin, vMax].some(Number.isNaN)) throw new Error("u/v bounds must be numbers.");
      if (uMin >= uMax) throw new Error("u-min must be less than u-max.");
      if (vMin >= vMax) throw new Error("v-min must be less than v-max.");
      const mesh = sampleParametricSurface(
        graph.get<string>(ids.exprX),
        graph.get<string>(ids.exprY),
        graph.get<string>(ids.exprZ),
        { min: uMin, max: uMax },
        { min: vMin, max: vMax },
        RESOLUTION,
        {},
        graph.get<number>(ids.color),
      );
      return { ok: true, value: mesh };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
}

function seedParametricSurfaceRowDefault(graph: CellGraph, rowId: string, index: number): void {
  seedParametricSurfaceRow(graph, rowId, { ...DEFAULT_PARAMETRIC_SURFACE_STATE.rows[0], color: paletteColor(index) } as ParametricSurfaceRowState);
}

export function getCurrentState(graph: CellGraph, containerIds: ReturnType<typeof cellIdsParametricSurface>): ParametricSurfaceState {
  const rowIds = graph.get<string[]>(containerIds.list);
  return {
    v: 2,
    rows: rowIds.map((rowId) => {
      const ids: CellIdsParametricSurface = cellIdsParametricSurface(rowId);
      return {
        exprX: graph.get<string>(ids.exprX),
        exprY: graph.get<string>(ids.exprY),
        exprZ: graph.get<string>(ids.exprZ),
        uMin: graph.get<string>(ids.uMin),
        uMax: graph.get<string>(ids.uMax),
        vMin: graph.get<string>(ids.vMin),
        vMax: graph.get<string>(ids.vMax),
        color: graph.get<number>(ids.color),
        visible: graph.get<boolean>(ids.visible),
      };
    }),
  };
}

/** Restores a previously-snapshotted state (undo/redo) -- follows GraphCanvasMulti's own restoreMultiGraphState ordering: new rows seeded and the list swapped FIRST, old rows' cells deleted after. */
export function restoreState(graph: CellGraph, containerIds: ReturnType<typeof cellIdsParametricSurface>, state: ParametricSurfaceState): void {
  const oldIds = graph.get<string[]>(containerIds.list);
  const newIds = state.rows.map(() => crypto.randomUUID());
  newIds.forEach((id, i) => seedParametricSurfaceRow(graph, id, state.rows[i] as ParametricSurfaceRowState));
  graph.set(containerIds.list, newIds);
  for (const rowId of oldIds) {
    const ids = cellIdsParametricSurface(rowId);
    for (const cellId of Object.values(ids)) {
      if (typeof cellId === "string") graph.delete(cellId);
    }
  }
}

function useParametricSurfaceGraph(containerId: string): { graph: CellGraph; containerIds: ReturnType<typeof cellIdsParametricSurface> } {
  // `containerIds` is memoized on the ref itself, not recomputed every
  // render -- see ImplicitPanel's identical `useImplicitGraph` doc comment
  // for why (issue #236's stale-reference bug class, reintroduced by this
  // hook's own container-id object; here it would also double the
  // Three.js group rebuild on every edit, not just the redraw).
  const ref = useRef<{ graph: CellGraph; containerIds: ReturnType<typeof cellIdsParametricSurface> } | null>(null);
  if (!ref.current) {
    const containerIds = cellIdsParametricSurface(containerId);
    const graph = new CellGraph();
    const decoded = typeof window !== "undefined" ? decodeParametricSurfaceState(window.location.hash.slice(1)) : null;
    const state = decoded ?? DEFAULT_PARAMETRIC_SURFACE_STATE;
    const rowIds = state.rows.map(() => crypto.randomUUID());
    rowIds.forEach((id, i) => seedParametricSurfaceRow(graph, id, state.rows[i] as ParametricSurfaceRowState));
    graph.set(containerIds.list, rowIds, { auxiliary: true });
    ref.current = { graph, containerIds };
  }
  return ref.current;
}

/** One surface row's controls (issue #251): preset picker, x/y/z(u,v) inputs, u/v domain, color/visibility. */
function ParametricSurfaceRow({ graph, rowId, onRemove }: { graph: CellGraph; rowId: string; onRemove?: () => void }) {
  const ids = cellIdsParametricSurface(rowId);
  const exprX = useCell<string>(graph, ids.exprX);
  const exprY = useCell<string>(graph, ids.exprY);
  const exprZ = useCell<string>(graph, ids.exprZ);
  const uMin = useCell<string>(graph, ids.uMin);
  const uMax = useCell<string>(graph, ids.uMax);
  const vMin = useCell<string>(graph, ids.vMin);
  const vMax = useCell<string>(graph, ids.vMax);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);
  const meshResult = useCell<Result<Mesh[]>>(graph, ids.mesh);

  function loadPreset(key: string) {
    const preset = PARAMETRIC_PRESETS[key];
    if (!preset) return;
    graph.set(ids.exprX, preset.exprX);
    graph.set(ids.exprY, preset.exprY);
    graph.set(ids.exprZ, preset.exprZ);
    graph.set(ids.uMin, String(preset.uDomain.min));
    graph.set(ids.uMax, String(preset.uDomain.max));
    graph.set(ids.vMin, String(preset.vDomain.min));
    graph.set(ids.vMax, String(preset.vDomain.max));
  }

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this surface" />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        <label>
          preset:{" "}
          <select defaultValue="torus" onChange={(e) => loadPreset(e.target.value)}>
            {Object.entries(PARAMETRIC_PRESETS).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this surface">
            ✕
          </button>
        )}
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          x(u,v) = <input value={exprX} onChange={(e) => graph.set(ids.exprX, e.target.value)} style={{ font: "inherit", width: "18ch" }} />
        </label>
        <label>
          y(u,v) = <input value={exprY} onChange={(e) => graph.set(ids.exprY, e.target.value)} style={{ font: "inherit", width: "18ch" }} />
        </label>
        <label>
          z(u,v) = <input value={exprZ} onChange={(e) => graph.set(ids.exprZ, e.target.value)} style={{ font: "inherit", width: "18ch" }} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          u: [<input value={uMin} onChange={(e) => graph.set(ids.uMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />,{" "}
          <input value={uMax} onChange={(e) => graph.set(ids.uMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
        <label>
          v: [<input value={vMin} onChange={(e) => graph.set(ids.vMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />,{" "}
          <input value={vMax} onChange={(e) => graph.set(ids.vMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
      </div>
      {!meshResult.ok && <p style={{ color: "var(--danger)", fontSize: "0.8rem" }}>{meshResult.message}</p>}
    </div>
  );
}

/**
 * Unlimited parametric surfaces r(u,v) = (x(u,v), y(u,v), z(u,v)) (issue
 * #251) -- torus/sphere/Möbius-strip presets plus free-typed x/y/z
 * expressions, each surface added to one shared Three.js scene/group with
 * its own color and visibility, overlaid the same way GraphCanvasMulti
 * overlays unlimited y=f(x) curves on one shared canvas. v1 was a single
 * surface only. A standalone panel (own CellGraph, no keyframe/video-export
 * machinery) rather than folded into Graph3DCanvas's much heavier z=f(x,y)
 * pipeline -- see this file's own history for why.
 */
export function ParametricSurfacePanel({ cellId = "param-surface-1" }: { cellId?: string } = {}) {
  const { graph, containerIds } = useParametricSurfaceGraph(cellId);
  useCellGraphTools(`surface3d_parametric_${cellId}`, graph);
  const rowIds = useCell<string[]>(graph, containerIds.list);
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Populated by the mount-once effect below -- lets `renderThreeAtScale`
  // (issue #278) build a temporary offscreen renderer around this panel's
  // existing scene/camera without touching the live on-screen renderer.
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Issue #43's undo/redo, extended to the whole row list (issue #251):
  // getCurrentState/restoreState (above) snapshot/restore every surface
  // row, not just one row's fields, the same "full serializable state"
  // shape GraphCanvasMulti's own useUndoHistory usage relies on.
  const history = useUndoHistory(
    graph,
    () => getCurrentState(graph, containerIds),
    (state) => restoreState(graph, containerIds, state),
  );

  function addSurface() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedParametricSurfaceRowDefault(graph, id, index);
  }

  function removeSurface(rowId: string) {
    removeRow(graph, containerIds.list, rowId, cellIdsParametricSurface(rowId));
  }

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeParametricSurfaceState(getCurrentState(graph, containerIds))}`);
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
    scene.add(buildSymmetricAxesHelper(3));
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

  // Rebuilds every visible row's mesh into the shared group whenever the
  // row list changes or any row's own mesh/visibility does --
  // graph.subscribeAll rather than per-row useCell hooks, same reasoning as
  // every other multi-row panel: a fixed hook-per-row list can't track a
  // dynamic row count.
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
        const ids = cellIdsParametricSurface(rowId);
        try {
          if (!graph.get<boolean>(ids.visible)) continue;
          const meshResult = graph.get<Result<Mesh[]>>(ids.mesh);
          if (!meshResult.ok) continue;
          for (const surfaceMesh of meshResult.value) {
            group.add(new THREE.Mesh(meshToGeometry(surfaceMesh), meshToMaterial(surfaceMesh)));
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
        <ParametricSurfaceRow key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeSurface(rowId) : undefined} />
      ))}
      <button type="button" onClick={addSurface} style={{ margin: "0.35rem 0" }}>
        + Add surface
      </button>
      <div ref={containerRef} style={{ position: "relative", maxWidth: WIDTH, border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => rendererCanvasRef.current}
          label="parametric-surface"
          renderThreeAtScale={(canvas, width, height) => {
            if (!sceneRef.current || !cameraRef.current) return;
            const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
            renderer.setSize(width, height, false);
            renderer.render(sceneRef.current, cameraRef.current);
            renderer.dispose();
          }}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />{" "}
        <button type="button" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z / Cmd+Z)">
          ↩ Undo
        </button>{" "}
        <button type="button" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z / Cmd+Y)">
          ↪ Redo
        </button>
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag to orbit, scroll to zoom.</p>
    </div>
  );
}
