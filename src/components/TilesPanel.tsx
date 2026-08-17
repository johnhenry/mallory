import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsTiles, TIME_CELL, type CellIdsTiles } from "../lib/cell-ids.ts";
import { DEFAULT_CUBE_TILES_TEXT, parseCubeTileSetText } from "../lib/cube-tile-set-text.ts";
import { DEFAULT_HEX_TILES_TEXT, parseHexTileSetText } from "../lib/hex-tile-set-text.ts";
import { DEFAULT_TILES_TEXT, parseTileSetText } from "../lib/tile-set-text.ts";
import {
  DEFAULT_TILES_STATE,
  decodeTilesState,
  encodeTilesState,
  type TilesLattice,
  type TilesSolverKind,
  type TilesState,
} from "../lib/tiles-state.ts";
import { solveCube, type CubeGrid, type CubeTileSet } from "../lib/tiles/cube-tile-model.ts";
import { relaxWangTiling, type RelaxResult } from "../lib/tiles/differentiable-relax.ts";
import { autocorrelationSurface, diffractionSpectrum, tileIdsPresent } from "../lib/tiles/diffraction.ts";
import { stripEntropy, type StripEntropyResult } from "../lib/tiles/entropy.ts";
import { hexCenter, hexCorners } from "../lib/tiles/hex-geometry.ts";
import { solveHex, type HexGrid, type HexTileSet } from "../lib/tiles/hex-tile-model.ts";
import { expandTileSetSymmetry, type SymmetryGroup } from "../lib/tiles/symmetry.ts";
import { solveTorus, solveWang, solveWangViaSat, type SolveStep, type TileSet, type WangGrid } from "../lib/tiles/tile-model.ts";
import { triCorners } from "../lib/tiles/tri-geometry.ts";
import { solveTri, type TriGrid, type TriTileSet } from "../lib/tiles/tri-tile-model.ts";
import { DEFAULT_TRI_TILES_TEXT, parseTriTileSetText } from "../lib/tri-tile-set-text.ts";
import { useCell } from "../lib/use-cell.ts";
import { useTimelinePlayback } from "../lib/use-timeline-playback.ts";
import { drawGrayscaleGrid } from "../lib/image-frequency.ts";
import { drawAxes, drawPolyline } from "../lib/render-path.ts";
import { getThemeColors, subscribeToThemeChange } from "../lib/theme-colors.ts";
import type { Viewport } from "../lib/viewport.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { TransportControls } from "./TransportControls.tsx";
import { triOrientation } from "mallory-math";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };
type SolveStatus = "idle" | "solving" | "done" | "error";
type EntropyStatus = "idle" | "computing" | "done" | "error";
type RelaxStatus = "idle" | "running" | "done" | "error";
interface DiffractionResult {
  spectrum: number[][];
  autocorrelation: number[][];
}
const DIFFRACTION_CANVAS_SIZE = 200;
const RELAX_ENERGY_WIDTH = 300;
const RELAX_ENERGY_HEIGHT = 120;
// Hex/tri (issue #92 M3's lattice generalization) get a much smaller
// scoped-down feature set than the square lattice: tile editing + solving
// + rendering only, no symmetry/entropy/diffraction, no step-by-step
// animation (their solvers are drained straight to a final grid). Same
// MAX_CELLS-style guard as the square lattice, at a smaller cap since
// their backtracking has more neighbor-direction checks per cell.
const MAX_HEX_TRI_CELLS = 100;
// Same reasoning and cap as MAX_HEX_TRI_CELLS -- cube backtracking checks 3
// already-placed neighbor directions per cell (W/N/D), the same order of
// per-cell work as hex's 3 (NE/NW/W), so the cube lattice (issue #92 M4)
// reuses the identical cell-count ceiling rather than inventing a new one.
const MAX_CUBE_CELLS = 100;
// The relaxation experiment (issue #92 M5) runs a fixed-`steps` Adam loop
// SYNCHRONOUSLY (see relaxWangTiling's own doc comment on why it isn't a
// pausable generator) on click -- a much lower cell cap than the backtracking
// solvers' MAX_CELLS keeps that click from noticeably blocking the UI thread
// (measured: a 300-step run on a small grid is comfortably sub-second;
// scaling both grid area and step count up multiplies the per-step tensor
// work, so both get their own conservative cap).
const MAX_RELAX_CELLS = 36;
const MAX_RELAX_STEPS = 2000;

// stripEntropy's own transfer-matrix build is O(numColumns^2), and
// numColumns can be as large as (expanded tile count)^height -- this caps
// that product before calling it, so a careless height/symmetry
// combination degrades to a friendly error instead of freezing the tab.
// 4000^2 = 16M pairwise compatibility checks, comfortably sub-second.
const MAX_ENTROPY_COLUMNS = 4000;

const CELL_SIZE = 56;
// Backtracking search on a toy tile set is effectively instant, but a
// pathological tile set (or a typo'd huge width/height) could still make
// the search exponential -- this caps both the grid area (drives canvas
// size too) and the raw number of generator steps drained, so a bad input
// degrades to a friendly error message instead of hanging the tab.
const MAX_CELLS = 144;
const MAX_STEPS = 200_000;
// 1 solver step (one placement or one backtrack) = this many seconds of the
// shared TIME_CELL clock -- fast enough that even a several-hundred-step
// backtracking search plays back in a few seconds, unlike GraphTheoryPanel's
// coarser 0.6s/step (a whole vertex/edge/layer event there vs. a single
// cell trial here).
const STEP_SECONDS = 0.15;
// A fixed neutral fill for not-yet-placed cells -- like GraphCanvasMulti/
// GeometryPanel/MatrixPanel's own plain Canvas2D panels, the plot surface
// itself isn't theme-adaptive (only text/marker colors read getThemeColors()
// elsewhere in the family); Canvas2D's fillStyle also can't resolve a raw
// `var(--...)` CSS custom property the way a DOM element's style can.
const EMPTY_CELL_FILL = "#e5e7eb";

function seedState(graph: CellGraph, ids: CellIdsTiles, state: TilesState): void {
  graph.set(ids.tilesText, state.tilesText);
  graph.set(ids.width, state.width);
  graph.set(ids.height, state.height);
  graph.set(ids.solver, state.solver);
  graph.set(ids.showAnimation, state.showAnimation);
  graph.set(ids.symmetry, state.symmetry);
  graph.set(ids.lattice, state.lattice);
  graph.set(ids.hexTilesText, state.hexTilesText);
  graph.set(ids.triTilesText, state.triTilesText);
  graph.set(ids.cubeTilesText, state.cubeTilesText);
  graph.set(ids.depth, state.depth);
}

function getCurrentState(graph: CellGraph, ids: CellIdsTiles): TilesState {
  return {
    v: 4,
    tilesText: graph.get<string>(ids.tilesText),
    width: graph.get<number>(ids.width),
    height: graph.get<number>(ids.height),
    solver: graph.get<TilesSolverKind>(ids.solver),
    showAnimation: graph.get<boolean>(ids.showAnimation),
    symmetry: graph.get<SymmetryGroup>(ids.symmetry),
    lattice: graph.get<TilesLattice>(ids.lattice),
    hexTilesText: graph.get<string>(ids.hexTilesText),
    triTilesText: graph.get<string>(ids.triTilesText),
    cubeTilesText: graph.get<string>(ids.cubeTilesText),
    depth: graph.get<number>(ids.depth),
  };
}

function useTilesGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsTiles(cellId);
    const decoded = typeof window !== "undefined" ? decodeTilesState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_TILES_STATE);
    if (!graph.has(TIME_CELL)) graph.set(TIME_CELL, 0, { auxiliary: true });
    graph.set(ids.solveStatus, "idle" as SolveStatus, { auxiliary: true });
    graph.set(ids.solveSteps, [] as SolveStep[], { auxiliary: true });
    graph.set(ids.solveGrid, null as WangGrid | null, { auxiliary: true });
    graph.set(ids.solveError, "", { auxiliary: true });
    graph.set(ids.entropyHeight, 1, { auxiliary: true });
    graph.set(ids.entropyStatus, "idle" as EntropyStatus, { auxiliary: true });
    graph.set(ids.entropyResult, null as StripEntropyResult | null, { auxiliary: true });
    graph.set(ids.entropyError, "", { auxiliary: true });
    graph.set(ids.diffractionTileId, "", { auxiliary: true });
    graph.set(ids.hexSolveStatus, "idle" as SolveStatus, { auxiliary: true });
    graph.set(ids.hexSolveGrid, null as HexGrid | null, { auxiliary: true });
    graph.set(ids.hexSolveError, "", { auxiliary: true });
    graph.set(ids.triSolveStatus, "idle" as SolveStatus, { auxiliary: true });
    graph.set(ids.triSolveGrid, null as TriGrid | null, { auxiliary: true });
    graph.set(ids.triSolveError, "", { auxiliary: true });
    graph.set(ids.cubeSolveStatus, "idle" as SolveStatus, { auxiliary: true });
    graph.set(ids.cubeSolveGrid, null as CubeGrid | null, { auxiliary: true });
    graph.set(ids.cubeSolveError, "", { auxiliary: true });
    graph.set(ids.relaxSteps, 300, { auxiliary: true });
    graph.set(ids.relaxLr, 0.3, { auxiliary: true });
    graph.set(ids.relaxStatus, "idle" as RelaxStatus, { auxiliary: true });
    graph.set(ids.relaxResult, null as RelaxResult | null, { auxiliary: true });
    graph.set(ids.relaxError, "", { auxiliary: true });

    graph.define(ids.tileSetResult, (): Result<TileSet> => {
      try {
        return { ok: true, value: parseTileSetText(graph.get<string>(ids.tilesText)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.hexTileSetResult, (): Result<HexTileSet> => {
      try {
        return { ok: true, value: parseHexTileSetText(graph.get<string>(ids.hexTilesText)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.triTileSetResult, (): Result<TriTileSet> => {
      try {
        return { ok: true, value: parseTriTileSetText(graph.get<string>(ids.triTilesText)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.cubeTileSetResult, (): Result<CubeTileSet> => {
      try {
        return { ok: true, value: parseCubeTileSetText(graph.get<string>(ids.cubeTilesText)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    // Symmetry expansion is pure and synchronous, so unlike solving/entropy
    // it derives on read like the rest of this panel's cells.
    graph.define(ids.expandedTileSetResult, (): Result<TileSet> => {
      const base = graph.get<Result<TileSet>>(ids.tileSetResult);
      if (!base.ok) return base;
      return { ok: true, value: expandTileSetSymmetry(base.value, graph.get<SymmetryGroup>(ids.symmetry)) };
    });

    // Diffraction/autocorrelation: also pure and synchronous (both operate
    // on an already-solved grid, no search of their own), so this derives
    // on read too. `null` means "no completed tiling to analyze yet" or
    // "the selected tile id isn't in this solve" -- both real, common
    // states (an in-progress/failed solve, or a stale selection left over
    // from a since-changed tile set), not errors.
    graph.define(ids.diffractionResult, (): DiffractionResult | null => {
      const grid = graph.get<WangGrid | null>(ids.solveGrid);
      const tileId = graph.get<string>(ids.diffractionTileId);
      if (!grid || !tileId || !tileIdsPresent(grid).includes(tileId)) return null;
      return { spectrum: diffractionSpectrum(grid, tileId), autocorrelation: autocorrelationSurface(grid, tileId) };
    });

    ref.current = graph;
  }
  return ref.current;
}

/** Deterministic tile-id -> fill color, so the same id always renders the same hue across a solve and across reloads. */
export function tileColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

/** One-line caption for a solve step, used both under the transport controls and as the aria-live status. */
export function stepLabel(step: SolveStep): string {
  return step.contradiction
    ? `Backtrack at (${step.row}, ${step.col})`
    : `Place tile at (${step.row}, ${step.col})`;
}

async function drainSolve(
  gen: AsyncGenerator<SolveStep, WangGrid | null>,
): Promise<{ steps: SolveStep[]; grid: WangGrid | null }> {
  const steps: SolveStep[] = [];
  let next = await gen.next();
  while (!next.done) {
    steps.push(next.value);
    if (steps.length > MAX_STEPS) throw new Error(`Search exceeded ${MAX_STEPS} steps -- reduce the grid size or tile set.`);
    next = await gen.next();
  }
  return { steps, grid: next.value };
}

/** Drains a hex/tri solver straight to its final grid -- no step tracking, since neither gets step-by-step animation in this first cut (see MAX_HEX_TRI_CELLS's own doc comment). */
async function drainSolveToGrid<TStep, TGrid>(gen: AsyncGenerator<TStep, TGrid | null>): Promise<TGrid | null> {
  let step = 0;
  let next = await gen.next();
  while (!next.done) {
    step++;
    if (step > MAX_STEPS) throw new Error(`Search exceeded ${MAX_STEPS} steps -- reduce the grid size or tile set.`);
    next = await gen.next();
  }
  return next.value;
}

const CUBE_VIEW_SIZE = 400;
// Spacing between adjacent cube-cell centers -- slightly over the 0.9-unit
// box size below so neighboring faces sit close without z-fighting.
const CUBE_CELL_SPACING = 1.1;
// A single shared, immutable box geometry reused across every cell mesh (all
// cells are the same size) -- only each mesh's per-tile-id-colored material
// is created/disposed per render, matching VectorField3DPanel's own
// "geometry is cheap and stateless, materials carry the per-instance data"
// split.
const CUBE_CELL_GEOMETRY = new THREE.BoxGeometry(0.9, 0.9, 0.9);

/**
 * Renders a solved `CubeGrid` as a grid of colored boxes in an orbit-
 * controllable 3D scene (issue #92 M4) -- same Scene/Camera/Renderer/
 * OrbitControls/lighting/Group setup as VectorField3DPanel, with one
 * `THREE.Mesh` per placed cell (colored via `tileColor`) instead of one
 * arrow per sampled vector. A standalone, props-only component (no own
 * CellGraph) since it just visualizes whatever grid `TilesPanel` passes in.
 */
function CubeGridView({ grid }: { grid: CubeGrid | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getThemeColors().surface);
    const unsubscribeTheme = subscribeToThemeChange(() => {
      scene.background = new THREE.Color(getThemeColors().surface);
    });

    const camera = new THREE.PerspectiveCamera(50, CUBE_VIEW_SIZE / CUBE_VIEW_SIZE, 0.1, 1000);
    camera.position.set(6, 6, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(CUBE_VIEW_SIZE, CUBE_VIEW_SIZE, false);
    container.appendChild(renderer.domElement);
    rendererCanvasRef.current = renderer.domElement;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 7);
    scene.add(directional);
    scene.add(new THREE.AxesHelper(3));

    const group = new THREE.Group();
    groupRef.current = group;
    scene.add(group);

    let raf = 0;
    function tick() {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribeTheme();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      groupRef.current = null;
      rendererCanvasRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh) (child.material as THREE.Material).dispose();
    }
    if (!grid) return;
    const depth = grid.length;
    const height = grid[0]?.length ?? 0;
    const width = grid[0]?.[0]?.length ?? 0;
    for (let z = 0; z < depth; z++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const id = grid[z]![y]![x];
          if (!id) continue;
          const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(tileColor(id)) });
          const mesh = new THREE.Mesh(CUBE_CELL_GEOMETRY, material);
          mesh.position.set(
            (x - (width - 1) / 2) * CUBE_CELL_SPACING,
            (y - (height - 1) / 2) * CUBE_CELL_SPACING,
            (z - (depth - 1) / 2) * CUBE_CELL_SPACING,
          );
          group.add(mesh);
        }
      }
    }
  }, [grid]);

  return (
    <div>
      <div ref={containerRef} style={{ position: "relative", maxWidth: CUBE_VIEW_SIZE, border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => rendererCanvasRef.current} label="tiles-cube" />
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag to orbit, scroll to zoom.</p>
    </div>
  );
}

/** A Wang tile laboratory: edit a tile set as text, pick a solver variant, and watch the backtracking search play back step by step (issue #92 M1). */
export function TilesPanel({ cellId = "tiles-1" }: { cellId?: string } = {}) {
  const graph = useTilesGraph(cellId);
  useCellGraphTools(`tiles_${cellId}`, graph);
  const ids = cellIdsTiles(cellId);

  const tilesText = useCell<string>(graph, ids.tilesText);
  const tileSetResult = useCell<Result<TileSet>>(graph, ids.tileSetResult);
  const width = useCell<number>(graph, ids.width);
  const height = useCell<number>(graph, ids.height);
  const solver = useCell<TilesSolverKind>(graph, ids.solver);
  const showAnimation = useCell<boolean>(graph, ids.showAnimation);
  const symmetry = useCell<SymmetryGroup>(graph, ids.symmetry);
  const expandedTileSetResult = useCell<Result<TileSet>>(graph, ids.expandedTileSetResult);
  const solveStatus = useCell<SolveStatus>(graph, ids.solveStatus);
  const solveSteps = useCell<SolveStep[]>(graph, ids.solveSteps);
  const solveGrid = useCell<WangGrid | null>(graph, ids.solveGrid);
  const solveError = useCell<string>(graph, ids.solveError);
  const entropyHeight = useCell<number>(graph, ids.entropyHeight);
  const entropyStatus = useCell<EntropyStatus>(graph, ids.entropyStatus);
  const entropyResult = useCell<StripEntropyResult | null>(graph, ids.entropyResult);
  const entropyError = useCell<string>(graph, ids.entropyError);
  const diffractionTileId = useCell<string>(graph, ids.diffractionTileId);
  const diffractionResult = useCell<DiffractionResult | null>(graph, ids.diffractionResult);
  const relaxSteps = useCell<number>(graph, ids.relaxSteps);
  const relaxLr = useCell<number>(graph, ids.relaxLr);
  const relaxStatus = useCell<RelaxStatus>(graph, ids.relaxStatus);
  const relaxResult = useCell<RelaxResult | null>(graph, ids.relaxResult);
  const relaxError = useCell<string>(graph, ids.relaxError);
  const time = useCell<number>(graph, TIME_CELL);

  const lattice = useCell<TilesLattice>(graph, ids.lattice);
  const hexTilesText = useCell<string>(graph, ids.hexTilesText);
  const hexTileSetResult = useCell<Result<HexTileSet>>(graph, ids.hexTileSetResult);
  const hexSolveStatus = useCell<SolveStatus>(graph, ids.hexSolveStatus);
  const hexSolveGrid = useCell<HexGrid | null>(graph, ids.hexSolveGrid);
  const hexSolveError = useCell<string>(graph, ids.hexSolveError);
  const triTilesText = useCell<string>(graph, ids.triTilesText);
  const triTileSetResult = useCell<Result<TriTileSet>>(graph, ids.triTileSetResult);
  const triSolveStatus = useCell<SolveStatus>(graph, ids.triSolveStatus);
  const triSolveGrid = useCell<TriGrid | null>(graph, ids.triSolveGrid);
  const triSolveError = useCell<string>(graph, ids.triSolveError);
  const depth = useCell<number>(graph, ids.depth);
  const cubeTilesText = useCell<string>(graph, ids.cubeTilesText);
  const cubeTileSetResult = useCell<Result<CubeTileSet>>(graph, ids.cubeTileSetResult);
  const cubeSolveStatus = useCell<SolveStatus>(graph, ids.cubeSolveStatus);
  const cubeSolveGrid = useCell<CubeGrid | null>(graph, ids.cubeSolveGrid);
  const cubeSolveError = useCell<string>(graph, ids.cubeSolveError);

  const [textInput, setTextInput] = useState(tilesText);
  useEffect(() => setTextInput(tilesText), [tilesText]);
  const [hexTextInput, setHexTextInput] = useState(hexTilesText);
  useEffect(() => setHexTextInput(hexTilesText), [hexTilesText]);
  const [triTextInput, setTriTextInput] = useState(triTilesText);
  useEffect(() => setTriTextInput(triTilesText), [triTilesText]);
  const [cubeTextInput, setCubeTextInput] = useState(cubeTilesText);
  useEffect(() => setCubeTextInput(cubeTilesText), [cubeTilesText]);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const duration = showAnimation ? solveSteps.length * STEP_SECONDS : 0;
  useTimelinePlayback(graph, playing, loop, speed, duration, setPlaying);

  useModelContextTool({
    name: `tiles_${cellId}_solve`,
    description:
      "Re-run the Wang tile solve with the panel's current tile set, width, height, and solver variant. Returns whether a tiling was found and how many search steps it took. Normally solving is triggered automatically whenever the tile set/width/height/solver changes, so this is mainly useful to force a re-solve after an external set_cell write.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const status = graph.get<SolveStatus>(ids.solveStatus);
      return { status, found: graph.get<WangGrid | null>(ids.solveGrid) !== null, steps: graph.get<SolveStep[]>(ids.solveSteps).length };
    },
  });

  // Auto-solve whenever the parsed tile set, grid size, or solver variant
  // changes. Backtracking search is CPU work, not something a synchronous
  // CellGraph `compute` fn can do here since solveWang/solveTorus are async
  // generators (streamed so a long search stays pausable/animatable) -- so
  // the result is collected imperatively and written back via `graph.set`,
  // the same "derive an array from an already-computed result" shape
  // GraphTheoryPanel's algorithmSteps uses, just triggered from an effect
  // instead of a `define`.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (lattice !== "square" || !expandedTileSetResult.ok) {
        graph.set(ids.solveStatus, "idle" satisfies SolveStatus);
        graph.set(ids.solveSteps, []);
        graph.set(ids.solveGrid, null);
        graph.set(ids.solveError, "");
        return;
      }
      if (width < 1 || height < 1 || width * height > MAX_CELLS) {
        graph.set(ids.solveStatus, "error" satisfies SolveStatus);
        graph.set(ids.solveError, `Grid must be at least 1x1 and at most ${MAX_CELLS} cells total.`);
        return;
      }
      graph.set(ids.solveStatus, "solving" satisfies SolveStatus);
      try {
        // trackSteps: showAnimation -- a run with the animation toggle off
        // never reads `.grid` on any intermediate step (the canvas only
        // reads `currentStep.grid` when `showAnimation` is true), so
        // skipping that per-step full-grid clone here avoids paying an
        // O(width*height) cost on every placement/backtrack for nothing.
        const gen =
          solver === "torus"
            ? solveTorus(expandedTileSetResult.value, width, height, { trackSteps: showAnimation })
            : solveWang(expandedTileSetResult.value, width, height, { trackSteps: showAnimation });
        if (solver === "sat") {
          const grid = solveWangViaSat(expandedTileSetResult.value, width, height);
          if (cancelled) return;
          graph.set(ids.solveSteps, []);
          graph.set(ids.solveGrid, grid);
          graph.set(ids.solveError, "");
          graph.set(ids.solveStatus, "done" satisfies SolveStatus);
          return;
        }
        const { steps, grid } = await drainSolve(gen);
        if (cancelled) return;
        graph.set(ids.solveSteps, steps);
        graph.set(ids.solveGrid, grid);
        graph.set(ids.solveError, "");
        graph.set(ids.solveStatus, "done" satisfies SolveStatus);
      } catch (e) {
        if (cancelled) return;
        graph.set(ids.solveStatus, "error" satisfies SolveStatus);
        graph.set(ids.solveError, e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, lattice, expandedTileSetResult, width, height, solver, showAnimation]);

  // Hex/tri auto-solve: same "drain the async generator, write the result
  // back via graph.set" shape as the square lattice's own effect above,
  // simplified since hex/tri only have the one backtracking solver variant
  // (no torus/SAT) and no step-by-step animation to preserve (see
  // MAX_HEX_TRI_CELLS's doc comment) -- so there's nothing to keep except
  // the final grid.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (lattice !== "hex" || !hexTileSetResult.ok) {
        graph.set(ids.hexSolveStatus, "idle" satisfies SolveStatus);
        graph.set(ids.hexSolveGrid, null);
        graph.set(ids.hexSolveError, "");
        return;
      }
      if (width < 1 || height < 1 || width * height > MAX_HEX_TRI_CELLS) {
        graph.set(ids.hexSolveStatus, "error" satisfies SolveStatus);
        graph.set(ids.hexSolveError, `Grid must be at least 1x1 and at most ${MAX_HEX_TRI_CELLS} cells total.`);
        return;
      }
      graph.set(ids.hexSolveStatus, "solving" satisfies SolveStatus);
      try {
        // No step-by-step animation for hex (see MAX_HEX_TRI_CELLS's own doc
        // comment), so trackSteps: false skips the per-step grid clone --
        // drainSolveToGrid already discards every intermediate step anyway.
        const grid = await drainSolveToGrid(solveHex(hexTileSetResult.value, width, height, { trackSteps: false }));
        if (cancelled) return;
        graph.set(ids.hexSolveGrid, grid);
        graph.set(ids.hexSolveError, "");
        graph.set(ids.hexSolveStatus, "done" satisfies SolveStatus);
      } catch (e) {
        if (cancelled) return;
        graph.set(ids.hexSolveStatus, "error" satisfies SolveStatus);
        graph.set(ids.hexSolveError, e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, lattice, hexTileSetResult, width, height]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (lattice !== "tri" || !triTileSetResult.ok) {
        graph.set(ids.triSolveStatus, "idle" satisfies SolveStatus);
        graph.set(ids.triSolveGrid, null);
        graph.set(ids.triSolveError, "");
        return;
      }
      if (width < 1 || height < 1 || width * height > MAX_HEX_TRI_CELLS) {
        graph.set(ids.triSolveStatus, "error" satisfies SolveStatus);
        graph.set(ids.triSolveError, `Grid must be at least 1x1 and at most ${MAX_HEX_TRI_CELLS} cells total.`);
        return;
      }
      graph.set(ids.triSolveStatus, "solving" satisfies SolveStatus);
      try {
        // Same trackSteps: false reasoning as the hex effect above.
        const grid = await drainSolveToGrid(solveTri(triTileSetResult.value, width, height, { trackSteps: false }));
        if (cancelled) return;
        graph.set(ids.triSolveGrid, grid);
        graph.set(ids.triSolveError, "");
        graph.set(ids.triSolveStatus, "done" satisfies SolveStatus);
      } catch (e) {
        if (cancelled) return;
        graph.set(ids.triSolveStatus, "error" satisfies SolveStatus);
        graph.set(ids.triSolveError, e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, lattice, triTileSetResult, width, height]);

  // Cube auto-solve (issue #92 M4): same shape as the hex/tri effects above,
  // just gated on `width * height * depth` instead of `width * height`.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (lattice !== "cube" || !cubeTileSetResult.ok) {
        graph.set(ids.cubeSolveStatus, "idle" satisfies SolveStatus);
        graph.set(ids.cubeSolveGrid, null);
        graph.set(ids.cubeSolveError, "");
        return;
      }
      if (width < 1 || height < 1 || depth < 1 || width * height * depth > MAX_CUBE_CELLS) {
        graph.set(ids.cubeSolveStatus, "error" satisfies SolveStatus);
        graph.set(ids.cubeSolveError, `Box must be at least 1x1x1 and at most ${MAX_CUBE_CELLS} cells total.`);
        return;
      }
      graph.set(ids.cubeSolveStatus, "solving" satisfies SolveStatus);
      try {
        // Same trackSteps: false reasoning as the hex effect above -- and
        // the biggest win of the three, since a cube step snapshot is an
        // O(width*height*depth) 3D-array clone, not a 2D one.
        const grid = await drainSolveToGrid(solveCube(cubeTileSetResult.value, width, height, depth, { trackSteps: false }));
        if (cancelled) return;
        graph.set(ids.cubeSolveGrid, grid);
        graph.set(ids.cubeSolveError, "");
        graph.set(ids.cubeSolveStatus, "done" satisfies SolveStatus);
      } catch (e) {
        if (cancelled) return;
        graph.set(ids.cubeSolveStatus, "error" satisfies SolveStatus);
        graph.set(ids.cubeSolveError, e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, lattice, cubeTileSetResult, width, height, depth]);

  // A changed solve restarts the animation from the beginning.
  useEffect(() => {
    graph.set(TIME_CELL, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solveSteps]);

  // Keep the diffraction tile-id selection valid across a new solve: pick
  // the first available id when the current selection isn't (or never was)
  // present in the newly-solved grid. `diffractionResult` itself already
  // reads `solveGrid` in its `define`, so this effect's only job is
  // choosing WHICH id to look at -- it never touches diffractionResult.
  useEffect(() => {
    const available = solveGrid ? tileIdsPresent(solveGrid) : [];
    if (!available.includes(diffractionTileId)) {
      graph.set(ids.diffractionTileId, available[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solveGrid]);

  // A stale entropy result/error for a now-different tile set or height
  // would be actively misleading (unlike solving, entropy is NOT
  // auto-recomputed -- see MAX_ENTROPY_COLUMNS -- so this only clears it
  // back to "idle", it never re-runs stripEntropy itself).
  useEffect(() => {
    graph.set(ids.entropyStatus, "idle" satisfies EntropyStatus);
    graph.set(ids.entropyResult, null);
    graph.set(ids.entropyError, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedTileSetResult, entropyHeight]);

  function computeEntropy() {
    if (!expandedTileSetResult.ok) return;
    const numTiles = expandedTileSetResult.value.tiles.length;
    if (numTiles === 0) {
      graph.set(ids.entropyStatus, "error" satisfies EntropyStatus);
      graph.set(ids.entropyError, "Tile set is empty.");
      return;
    }
    if (numTiles ** entropyHeight > MAX_ENTROPY_COLUMNS) {
      graph.set(ids.entropyStatus, "error" satisfies EntropyStatus);
      graph.set(
        ids.entropyError,
        `${numTiles} tiles at height ${entropyHeight} could reach up to ${numTiles ** entropyHeight} columns, over the ${MAX_ENTROPY_COLUMNS} cap -- lower the height or the symmetry group.`,
      );
      return;
    }
    graph.set(ids.entropyStatus, "computing" satisfies EntropyStatus);
    try {
      const result = stripEntropy(expandedTileSetResult.value, entropyHeight);
      graph.set(ids.entropyResult, result);
      graph.set(ids.entropyError, "");
      graph.set(ids.entropyStatus, "done" satisfies EntropyStatus);
    } catch (e) {
      graph.set(ids.entropyStatus, "error" satisfies EntropyStatus);
      graph.set(ids.entropyError, e instanceof Error ? e.message : String(e));
    }
  }

  useModelContextTool({
    name: `tiles_${cellId}_entropy`,
    description:
      "Compute the panel's current (symmetry-expanded) tile set's strip entropy at its current entropyHeight setting, via the transfer-matrix method. Returns the per-cell entropy, the dominant eigenvalue, and the number of valid columns found, or an error if the tile set admits no valid column/cycle at this height or the search would be too large.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      computeEntropy();
      return {
        status: graph.get<EntropyStatus>(ids.entropyStatus),
        result: graph.get<StripEntropyResult | null>(ids.entropyResult),
        error: graph.get<string>(ids.entropyError),
      };
    },
  });

  // Same "stale result would be misleading, but it's on-demand so only clear
  // it rather than re-running" shape as entropy's own effect above -- also
  // keyed on width/height (entropy's isn't, since strip entropy has no
  // notion of a grid width/height) since those directly change what the
  // relaxation optimizes over.
  useEffect(() => {
    graph.set(ids.relaxStatus, "idle" satisfies RelaxStatus);
    graph.set(ids.relaxResult, null);
    graph.set(ids.relaxError, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedTileSetResult, width, height]);

  /** Issue #92 M5: runs `relaxWangTiling` synchronously on the current (symmetry-expanded) tile set -- see MAX_RELAX_CELLS's own doc comment on why this stays capped well below the backtracking solvers' own grid-size cap. */
  function runRelax() {
    if (!expandedTileSetResult.ok) return;
    if (width < 1 || height < 1 || width * height > MAX_RELAX_CELLS) {
      graph.set(ids.relaxStatus, "error" satisfies RelaxStatus);
      graph.set(ids.relaxError, `Grid must be at least 1x1 and at most ${MAX_RELAX_CELLS} cells total for the relaxation experiment.`);
      return;
    }
    if (relaxSteps < 1 || relaxSteps > MAX_RELAX_STEPS) {
      graph.set(ids.relaxStatus, "error" satisfies RelaxStatus);
      graph.set(ids.relaxError, `Steps must be between 1 and ${MAX_RELAX_STEPS}.`);
      return;
    }
    graph.set(ids.relaxStatus, "running" satisfies RelaxStatus);
    try {
      const result = relaxWangTiling(expandedTileSetResult.value, width, height, { steps: relaxSteps, lr: relaxLr });
      graph.set(ids.relaxResult, result);
      graph.set(ids.relaxError, "");
      graph.set(ids.relaxStatus, "done" satisfies RelaxStatus);
    } catch (e) {
      graph.set(ids.relaxStatus, "error" satisfies RelaxStatus);
      graph.set(ids.relaxError, e instanceof Error ? e.message : String(e));
    }
  }

  useModelContextTool({
    name: `tiles_${cellId}_relax`,
    description:
      "Run the differentiable-relaxation experiment (issue #92 M5) on the panel's current (symmetry-expanded) square-lattice tile set: a softmax tile assignment per cell, minimized against a mismatch-count energy via Adam. Returns the resulting grid, whether it's actually a valid tiling, and the energy trajectory's final value -- a genuinely open question whether this converges to a valid tiling faster than the backtracking solver on hard sets.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      runRelax();
      const result = graph.get<RelaxResult | null>(ids.relaxResult);
      return {
        status: graph.get<RelaxStatus>(ids.relaxStatus),
        valid: result?.valid ?? null,
        finalEnergy: result ? result.energyHistory[result.energyHistory.length - 1] : null,
        error: graph.get<string>(ids.relaxError),
      };
    },
  });

  const currentStepIndex = solveSteps.length > 0 ? Math.min(solveSteps.length - 1, Math.floor(time / STEP_SECONDS)) : -1;
  const currentStep = currentStepIndex >= 0 ? solveSteps[currentStepIndex] : undefined;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWidth = Math.max(1, width) * CELL_SIZE;
  const canvasHeight = Math.max(1, height) * CELL_SIZE;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const displayGrid: ReadonlyArray<ReadonlyArray<string | null>> | null =
      showAnimation && currentStep ? currentStep.grid : solveGrid;
    if (!displayGrid) return;

    for (let row = 0; row < displayGrid.length; row++) {
      for (let col = 0; col < displayGrid[row]!.length; col++) {
        const id = displayGrid[row]![col];
        const x = col * CELL_SIZE;
        const y = row * CELL_SIZE;
        ctx.fillStyle = id ? tileColor(id) : EMPTY_CELL_FILL;
        ctx.strokeStyle = "#00000022";
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
        if (id) {
          ctx.fillStyle = "#fff";
          ctx.font = "13px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(id, x + CELL_SIZE / 2, y + CELL_SIZE / 2);
        }
      }
    }

    if (showAnimation && currentStep) {
      const x = currentStep.col * CELL_SIZE;
      const y = currentStep.row * CELL_SIZE;
      ctx.strokeStyle = currentStep.contradiction ? "#dc2626" : "#16a34a";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
    }
  }, [canvasWidth, canvasHeight, showAnimation, currentStep, solveGrid]);

  // Hex canvas: the axial-to-pixel map is affine in (q, r), so the pixel
  // bounding box of the width x height parallelogram is exactly the
  // bounding box of its 4 corners -- evaluate those, then translate
  // everything by (-minX, -minY) plus a hex-radius margin so no part of
  // any hex corner clips the canvas edge.
  const HEX_SIZE = 26;
  const hexCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hexCorners4 = [hexCenter(0, 0, HEX_SIZE), hexCenter(width - 1, 0, HEX_SIZE), hexCenter(0, height - 1, HEX_SIZE), hexCenter(width - 1, height - 1, HEX_SIZE)];
  const hexMinX = Math.min(...hexCorners4.map((p) => p.x)) - HEX_SIZE;
  const hexMinY = Math.min(...hexCorners4.map((p) => p.y)) - HEX_SIZE;
  const hexMaxX = Math.max(...hexCorners4.map((p) => p.x)) + HEX_SIZE;
  const hexMaxY = Math.max(...hexCorners4.map((p) => p.y)) + HEX_SIZE;
  const hexCanvasWidth = Math.max(1, hexMaxX - hexMinX);
  const hexCanvasHeight = Math.max(1, hexMaxY - hexMinY);

  useEffect(() => {
    const ctx = hexCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, hexCanvasWidth, hexCanvasHeight);
    if (!hexSolveGrid) return;
    for (let r = 0; r < hexSolveGrid.length; r++) {
      for (let q = 0; q < hexSolveGrid[r]!.length; q++) {
        const id = hexSolveGrid[r]![q]!;
        const center = hexCenter(q, r, HEX_SIZE);
        const cx = center.x - hexMinX;
        const cy = center.y - hexMinY;
        const corners = hexCorners(cx, cy, HEX_SIZE);
        ctx.beginPath();
        corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = tileColor(id);
        ctx.fill();
        ctx.strokeStyle = "#00000022";
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(id, cx, cy);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hexCanvasWidth, hexCanvasHeight, hexSolveGrid]);

  // Tri canvas: the simplified bounding-box layout (see tri-geometry.ts's
  // own doc comment) means the canvas is just a plain width*cellWidth by
  // height*cellHeight rectangle, same sizing shape as the square lattice.
  const TRI_CELL_WIDTH = 48;
  const TRI_CELL_HEIGHT = 48;
  const triCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const triCanvasWidth = Math.max(1, width) * TRI_CELL_WIDTH;
  const triCanvasHeight = Math.max(1, height) * TRI_CELL_HEIGHT;

  useEffect(() => {
    const ctx = triCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, triCanvasWidth, triCanvasHeight);
    if (!triSolveGrid) return;
    for (let y = 0; y < triSolveGrid.length; y++) {
      for (let x = 0; x < triSolveGrid[y]!.length; x++) {
        const id = triSolveGrid[y]![x]!;
        const orientation = triOrientation(x, y);
        const corners = triCorners(x, y, TRI_CELL_WIDTH, TRI_CELL_HEIGHT, orientation);
        ctx.beginPath();
        corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = tileColor(id);
        ctx.fill();
        ctx.strokeStyle = "#00000022";
        ctx.stroke();
        const midX = (x + 0.5) * TRI_CELL_WIDTH;
        const midY = orientation === "up" ? (y + 0.65) * TRI_CELL_HEIGHT : (y + 0.35) * TRI_CELL_HEIGHT;
        ctx.fillStyle = "#fff";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(id, midX, midY);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triCanvasWidth, triCanvasHeight, triSolveGrid]);

  const diffractionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const autocorrelationCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const ctx = diffractionCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, DIFFRACTION_CANVAS_SIZE, DIFFRACTION_CANVAS_SIZE);
    if (!diffractionResult) return;
    // log1p-scaled, same reasoning as ImageFrequencyPanel's own magnitude
    // spectrum: the DC bin dwarfs everything else on a linear scale.
    const logSpectrum = diffractionResult.spectrum.map((row) => row.map((v) => Math.log1p(v)));
    drawGrayscaleGrid(ctx, logSpectrum, DIFFRACTION_CANVAS_SIZE, DIFFRACTION_CANVAS_SIZE);
  }, [diffractionResult]);

  useEffect(() => {
    const ctx = autocorrelationCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, DIFFRACTION_CANVAS_SIZE, DIFFRACTION_CANVAS_SIZE);
    if (!diffractionResult) return;
    drawGrayscaleGrid(ctx, diffractionResult.autocorrelation, DIFFRACTION_CANVAS_SIZE, DIFFRACTION_CANVAS_SIZE);
  }, [diffractionResult]);

  // Relax grid canvas: same plain square-cell rendering as the main solve
  // canvas above (tileColor fill + id label), just driven by relaxResult.grid
  // instead of solveGrid/currentStep -- no animation, since relaxWangTiling
  // isn't a step-by-step generator (see its own doc comment).
  const relaxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const relaxCanvasWidth = Math.max(1, width) * CELL_SIZE;
  const relaxCanvasHeight = Math.max(1, height) * CELL_SIZE;

  useEffect(() => {
    const ctx = relaxCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, relaxCanvasWidth, relaxCanvasHeight);
    if (!relaxResult) return;
    for (let row = 0; row < relaxResult.grid.length; row++) {
      for (let col = 0; col < relaxResult.grid[row]!.length; col++) {
        const id = relaxResult.grid[row]![col]!;
        const x = col * CELL_SIZE;
        const y = row * CELL_SIZE;
        ctx.fillStyle = tileColor(id);
        ctx.strokeStyle = "#00000022";
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
        ctx.fillStyle = "#fff";
        ctx.font = "13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(id, x + CELL_SIZE / 2, y + CELL_SIZE / 2);
      }
    }
  }, [relaxCanvasWidth, relaxCanvasHeight, relaxResult]);

  const relaxEnergyCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const ctx = relaxEnergyCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, RELAX_ENERGY_WIDTH, RELAX_ENERGY_HEIGHT);
    if (!relaxResult || relaxResult.energyHistory.length < 2) return;
    const maxEnergy = Math.max(...relaxResult.energyHistory, 1e-9);
    const viewport: Viewport = { xMin: 0, xMax: relaxResult.energyHistory.length - 1, yMin: 0, yMax: maxEnergy * 1.05 };
    drawAxes(ctx, viewport, RELAX_ENERGY_WIDTH, RELAX_ENERGY_HEIGHT);
    drawPolyline(
      ctx,
      relaxResult.energyHistory.map((e, i) => ({ x: i, y: e })),
      viewport,
      RELAX_ENERGY_WIDTH,
      RELAX_ENERGY_HEIGHT,
      "#dc2626",
    );
  }, [relaxResult]);

  // subscribeMany (not subscribeAll, issue #242 -- follow-up to #235) --
  // getCurrentState only reads the fixed cell list below, never TIME_CELL
  // or the solve-loop's progress cells (ids.solveSteps etc., not part of the
  // URL schema), so a subscribeAll here used to re-run writeUrl on every RAF
  // tick of animated playback and every solve-loop progress write.
  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeTilesState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeMany(
      [ids.tilesText, ids.width, ids.height, ids.solver, ids.showAnimation, ids.symmetry, ids.lattice, ids.hexTilesText, ids.triTilesText, ids.cubeTilesText, ids.depth],
      writeUrl,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  function updateText(value: string) {
    setTextInput(value);
    graph.set(ids.tilesText, value);
  }

  function updateHexText(value: string) {
    setHexTextInput(value);
    graph.set(ids.hexTilesText, value);
  }

  function updateTriText(value: string) {
    setTriTextInput(value);
    graph.set(ids.triTilesText, value);
  }

  function updateCubeText(value: string) {
    setCubeTextInput(value);
    graph.set(ids.cubeTilesText, value);
  }

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          lattice:{" "}
          <select value={lattice} onChange={(e) => graph.set(ids.lattice, e.target.value as TilesLattice)}>
            <option value="square">Square (4 edges)</option>
            <option value="hex">Hexagonal (6 edges)</option>
            <option value="tri">Triangular (4 edges, 3 used per cell)</option>
            <option value="cube">Cube (6 faces, 3D)</option>
          </select>
        </label>
        {lattice !== "square" && (
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0 0" }}>
            Symmetry, entropy, and diffraction analysis are square-lattice-only for now (issue #92 M3).{" "}
            {lattice === "hex" ? "Hexagonal" : lattice === "tri" ? "Triangular" : "Cube"} tiling supports editing, solving, and rendering.
          </p>
        )}
      </div>

      {lattice === "square" && (
        <>
          <div style={{ margin: "0.25rem 0" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
              Tile set (one per line: <code>id N E S W</code>)
            </label>
            <textarea
              value={textInput}
              onChange={(e) => updateText(e.target.value)}
              rows={5}
              style={{ font: "inherit", fontFamily: "monospace", width: "24ch" }}
            />
            <div>
              <button type="button" onClick={() => updateText(DEFAULT_TILES_TEXT)}>
                Reset to default set
              </button>
            </div>
          </div>
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              width: <input type="number" min={1} value={width} onChange={(e) => graph.set(ids.width, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
            <label>
              height: <input type="number" min={1} value={height} onChange={(e) => graph.set(ids.height, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
            <label>
              solver:{" "}
              <select value={solver} onChange={(e) => graph.set(ids.solver, e.target.value as TilesSolverKind)}>
                <option value="wang">Backtracking</option>
                <option value="torus">Backtracking (torus/periodic)</option>
                <option value="sat">SAT cross-check</option>
              </select>
            </label>
            <label>
              symmetry:{" "}
              <select value={symmetry} onChange={(e) => graph.set(ids.symmetry, e.target.value as SymmetryGroup)}>
                <option value="none">None (translations only)</option>
                <option value="rotations">Rotations (C4)</option>
                <option value="rotations-reflections">Rotations + reflections (D4)</option>
              </select>
            </label>
            {solver !== "sat" && (
              <label>
                <input type="checkbox" checked={showAnimation} onChange={(e) => graph.set(ids.showAnimation, e.target.checked)} /> Animate step by step
              </label>
            )}
          </div>

          {!tileSetResult.ok && <p style={{ color: "crimson" }}>{tileSetResult.message}</p>}
          {tileSetResult.ok && symmetry !== "none" && expandedTileSetResult.ok && (
            <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              Symmetry expansion: {tileSetResult.value.tiles.length} tile{tileSetResult.value.tiles.length === 1 ? "" : "s"} →{" "}
              {expandedTileSetResult.value.tiles.length} oriented variant{expandedTileSetResult.value.tiles.length === 1 ? "" : "s"} used for solving.
            </p>
          )}
          {solveStatus === "error" && <p style={{ color: "crimson" }}>{solveError}</p>}

          <canvas ref={canvasRef} width={canvasWidth} height={canvasHeight} style={{ border: "1px solid #ccc", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => canvasRef.current} label="tiles" />
          </div>

          {showAnimation && solver !== "sat" && solveSteps.length > 0 && (
            <>
              <TransportControls graph={graph} time={time} duration={duration} playing={playing} setPlaying={setPlaying} loop={loop} setLoop={setLoop} speed={speed} setSpeed={setSpeed} />
              {currentStep && (
                <p style={{ fontSize: "0.85rem", color: "var(--muted)" }} aria-live="polite">
                  {stepLabel(currentStep)}
                </p>
              )}
            </>
          )}

          {solveStatus === "solving" && <p>Solving…</p>}
          {solveStatus === "done" && (
            <p>
              {solveGrid
                ? `Tiling found${solver !== "sat" ? ` in ${solveSteps.length} search steps` : ""}.`
                : `No tiling exists for this tile set at ${width}x${height}${solver !== "sat" ? ` (search exhausted after ${solveSteps.length} steps)` : ""}.`}
            </p>
          )}

          <div style={{ margin: "0.75rem 0", paddingTop: "0.5rem", borderTop: "1px solid var(--border, #ccc)" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
              Entropy (transfer-matrix method, issue #92 M2) -- per-cell entropy of the height-h strip, using the current symmetry-expanded tile set
            </label>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", margin: "0.25rem 0" }}>
              <label>
                strip height:{" "}
                <input
                  type="number"
                  min={1}
                  value={entropyHeight}
                  onChange={(e) => graph.set(ids.entropyHeight, Math.max(1, Number(e.target.value)))}
                  style={{ font: "inherit", width: "4ch" }}
                />
              </label>
              <button type="button" onClick={computeEntropy} disabled={!expandedTileSetResult.ok}>
                Compute entropy
              </button>
            </div>
            {entropyStatus === "error" && <p style={{ color: "crimson" }}>{entropyError}</p>}
            {entropyStatus === "done" && entropyResult && (
              <p>
                entropy ≈ {entropyResult.entropy.toFixed(4)} (dominant eigenvalue ≈ {entropyResult.dominantEigenvalue.toFixed(4)}, {entropyResult.numColumns}{" "}
                valid column{entropyResult.numColumns === 1 ? "" : "s"}
                {!entropyResult.converged ? ", power iteration did not fully converge -- treat as approximate" : ""})
              </p>
            )}
          </div>

          <div style={{ margin: "0.75rem 0", paddingTop: "0.5rem", borderTop: "1px solid var(--border, #ccc)" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
              Diffraction spectrum + autocorrelation (issue #92 M3) -- for a solved tiling's indicator field of the chosen tile id
            </label>
            <div style={{ margin: "0.25rem 0" }}>
              <label>
                tile:{" "}
                <select
                  value={diffractionTileId}
                  onChange={(e) => graph.set(ids.diffractionTileId, e.target.value)}
                  disabled={!solveGrid}
                >
                  {!solveGrid && <option value="">(no completed tiling yet)</option>}
                  {solveGrid &&
                    tileIdsPresent(solveGrid).map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.25rem" }}>
                  Spectrum (log-scaled, DC centered)
                </p>
                <canvas
                  ref={diffractionCanvasRef}
                  width={DIFFRACTION_CANVAS_SIZE}
                  height={DIFFRACTION_CANVAS_SIZE}
                  style={{ border: "1px solid #ccc", maxWidth: "100%" }}
                />
              </div>
              <div>
                <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.25rem" }}>
                  Autocorrelation surface (zero-lag centered)
                </p>
                <canvas
                  ref={autocorrelationCanvasRef}
                  width={DIFFRACTION_CANVAS_SIZE}
                  height={DIFFRACTION_CANVAS_SIZE}
                  style={{ border: "1px solid #ccc", maxWidth: "100%" }}
                />
              </div>
            </div>
            {!diffractionResult && <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Solve for a tiling to see its diffraction pattern.</p>}
          </div>

          <div style={{ margin: "0.75rem 0", paddingTop: "0.5rem", borderTop: "1px solid var(--border, #ccc)" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
              Differentiable relaxation (issue #92 M5, experiment) -- softmax tile assignment minimized against a mismatch-count energy via Adam, run on demand
            </label>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", margin: "0.25rem 0" }}>
              <label>
                steps:{" "}
                <input
                  type="number"
                  min={1}
                  max={MAX_RELAX_STEPS}
                  value={relaxSteps}
                  onChange={(e) => graph.set(ids.relaxSteps, Math.max(1, Number(e.target.value)))}
                  style={{ font: "inherit", width: "6ch" }}
                />
              </label>
              <label>
                lr:{" "}
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={relaxLr}
                  onChange={(e) => graph.set(ids.relaxLr, Number(e.target.value))}
                  style={{ font: "inherit", width: "6ch" }}
                />
              </label>
              <button type="button" onClick={runRelax} disabled={!expandedTileSetResult.ok || relaxStatus === "running"}>
                Run relaxation
              </button>
            </div>
            {relaxStatus === "error" && <p style={{ color: "crimson" }}>{relaxError}</p>}
            {relaxStatus === "running" && <p>Optimizing…</p>}
            {relaxStatus === "done" && relaxResult && (
              <>
                <p>
                  {relaxResult.valid ? "Converged to a valid tiling." : "Did not converge to a valid tiling"} (final energy ≈{" "}
                  {relaxResult.energyHistory[relaxResult.energyHistory.length - 1]!.toFixed(4)}).
                </p>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <canvas ref={relaxCanvasRef} width={relaxCanvasWidth} height={relaxCanvasHeight} style={{ border: "1px solid #ccc", maxWidth: "100%" }} />
                    <div style={{ margin: "0.25rem 0" }}>
                      <PngExportButton getCanvas={() => relaxCanvasRef.current} label="tiles-relax" />
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.25rem" }}>Energy vs. step</p>
                    <canvas
                      ref={relaxEnergyCanvasRef}
                      width={RELAX_ENERGY_WIDTH}
                      height={RELAX_ENERGY_HEIGHT}
                      style={{ border: "1px solid #ccc", maxWidth: "100%" }}
                    />
                    <div style={{ margin: "0.25rem 0" }}>
                      <PngExportButton getCanvas={() => relaxEnergyCanvasRef.current} label="tiles-relax-energy" />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {lattice === "hex" && (
        <>
          <div style={{ margin: "0.25rem 0" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
              Tile set (one per line: <code>id e0 e1 e2 e3 e4 e5</code>, directions E/NE/NW/W/SW/SE)
            </label>
            <textarea
              value={hexTextInput}
              onChange={(e) => updateHexText(e.target.value)}
              rows={5}
              style={{ font: "inherit", fontFamily: "monospace", width: "24ch" }}
            />
            <div>
              <button type="button" onClick={() => updateHexText(DEFAULT_HEX_TILES_TEXT)}>
                Reset to default set
              </button>
            </div>
          </div>
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              width (q): <input type="number" min={1} value={width} onChange={(e) => graph.set(ids.width, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
            <label>
              height (r): <input type="number" min={1} value={height} onChange={(e) => graph.set(ids.height, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
          </div>
          {!hexTileSetResult.ok && <p style={{ color: "crimson" }}>{hexTileSetResult.message}</p>}
          {hexSolveStatus === "error" && <p style={{ color: "crimson" }}>{hexSolveError}</p>}
          <canvas ref={hexCanvasRef} width={hexCanvasWidth} height={hexCanvasHeight} style={{ border: "1px solid #ccc", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => hexCanvasRef.current} label="tiles-hex" />
          </div>
          {hexSolveStatus === "solving" && <p>Solving…</p>}
          {hexSolveStatus === "done" && <p>{hexSolveGrid ? "Tiling found." : `No tiling exists for this tile set at ${width}x${height} axial cells.`}</p>}
        </>
      )}

      {lattice === "tri" && (
        <>
          <div style={{ margin: "0.25rem 0" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
              Tile set (one per line: <code>id left right top bottom</code>)
            </label>
            <textarea
              value={triTextInput}
              onChange={(e) => updateTriText(e.target.value)}
              rows={5}
              style={{ font: "inherit", fontFamily: "monospace", width: "24ch" }}
            />
            <div>
              <button type="button" onClick={() => updateTriText(DEFAULT_TRI_TILES_TEXT)}>
                Reset to default set
              </button>
            </div>
          </div>
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              width: <input type="number" min={1} value={width} onChange={(e) => graph.set(ids.width, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
            <label>
              height: <input type="number" min={1} value={height} onChange={(e) => graph.set(ids.height, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
          </div>
          {!triTileSetResult.ok && <p style={{ color: "crimson" }}>{triTileSetResult.message}</p>}
          {triSolveStatus === "error" && <p style={{ color: "crimson" }}>{triSolveError}</p>}
          <canvas ref={triCanvasRef} width={triCanvasWidth} height={triCanvasHeight} style={{ border: "1px solid #ccc", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => triCanvasRef.current} label="tiles-tri" />
          </div>
          {triSolveStatus === "solving" && <p>Solving…</p>}
          {triSolveStatus === "done" && <p>{triSolveGrid ? "Tiling found." : `No tiling exists for this tile set at ${width}x${height} cells.`}</p>}
        </>
      )}

      {lattice === "cube" && (
        <>
          <div style={{ margin: "0.25rem 0" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
              Tile set (one per line: <code>id N S E W U D</code>)
            </label>
            <textarea
              value={cubeTextInput}
              onChange={(e) => updateCubeText(e.target.value)}
              rows={5}
              style={{ font: "inherit", fontFamily: "monospace", width: "24ch" }}
            />
            <div>
              <button type="button" onClick={() => updateCubeText(DEFAULT_CUBE_TILES_TEXT)}>
                Reset to default set
              </button>
            </div>
          </div>
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              width: <input type="number" min={1} value={width} onChange={(e) => graph.set(ids.width, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
            <label>
              height: <input type="number" min={1} value={height} onChange={(e) => graph.set(ids.height, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
            <label>
              depth: <input type="number" min={1} value={depth} onChange={(e) => graph.set(ids.depth, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
          </div>
          {!cubeTileSetResult.ok && <p style={{ color: "crimson" }}>{cubeTileSetResult.message}</p>}
          {cubeSolveStatus === "error" && <p style={{ color: "crimson" }}>{cubeSolveError}</p>}
          <CubeGridView grid={cubeSolveGrid} />
          {cubeSolveStatus === "solving" && <p>Solving…</p>}
          {cubeSolveStatus === "done" && (
            <p>{cubeSolveGrid ? "Tiling found." : `No tiling exists for this tile set at ${width}x${height}x${depth} cells.`}</p>
          )}
        </>
      )}
    </div>
  );
}
