import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsSpaceCurve, type CellIdsSpaceCurve } from "../lib/cell-ids.ts";
import { sampleSpaceCurve, SPACE_CURVE_PRESETS, type SpaceCurvePoint } from "../lib/sample-space-curve.ts";
import { DEFAULT_SPACE_CURVE_STATE, decodeSpaceCurveState, encodeSpaceCurveState, type SpaceCurveState } from "../lib/space-curve-state.ts";
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
const TUBE_COLOR = 0x2563eb;

function seedState(graph: CellGraph, ids: CellIdsSpaceCurve, state: SpaceCurveState): void {
  graph.set(ids.exprX, state.exprX);
  graph.set(ids.exprY, state.exprY);
  graph.set(ids.exprZ, state.exprZ);
  graph.set(ids.tMin, state.tMin);
  graph.set(ids.tMax, state.tMax);
}

function getCurrentState(graph: CellGraph, ids: CellIdsSpaceCurve): SpaceCurveState {
  return {
    v: 1,
    exprX: graph.get<string>(ids.exprX),
    exprY: graph.get<string>(ids.exprY),
    exprZ: graph.get<string>(ids.exprZ),
    tMin: graph.get<string>(ids.tMin),
    tMax: graph.get<string>(ids.tMax),
  };
}

function useSpaceCurveGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsSpaceCurve(cellId);
    const decoded = typeof window !== "undefined" ? decodeSpaceCurveState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_SPACE_CURVE_STATE);

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

    ref.current = graph;
  }
  return ref.current;
}

/**
 * A parametric space curve r(t) = (x(t), y(t), z(t)), rendered as a real 3D
 * tube via `THREE.CatmullRomCurve3` + `THREE.TubeGeometry` (issue #30 item
 * 2) -- deliberately bypassing `Graph3DUtils`/`Mesh` entirely, unlike
 * `sample-parametric-surface.ts`. That was a hard requirement, not a style
 * choice: `Graph3DUtils.create3DCurveSegment`, the function this item was
 * originally scoped to build on, was verified broken (silently discards a
 * segment's z-direction, producing a flat 2D ribbon for any genuinely-3D
 * input -- see the issue's own empirical writeup). Same standalone-panel
 * convention as VectorField3DPanel/ParametricSurfacePanel: own CellGraph,
 * no keyframe/video-export, no externalGraph/notebook embedding, no
 * undo/redo.
 */
export function SpaceCurvePanel({ cellId = "space-curve-1" }: { cellId?: string } = {}) {
  const graph = useSpaceCurveGraph(cellId);
  useCellGraphTools(`surface3d_spacecurve_${cellId}`, graph);
  const ids = cellIdsSpaceCurve(cellId);
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const exprX = useCell<string>(graph, ids.exprX);
  const exprY = useCell<string>(graph, ids.exprY);
  const exprZ = useCell<string>(graph, ids.exprZ);
  const tMin = useCell<string>(graph, ids.tMin);
  const tMax = useCell<string>(graph, ids.tMax);
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

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeSpaceCurveState(getCurrentState(graph, ids))}`);
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
    const vectors = pointsResult.value.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(vectors);
    const tubularSegments = Math.max(2, vectors.length);
    const geometry = new THREE.TubeGeometry(curve, tubularSegments, TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, false);
    const material = new THREE.MeshStandardMaterial({ color: TUBE_COLOR });
    group.add(new THREE.Mesh(geometry, material));
  }, [pointsResult]);

  return (
    <div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
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
      {!pointsResult.ok && <p style={{ color: "var(--danger)" }}>{pointsResult.message}</p>}
      <div ref={containerRef} style={{ position: "relative", maxWidth: WIDTH, border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => rendererCanvasRef.current} label="space-curve" />
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag to orbit, scroll to zoom.</p>
    </div>
  );
}
