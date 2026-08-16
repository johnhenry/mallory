import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsVectorField3D, type CellIdsVectorField3D } from "../lib/cell-ids.ts";
import { sampleVectorField3D, type VectorField3DPoint } from "../lib/sample-vector-field-3d.ts";
import {
  DEFAULT_VECTOR_FIELD_3D_STATE,
  decodeVectorField3DState,
  encodeVectorField3DState,
  type VectorField3DState,
} from "../lib/vector-field-3d-state.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
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
// of a fixed glyph size rather than raw-magnitude length.
const MAX_ARROW_LENGTH = 0.8;
const ARROW_COLOR = 0x2563eb;

function seedState(graph: CellGraph, ids: CellIdsVectorField3D, state: VectorField3DState): void {
  graph.set(ids.exprDx, state.exprDx);
  graph.set(ids.exprDy, state.exprDy);
  graph.set(ids.exprDz, state.exprDz);
  graph.set(ids.xMin, state.xMin);
  graph.set(ids.xMax, state.xMax);
  graph.set(ids.yMin, state.yMin);
  graph.set(ids.yMax, state.yMax);
  graph.set(ids.zMin, state.zMin);
  graph.set(ids.zMax, state.zMax);
}

function getCurrentState(graph: CellGraph, ids: CellIdsVectorField3D): VectorField3DState {
  return {
    v: 1,
    exprDx: graph.get<string>(ids.exprDx),
    exprDy: graph.get<string>(ids.exprDy),
    exprDz: graph.get<string>(ids.exprDz),
    xMin: graph.get<string>(ids.xMin),
    xMax: graph.get<string>(ids.xMax),
    yMin: graph.get<string>(ids.yMin),
    yMax: graph.get<string>(ids.yMax),
    zMin: graph.get<string>(ids.zMin),
    zMax: graph.get<string>(ids.zMax),
  };
}

function useVectorField3DGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsVectorField3D(cellId);
    const decoded = typeof window !== "undefined" ? decodeVectorField3DState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_VECTOR_FIELD_3D_STATE);

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

    ref.current = graph;
  }
  return ref.current;
}

/**
 * A 3D vector field (dx,dy,dz) = F(x,y,z), sampled on a cubic lattice and
 * rendered as arrow glyphs (part of #30, item 3) -- the 2D
 * `sampleVectorField2D`/`drawVectorField` pattern lifted one dimension.
 * A standalone panel (own CellGraph), same convention as
 * ParametricSurfacePanel: no keyframe/video-export machinery, no
 * externalGraph/notebook embedding, no undo/redo -- all deferred scope
 * matching that panel's own precedent for a first shipped version.
 */
export function VectorField3DPanel({ cellId = "vector-field-3d-1" }: { cellId?: string } = {}) {
  const graph = useVectorField3DGraph(cellId);
  useCellGraphTools(`surface3d_vectorfield_${cellId}`, graph);
  const ids = cellIdsVectorField3D(cellId);
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const exprDx = useCell<string>(graph, ids.exprDx);
  const exprDy = useCell<string>(graph, ids.exprDy);
  const exprDz = useCell<string>(graph, ids.exprDz);
  const xMin = useCell<string>(graph, ids.xMin);
  const xMax = useCell<string>(graph, ids.xMax);
  const yMin = useCell<string>(graph, ids.yMin);
  const yMax = useCell<string>(graph, ids.yMax);
  const zMin = useCell<string>(graph, ids.zMin);
  const zMax = useCell<string>(graph, ids.zMax);
  const pointsResult = useCell<Result<VectorField3DPoint[]>>(graph, ids.points);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeVectorField3DState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

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

  useEffect(() => {
    const group = groupRef.current;
    if (!group || !pointsResult.ok) return;
    for (const child of [...group.children]) group.remove(child);
    const maxMagnitude = Math.max(1e-9, ...pointsResult.value.map((p) => Math.hypot(p.dx, p.dy, p.dz)));
    for (const point of pointsResult.value) {
      const magnitude = Math.hypot(point.dx, point.dy, point.dz);
      if (magnitude < 1e-9) continue;
      const dir = new THREE.Vector3(point.dx, point.dy, point.dz).normalize();
      const origin = new THREE.Vector3(point.x, point.y, point.z);
      const length = (magnitude / maxMagnitude) * MAX_ARROW_LENGTH;
      const arrow = new THREE.ArrowHelper(dir, origin, length, ARROW_COLOR, length * 0.3, length * 0.2);
      group.add(arrow);
    }
  }, [pointsResult]);

  return (
    <div>
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
      {!pointsResult.ok && <p style={{ color: "var(--danger)" }}>{pointsResult.message}</p>}
      <div ref={containerRef} style={{ position: "relative", maxWidth: WIDTH, border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => rendererCanvasRef.current} label="vector-field-3d" />
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag to orbit, scroll to zoom.</p>
    </div>
  );
}
