import { useServerFn } from "@tanstack/react-start";
import type { Mesh } from "@johnhenry/math";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CellGraph } from "@johnhenry/math";
import { cellIdsGradientDescent, TIME_CELL, type CellIdsGradientDescent } from "../lib/cell-ids.ts";
import { computeContourLevels, type ContourLevel } from "../lib/contour-plot.ts";
import { startGradientDescentExportJob } from "../lib/export-gradient-descent-video.ts";
import {
  DEFAULT_GRADIENT_DESCENT_STATE,
  decodeGradientDescentState,
  encodeGradientDescentState,
  type GradientDescentState,
} from "../lib/gradient-descent-state.ts";
import { runGradientDescent, type DescentPoint, type DescentResult, type OptimizerType } from "../lib/gradient-descent.ts";
import { meshToGeometry, meshToMaterial } from "../lib/mesh-to-geometry.ts";
import { drawAxes, drawImplicitCurve, drawPoint, drawPolyline } from "../lib/render-path.ts";
import { sampleSurface } from "../lib/sample-surface.ts";
import { getThemeColors, subscribeToThemeChange } from "../lib/theme-colors.ts";
import { buildAxesLabelGroup, buildSymmetricAxesHelper, setupCss2DOverlay } from "../lib/axes-3d-labels.ts";
import { useTimelinePlayback } from "../lib/use-timeline-playback.ts";
import { canvasEventPoint, toDataX, toDataY, type Viewport } from "../lib/viewport.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { TransportControls } from "./TransportControls.tsx";
import { VideoExportControls } from "./VideoExportControls.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export interface OptimizerRun {
  optimizer: OptimizerType;
  result: DescentResult;
}

const WIDTH = 520;
const HEIGHT = 520;
const VIEWPORT: Viewport = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
const DOMAIN = { min: -5, max: 5 };
const SURFACE_RESOLUTION = 40;
// Per-step transport animation (issue #33's remaining scope): 1 descent
// step = this many seconds of the shared TIME_CELL clock, so the default
// 80-step run plays back over 8s -- watchable, not instant, not a slog.
export const STEP_SECONDS = 0.1;

/** The longest racing path's step count (paths can differ in length -- a diverged run stops early). Empty/no-runs gives 0, not -Infinity. */
export function maxDescentSteps(runs: readonly OptimizerRun[]): number {
  return Math.max(0, ...runs.map((run) => run.result.path.length - 1));
}

/** The index into a (possibly shorter, already-stopped) run's own path the shared clock currently points at -- clamped so a fast/short-diverged run just holds its last point once the clock outruns it, rather than reading past the array end. */
export function visiblePathIndex(time: number, pathLength: number): number {
  return Math.min(Math.floor(time / STEP_SECONDS), pathLength - 1);
}

export interface ThreePoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Maps a racing run's path onto the 3D surface's Three.js-space, growing
 * with the shared clock via the same `visiblePathIndex` the 2D canvas uses
 * -- so the 3D polyline and the 2D polyline always show the same prefix of
 * the same path. @johnhenry/math's height (the loss value `f`) maps to
 * Three's y-axis and @johnhenry/math's y maps to Three's z-axis, matching
 * `mesh-to-geometry.ts`'s surface-mesh convention so the path visually sits
 * on the sampled surface rather than floating in a different frame.
 * Framework-agnostic (no `THREE` import) so it's plainly unit-testable.
 */
export function descentPathTo3DPoints(path: readonly DescentPoint[], time: number): ThreePoint[] {
  if (path.length === 0) return [];
  const lastIndex = visiblePathIndex(time, path.length);
  return path.slice(0, lastIndex + 1).map((p) => ({ x: p.x, y: p.f, z: p.y }));
}

const OPTIMIZER_COLORS: Record<OptimizerType, string> = {
  sgd: "#2563eb",
  adam: "#dc2626",
  rmsprop: "#16a34a",
};

const OPTIMIZER_LABELS: Record<OptimizerType, string> = {
  sgd: "SGD",
  adam: "Adam",
  rmsprop: "RMSprop",
};

function seedState(graph: CellGraph, ids: CellIdsGradientDescent, state: GradientDescentState): void {
  graph.set(ids.exprText, state.exprText);
  graph.set(ids.startX, state.startX);
  graph.set(ids.startY, state.startY);
  graph.set(ids.lr, state.lr);
  graph.set(ids.steps, state.steps);
  graph.set(ids.showSgd, state.showSgd);
  graph.set(ids.showAdam, state.showAdam);
  graph.set(ids.showRmsprop, state.showRmsprop);
  graph.set(ids.useSchedule, state.useSchedule ?? DEFAULT_GRADIENT_DESCENT_STATE.useSchedule);
  graph.set(ids.stepSize, state.stepSize ?? DEFAULT_GRADIENT_DESCENT_STATE.stepSize);
  graph.set(ids.gamma, state.gamma ?? DEFAULT_GRADIENT_DESCENT_STATE.gamma);
  graph.set(ids.momentum, state.momentum ?? DEFAULT_GRADIENT_DESCENT_STATE.momentum);
  graph.set(ids.nesterov, state.nesterov ?? DEFAULT_GRADIENT_DESCENT_STATE.nesterov);
}

function getCurrentState(graph: CellGraph, ids: CellIdsGradientDescent): GradientDescentState {
  return {
    v: 1,
    exprText: graph.get<string>(ids.exprText),
    startX: graph.get<string>(ids.startX),
    startY: graph.get<string>(ids.startY),
    lr: graph.get<string>(ids.lr),
    steps: graph.get<string>(ids.steps),
    showSgd: graph.get<boolean>(ids.showSgd),
    showAdam: graph.get<boolean>(ids.showAdam),
    showRmsprop: graph.get<boolean>(ids.showRmsprop),
    useSchedule: graph.get<boolean>(ids.useSchedule),
    stepSize: graph.get<string>(ids.stepSize),
    gamma: graph.get<string>(ids.gamma),
    momentum: graph.get<string>(ids.momentum),
    nesterov: graph.get<boolean>(ids.nesterov),
  };
}

function useGradientDescentGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsGradientDescent(cellId);
    const decoded = typeof window !== "undefined" ? decodeGradientDescentState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_GRADIENT_DESCENT_STATE);
    if (!graph.has(TIME_CELL)) graph.set(TIME_CELL, 0, { auxiliary: true });

    graph.define(ids.contoursResult, (): Result<ContourLevel[]> => {
      try {
        return { ok: true, value: computeContourLevels(graph.get<string>(ids.exprText), DOMAIN, DOMAIN, 80, 10) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.surfaceMesh, (): Result<Mesh[]> => {
      try {
        return { ok: true, value: sampleSurface(graph.get<string>(ids.exprText), DOMAIN, DOMAIN, SURFACE_RESOLUTION) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.descentResults, (): Result<OptimizerRun[]> => {
      try {
        const exprText = graph.get<string>(ids.exprText);
        const startX = Number(graph.get<string>(ids.startX));
        const startY = Number(graph.get<string>(ids.startY));
        const lr = Number(graph.get<string>(ids.lr));
        const steps = Number(graph.get<string>(ids.steps));
        const enabled: OptimizerType[] = [];
        if (graph.get<boolean>(ids.showSgd)) enabled.push("sgd");
        if (graph.get<boolean>(ids.showAdam)) enabled.push("adam");
        if (graph.get<boolean>(ids.showRmsprop)) enabled.push("rmsprop");
        let schedule: { stepSize: number; gamma: number } | undefined;
        if (graph.get<boolean>(ids.useSchedule)) {
          const stepSize = Number(graph.get<string>(ids.stepSize));
          const gamma = Number(graph.get<string>(ids.gamma));
          if (!Number.isInteger(stepSize) || stepSize <= 0) throw new Error("Schedule step size must be a positive integer.");
          if (!Number.isFinite(gamma) || gamma <= 0) throw new Error("Schedule gamma must be a positive number.");
          schedule = { stepSize, gamma };
        }
        const momentum = Number(graph.get<string>(ids.momentum));
        if (!Number.isFinite(momentum)) throw new Error("SGD momentum must be a number.");
        const sgdMomentum = { momentum, nesterov: graph.get<boolean>(ids.nesterov) };
        // Same expression, same start, same lr/steps/schedule/momentum --
        // the runs differ ONLY by optimizer, which is what makes the
        // overlay a genuine race. sgdMomentum is harmlessly ignored by
        // runGradientDescent for the adam/rmsprop runs.
        const runs = enabled.map((optimizer) => ({
          optimizer,
          result: runGradientDescent(exprText, startX, startY, optimizer, lr, steps, schedule, sgdMomentum),
        }));
        return { ok: true, value: runs };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/**
 * Gradient descent on f(x, y), visualized as optimizer paths over a contour
 * plot (issue #33): the full Symbolic -> compileExpr -> asVariableOp ->
 * Variable.backward() -> optim chain, with SGD/Adam/RMSprop racing from the
 * same start point in different colors. Click the canvas to move the start.
 *
 * v1 renders on the 2D contour view (reusing #28's computeContourLevels) --
 * the contour picture is where optimizer-behavior differences (SGD's
 * zigzag across an anisotropic valley vs Adam's per-coordinate scaling)
 * actually read clearly. A second Three.js pane (issue #33's last
 * remaining scope item) renders the same racing paths as growing 3D
 * polylines directly on the sampled loss surface, sharing this panel's own
 * `CellGraph`/`TIME_CELL` rather than mounting a second clock -- see
 * `descentPathTo3DPoints` and the scene-setup effects below. An optional
 * `optim.StepLR` schedule (stepSize/gamma) is available, applied uniformly
 * to every racing optimizer -- off by default. Each racing path plays back
 * per-step on the shared TIME_CELL clock (STEP_SECONDS per step) via the
 * same TransportControls/useTimelinePlayback machinery GraphCanvas/
 * Graph3DCanvas already use, rather than rendering the whole path at once.
 */
/**
 * Pure re-render of the 2D contour canvas, extracted from the draw effect
 * below so `PngExportButton`'s `renderAtScale` (issue #278) can call it
 * against a fresh offscreen canvas at any size. Time-varying (the descent
 * paths animate on `TIME_CELL`), so this captures a single frame's state,
 * same as every other animated panel's PNG export.
 */
export function drawGradientDescentContour(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  contoursResult: Result<ContourLevel[]>,
  descentResults: Result<OptimizerRun[]>,
  startX: string,
  startY: string,
  time: number,
): void {
  ctx.clearRect(0, 0, width, height);
  drawAxes(ctx, VIEWPORT, width, height);
  if (contoursResult.ok) {
    for (const level of contoursResult.value) {
      drawImplicitCurve(ctx, level.segments, VIEWPORT, width, height, "rgba(148, 163, 184, 0.6)");
    }
  }
  if (descentResults.ok) {
    for (const run of descentResults.value) {
      const lastIndex = visiblePathIndex(time, run.result.path.length);
      drawPolyline(ctx, run.result.path.slice(0, lastIndex + 1), VIEWPORT, width, height, OPTIMIZER_COLORS[run.optimizer]);
      const current = run.result.path[lastIndex];
      if (current) drawPoint(ctx, current, VIEWPORT, width, height, 4, OPTIMIZER_COLORS[run.optimizer]);
    }
  }
  const sx = Number(startX);
  const sy = Number(startY);
  if (Number.isFinite(sx) && Number.isFinite(sy)) {
    drawPoint(ctx, { x: sx, y: sy }, VIEWPORT, width, height, 6, getThemeColors().ink);
  }
}

export function GradientDescentPanel({ cellId = "gd-1" }: { cellId?: string } = {}) {
  const graph = useGradientDescentGraph(cellId);
  useCellGraphTools(`gradient_descent_${cellId}`, graph);
  const ids = cellIdsGradientDescent(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const containerRef3D = useRef<HTMLDivElement | null>(null);
  const surfaceGroupRef = useRef<THREE.Group | null>(null);
  const pathGroupRef = useRef<THREE.Group | null>(null);
  const rendererCanvasRef3D = useRef<HTMLCanvasElement | null>(null);
  // Populated by the mount-once 3D effect below -- lets `renderThreeAtScale`
  // (issue #278) build a temporary offscreen renderer around this panel's
  // existing scene/camera without touching the live on-screen renderer.
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const exprText = useCell<string>(graph, ids.exprText);
  const startX = useCell<string>(graph, ids.startX);
  const startY = useCell<string>(graph, ids.startY);
  const lr = useCell<string>(graph, ids.lr);
  const steps = useCell<string>(graph, ids.steps);
  const showSgd = useCell<boolean>(graph, ids.showSgd);
  const showAdam = useCell<boolean>(graph, ids.showAdam);
  const showRmsprop = useCell<boolean>(graph, ids.showRmsprop);
  const useSchedule = useCell<boolean>(graph, ids.useSchedule);
  const stepSize = useCell<string>(graph, ids.stepSize);
  const gamma = useCell<string>(graph, ids.gamma);
  const momentum = useCell<string>(graph, ids.momentum);
  const nesterov = useCell<boolean>(graph, ids.nesterov);
  const contoursResult = useCell<Result<ContourLevel[]>>(graph, ids.contoursResult);
  const descentResults = useCell<Result<OptimizerRun[]>>(graph, ids.descentResults);
  const surfaceMeshResult = useCell<Result<Mesh[]>>(graph, ids.surfaceMesh);
  const time = useCell<number>(graph, TIME_CELL);
  const startGradientDescentExportJobFn = useServerFn(startGradientDescentExportJob);

  const [exprInput, setExprInput] = useState(exprText);
  useEffect(() => {
    setExprInput(exprText);
  }, [exprText]);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const maxSteps = descentResults.ok ? maxDescentSteps(descentResults.value) : 0;
  const duration = maxSteps * STEP_SECONDS;
  useTimelinePlayback(graph, playing, loop, speed, duration, setPlaying);
  // A fresh descent (new expression/start/lr/steps/optimizer set) restarts
  // the animation from the beginning rather than leaving the scrub head
  // wherever it was -- otherwise a shorter new run could leave `time` past
  // its own `duration`, silently showing the full path with no way to
  // "rewind" via the slider (its own max already shrank to match).
  useEffect(() => {
    graph.set(TIME_CELL, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descentResults]);

  // subscribeMany (not subscribeAll, issue #242 -- follow-up to #235) --
  // getCurrentState only reads the fixed cell list below, never TIME_CELL,
  // so a subscribeAll here used to re-run writeUrl on every RAF tick of
  // per-step playback of the precomputed optimizer trajectory even though
  // the URL never encodes playback position at all.
  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeGradientDescentState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeMany(
      [
        ids.exprText,
        ids.startX,
        ids.startY,
        ids.lr,
        ids.steps,
        ids.showSgd,
        ids.showAdam,
        ids.showRmsprop,
        ids.useSchedule,
        ids.stepSize,
        ids.gamma,
        ids.momentum,
        ids.nesterov,
      ],
      writeUrl,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawGradientDescentContour(ctx, WIDTH, HEIGHT, contoursResult, descentResults, startX, startY, time);
  }, [contoursResult, descentResults, startX, startY, time]);

  // Mount-once 3D scene setup (issue #33's remaining scope: the racing
  // paths, additionally animated as a polyline on the loss surface itself)
  // -- same scene/camera/renderer/controls boilerplate as SpaceCurvePanel/
  // Graph3DCanvas. Shares this panel's existing TIME_CELL clock/
  // TransportControls rather than mounting a second one.
  useEffect(() => {
    const container = containerRef3D.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getThemeColors().surface);
    const unsubscribeTheme = subscribeToThemeChange(() => {
      scene.background = new THREE.Color(getThemeColors().surface);
    });

    const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 1000);
    camera.position.set(8, 8, 8);
    sceneRef.current = scene;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(WIDTH, HEIGHT, false);
    container.appendChild(renderer.domElement);
    rendererCanvasRef3D.current = renderer.domElement;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 7);
    scene.add(directional);
    scene.add(buildSymmetricAxesHelper(DOMAIN.max));
    scene.add(buildAxesLabelGroup(DOMAIN.max));
    const labelOverlay = setupCss2DOverlay(container, WIDTH, HEIGHT);

    const surfaceGroup = new THREE.Group();
    surfaceGroupRef.current = surfaceGroup;
    scene.add(surfaceGroup);

    const pathGroup = new THREE.Group();
    pathGroupRef.current = pathGroup;
    scene.add(pathGroup);

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
      surfaceGroupRef.current = null;
      pathGroupRef.current = null;
      rendererCanvasRef3D.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  // Rebuilds the loss surface mesh only when it actually changes (typing a
  // new expression), not every animation frame.
  useEffect(() => {
    const group = surfaceGroupRef.current;
    if (!group || !surfaceMeshResult.ok) return;
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
      }
    }
    for (const mesh of surfaceMeshResult.value) group.add(new THREE.Mesh(meshToGeometry(mesh), meshToMaterial(mesh)));
  }, [surfaceMeshResult]);

  // Rebuilds the racing paths' 3D polylines every time the shared clock
  // advances, mirroring the 2D canvas's own per-frame slice-and-redraw
  // (`visiblePathIndex`) so both views always show the same prefix.
  useEffect(() => {
    const group = pathGroupRef.current;
    if (!group) return;
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
      }
    }
    if (!descentResults.ok) return;
    for (const run of descentResults.value) {
      const points = descentPathTo3DPoints(run.result.path, time);
      if (points.length === 0) continue;
      const vectors = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const color = OPTIMIZER_COLORS[run.optimizer];
      if (vectors.length >= 2) {
        const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
        group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })));
      }
      const tip = vectors[vectors.length - 1];
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), new THREE.MeshStandardMaterial({ color }));
      marker.position.copy(tip);
      group.add(marker);
    }
  }, [descentResults, time]);

  function setStartFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { sx, sy } = canvasEventPoint(e, canvas, WIDTH, HEIGHT);
    graph.set(ids.startX, toDataX(sx, VIEWPORT, WIDTH).toFixed(3));
    graph.set(ids.startY, toDataY(sy, VIEWPORT, HEIGHT).toFixed(3));
  }

  // True drag interaction (issue #33's remaining scope) -- a plain click
  // still works (pointerdown+pointerup with no move in between sets the
  // point once, same as the old onClick), but the start point now also
  // follows the pointer continuously while held down, rather than only
  // jumping on release.
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setStartFromEvent(e);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!draggingRef.current) return;
    setStartFromEvent(e);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function updateExpr(value: string) {
    setExprInput(value);
    graph.set(ids.exprText, value);
  }

  return (
    <div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          f(x, y) = <input value={exprInput} onChange={(e) => updateExpr(e.target.value)} style={{ font: "inherit", width: "20ch" }} />
        </label>
        <label>
          lr: <input value={lr} onChange={(e) => graph.set(ids.lr, e.target.value)} style={{ font: "inherit", width: "7ch" }} />
        </label>
        <label>
          steps:{" "}
          <input
            type="number"
            min={1}
            max={2000}
            value={steps}
            onChange={(e) => graph.set(ids.steps, e.target.value)}
            style={{ font: "inherit", width: "7ch" }}
          />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          start x: <input value={startX} onChange={(e) => graph.set(ids.startX, e.target.value)} style={{ font: "inherit", width: "7ch" }} />
        </label>
        <label>
          start y: <input value={startY} onChange={(e) => graph.set(ids.startY, e.target.value)} style={{ font: "inherit", width: "7ch" }} />
        </label>
        <label style={{ color: OPTIMIZER_COLORS.sgd }}>
          <input type="checkbox" checked={showSgd} onChange={(e) => graph.set(ids.showSgd, e.target.checked)} /> SGD
        </label>
        <label style={{ color: OPTIMIZER_COLORS.adam }}>
          <input type="checkbox" checked={showAdam} onChange={(e) => graph.set(ids.showAdam, e.target.checked)} /> Adam
        </label>
        <label style={{ color: OPTIMIZER_COLORS.rmsprop }}>
          <input type="checkbox" checked={showRmsprop} onChange={(e) => graph.set(ids.showRmsprop, e.target.checked)} /> RMSprop
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          <input type="checkbox" checked={useSchedule} onChange={(e) => graph.set(ids.useSchedule, e.target.checked)} /> StepLR
          schedule
        </label>
        {useSchedule && (
          <>
            <label>
              step size:{" "}
              <input
                type="number"
                min={1}
                value={stepSize}
                onChange={(e) => graph.set(ids.stepSize, e.target.value)}
                style={{ font: "inherit", width: "6ch" }}
              />
            </label>
            <label>
              gamma: <input value={gamma} onChange={(e) => graph.set(ids.gamma, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
            </label>
          </>
        )}
      </div>
      {showSgd && (
        <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ color: OPTIMIZER_COLORS.sgd }}>
            SGD momentum:{" "}
            <input
              type="number"
              min={0}
              max={0.999}
              step="any"
              value={momentum}
              onChange={(e) => graph.set(ids.momentum, e.target.value)}
              style={{ font: "inherit", width: "6ch" }}
            />
          </label>
          <label style={{ color: OPTIMIZER_COLORS.sgd }}>
            <input
              type="checkbox"
              checked={nesterov}
              disabled={Number(momentum) === 0}
              onChange={(e) => graph.set(ids.nesterov, e.target.checked)}
            />{" "}
            Nesterov
          </label>
        </div>
      )}
      {!contoursResult.ok && <p style={{ color: "var(--danger)" }}>{contoursResult.message}</p>}
      {!descentResults.ok && <p style={{ color: "var(--danger)" }}>{descentResults.message}</p>}
      {!surfaceMeshResult.ok && <p style={{ color: "var(--danger)" }}>{surfaceMeshResult.message}</p>}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ border: "1px solid var(--border)", maxWidth: "100%", cursor: "crosshair", touchAction: "none" }}
        />
        <div ref={containerRef3D} style={{ position: "relative", width: WIDTH, height: HEIGHT, maxWidth: "100%", border: "1px solid var(--border)" }} />
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="gradient-descent"
          renderAtScale={(ctx, width, height) => drawGradientDescentContour(ctx, width, height, contoursResult, descentResults, startX, startY, time)}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
        <PngExportButton
          getCanvas={() => rendererCanvasRef3D.current}
          label="gradient-descent-3d"
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
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        3D view: drag to orbit, scroll to zoom -- the racing paths animate on the surface with the same transport clock as the contour view.
      </p>
      <TransportControls
        graph={graph}
        time={time}
        duration={duration}
        playing={playing}
        setPlaying={setPlaying}
        loop={loop}
        setLoop={setLoop}
        speed={speed}
        setSpeed={setSpeed}
      />
      <VideoExportControls
        filenameStem="mallory-gradient-descent"
        start={(format, videoDuration) =>
          startGradientDescentExportJobFn({
            data: {
              exprText,
              startX: Number(startX),
              startY: Number(startY),
              lr: Number(lr),
              steps: Number(steps),
              optimizers: [
                ...(showSgd ? (["sgd"] as const) : []),
                ...(showAdam ? (["adam"] as const) : []),
                ...(showRmsprop ? (["rmsprop"] as const) : []),
              ],
              useSchedule,
              stepSize: useSchedule ? Number(stepSize) : undefined,
              gamma: useSchedule ? Number(gamma) : undefined,
              momentum: Number(momentum),
              nesterov,
              duration: videoDuration,
              format,
            },
          })
        }
      />
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>Click or drag on the plot to move the start point.</p>
      {descentResults.ok && (
        <ul style={{ margin: "0.25rem 0" }}>
          {descentResults.value.map((run) => {
            const last = run.result.path[run.result.path.length - 1];
            if (!last) return null;
            return (
              <li key={run.optimizer} style={{ color: OPTIMIZER_COLORS[run.optimizer] }}>
                {OPTIMIZER_LABELS[run.optimizer]}: ({last.x.toFixed(4)}, {last.y.toFixed(4)}), f = {last.f.toExponential(3)} after{" "}
                {run.result.path.length - 1} step{run.result.path.length === 2 ? "" : "s"}
                {run.result.stoppedEarly ? " -- diverged (stopped early)" : ""}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
