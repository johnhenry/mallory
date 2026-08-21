import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsTiles, TIME_CELL, type CellIdsTiles } from "../lib/cell-ids.ts";
import { DEFAULT_CORNER_TILES_TEXT, parseCornerTileSetText } from "../lib/corner-tile-set-text.ts";
import { parseCompoundTileSetText } from "../lib/compound-tile-set-text.ts";
import { DEFAULT_CUBE_TILES_TEXT, parseCubeTileSetText } from "../lib/cube-tile-set-text.ts";
import { startTilesExportJob } from "../lib/export-tiles-video.ts";
import { DEFAULT_HEX_TILES_TEXT, parseHexTileSetText } from "../lib/hex-tile-set-text.ts";
import { DEFAULT_LINEAR_TILES_TEXT, parseLinearTileSetText } from "../lib/linear-tile-set-text.ts";
import { DEFAULT_TILES_TEXT, parseTileSetText, tileSetToText } from "../lib/tile-set-text.ts";
import {
  DEFAULT_TILES_STATE,
  decodeTilesState,
  encodeTilesState,
  type TilesLattice,
  type TilesSolverKind,
  type TilesState,
} from "../lib/tiles-state.ts";
import { solveCornerTiles, type CornerGrid, type CornerTile, type CornerTileSet } from "../lib/tiles/corner-tile-model.ts";
import { linearEntropy, solveLinear, solveLinearPeriodic, type LinearGrid, type LinearEntropyResult, type LinearTile, type LinearTileSet } from "../lib/tiles/linear-tile-model.ts";
import { solveCube, type CubeDirection, type CubeGrid, type CubeTile, type CubeTileSet } from "../lib/tiles/cube-tile-model.ts";
import { relaxWangTiling, type RelaxResult } from "../lib/tiles/differentiable-relax.ts";
import { autocorrelationSurface, diffractionSpectrum, tileIdsPresent } from "../lib/tiles/diffraction.ts";
import { stripEntropy, type StripEntropyResult } from "../lib/tiles/entropy.ts";
import { edgeLabelColor } from "../lib/tiles/edge-colors.ts";
import { hexCenter, hexCorners, hexEdgeSegment } from "../lib/tiles/hex-geometry.ts";
import { solveHex, type HexGrid, type HexTile, type HexTileSet } from "../lib/tiles/hex-tile-model.ts";
import { expandTileSetSymmetry, type SymmetryGroup } from "../lib/tiles/symmetry.ts";
import { TILE_SET_CORPUS } from "../lib/tiles/tile-set-corpus.ts";
import {
  isBoundaryEdge,
  offsetKey,
  type CompoundSolveStep,
  type CompoundTile,
  type CompoundTileSet,
  type CompoundWangGrid,
  solveWangCompound,
} from "../lib/tiles/compound-tile-model.ts";
import { pruneToSccSustainable, solveTorus, solveWang, solveWangViaSat, type Direction, type SolveStep, type Tile, type TileSet, type WangGrid } from "../lib/tiles/tile-model.ts";
import { patchCensusGrowth } from "../lib/tiles/patch-census.ts";
import { solveWangWeighted, type TileWeights } from "../lib/tiles/weighted-tiling.ts";
import { Rng } from "mallory-tensor-core";
import { triCenterX, triCorners, triEdgeSegment } from "../lib/tiles/tri-geometry.ts";
import { solveTri, type TriGrid, type TriTile, type TriTileSet } from "../lib/tiles/tri-tile-model.ts";
import { DEFAULT_TRI_TILES_TEXT, parseTriTileSetText } from "../lib/tri-tile-set-text.ts";
import { useCell } from "../lib/use-cell.ts";
import { useTimelinePlayback } from "../lib/use-timeline-playback.ts";
import { drawGrayscaleGrid } from "../lib/image-frequency.ts";
import { drawAxes, drawPolyline } from "../lib/render-path.ts";
import { getThemeColors, subscribeToThemeChange } from "../lib/theme-colors.ts";
import type { Viewport } from "../lib/viewport.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { TransportControls } from "./TransportControls.tsx";
import { VideoExportControls } from "./VideoExportControls.tsx";
import { triOrientation, type TriDirection, type TriOrientation } from "mallory-math";

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
// Linear (1D) backtracking checks only 1 already-placed neighbor direction
// per cell (left), the least per-cell work of any lattice here -- so it
// gets a MUCH larger cap than MAX_HEX_TRI_CELLS/MAX_CUBE_CELLS's 100 (a 1D
// row of this length is still comfortably fast, and a smaller cap would be
// needlessly restrictive for a structure this cheap to search).
const MAX_LINEAR_CELLS = 2000;
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
  graph.set(ids.cornerTilesText, state.cornerTilesText);
  graph.set(ids.tileWeights, state.tileWeights);
  graph.set(ids.weightedSeed, state.weightedSeed);
  graph.set(ids.linearTilesText, state.linearTilesText);
  graph.set(ids.linearPeriodic, state.linearPeriodic);
}

function getCurrentState(graph: CellGraph, ids: CellIdsTiles): TilesState {
  return {
    v: 7,
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
    cornerTilesText: graph.get<string>(ids.cornerTilesText),
    tileWeights: graph.get<Record<string, number>>(ids.tileWeights),
    weightedSeed: graph.get<number>(ids.weightedSeed),
    linearTilesText: graph.get<string>(ids.linearTilesText),
    linearPeriodic: graph.get<boolean>(ids.linearPeriodic),
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
    graph.set(ids.cornerSolveStatus, "idle" as SolveStatus, { auxiliary: true });
    graph.set(ids.cornerSolveGrid, null as CornerGrid | null, { auxiliary: true });
    graph.set(ids.cornerSolveError, "", { auxiliary: true });
    graph.set(ids.linearSolveStatus, "idle" as SolveStatus, { auxiliary: true });
    graph.set(ids.linearSolveGrid, null as LinearGrid | null, { auxiliary: true });
    graph.set(ids.linearSolveError, "", { auxiliary: true });
    graph.set(ids.linearEntropyResult, null as LinearEntropyResult | null, { auxiliary: true });
    graph.set(ids.relaxSteps, 300, { auxiliary: true });
    graph.set(ids.relaxLr, 0.3, { auxiliary: true });
    graph.set(ids.relaxStatus, "idle" as RelaxStatus, { auxiliary: true });
    graph.set(ids.relaxResult, null as RelaxResult | null, { auxiliary: true });
    graph.set(ids.relaxError, "", { auxiliary: true });
    graph.set(ids.compoundSolveStatus, "idle" as SolveStatus, { auxiliary: true });
    graph.set(ids.compoundSolveSteps, [] as CompoundSolveStep[], { auxiliary: true });
    graph.set(ids.compoundSolveGrid, null as CompoundWangGrid | null, { auxiliary: true });
    graph.set(ids.compoundSolveError, "", { auxiliary: true });

    // Polyomino-supported tiles (#382/#383): always parse `tilesText`
    // through the compound-aware parser first -- for ordinary unit-only
    // text it's a strict superset of `parseTileSetText` (see
    // compound-tile-set-text.test.ts's own round-trip coverage against
    // it), so this is a no-op change for every existing tile set. Only
    // when the text actually declares a multi-cell (`@row,col`) footprint
    // does `tileSetResult` short-circuit to a friendly "not supported
    // here" error -- which then naturally propagates through every
    // existing `!ok`-checking consumer below (symmetry expansion, the
    // auto-solve effect, entropy, diffraction, relaxation), so none of
    // them need their own compound-awareness. `compoundTileSetResult`
    // (always populated, unit-only or not) feeds the SEPARATE compound
    // solve path this panel adds alongside the unit one.
    graph.define(ids.compoundTileSetResult, (): Result<CompoundTileSet> => {
      try {
        return { ok: true, value: parseCompoundTileSetText(graph.get<string>(ids.tilesText)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.tileSetResult, (): Result<TileSet> => {
      const compound = graph.get<Result<CompoundTileSet>>(ids.compoundTileSetResult);
      if (!compound.ok) return compound;
      if (compound.value.tiles.some((t) => t.footprint.length > 1)) {
        return { ok: false, message: "This tile set uses multi-cell (@row,col) tiles -- symmetry/entropy/diffraction/relaxation aren't available for those yet. See the compound solve view below." };
      }
      return {
        ok: true,
        value: { tiles: compound.value.tiles.map((t) => (t.locked ? { id: t.id, edges: t.cells.get("0,0")!.edges, locked: true } : { id: t.id, edges: t.cells.get("0,0")!.edges })) },
      };
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

    graph.define(ids.cornerTileSetResult, (): Result<CornerTileSet> => {
      try {
        return { ok: true, value: parseCornerTileSetText(graph.get<string>(ids.cornerTilesText)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.linearTileSetResult, (): Result<LinearTileSet> => {
      try {
        return { ok: true, value: parseLinearTileSetText(graph.get<string>(ids.linearTilesText)) };
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

const EDGE_STROKE_WIDTH = 2.5;

/** Strokes one edge segment in its matching-constraint color (see `edge-colors.ts`'s own doc comment) -- the shared draw primitive every lattice's edge-coloring uses. */
function strokeEdgeSegment(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = EDGE_STROKE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

/** Draws a square tile's 4 edges (N/E/S/W), each colored by its own edge label -- falls back to a flat faint border when `tile` is `undefined` (an id the tile set doesn't define, e.g. mid-edit). */
function drawSquareTileEdges(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tile: Tile | undefined): void {
  if (!tile) {
    ctx.strokeStyle = "#00000022";
    ctx.strokeRect(x, y, size, size);
    return;
  }
  strokeEdgeSegment(ctx, { x, y }, { x: x + size, y }, edgeLabelColor(tile.edges.N));
  strokeEdgeSegment(ctx, { x: x + size, y }, { x: x + size, y: y + size }, edgeLabelColor(tile.edges.E));
  strokeEdgeSegment(ctx, { x, y: y + size }, { x: x + size, y: y + size }, edgeLabelColor(tile.edges.S));
  strokeEdgeSegment(ctx, { x, y }, { x, y: y + size }, edgeLabelColor(tile.edges.W));
}

/** Draws a hex tile's 6 edges, each colored by its own edge label -- falls back to a flat faint outline when `tile` is `undefined`. */
function drawHexTileEdges(ctx: CanvasRenderingContext2D, corners: readonly { x: number; y: number }[], tile: HexTile | undefined): void {
  if (!tile) {
    ctx.strokeStyle = "#00000022";
    ctx.beginPath();
    corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    return;
  }
  for (let d = 0; d < 6; d++) {
    const [a, b] = hexEdgeSegment(corners, d);
    strokeEdgeSegment(ctx, a, b, edgeLabelColor(tile.edges[d as 0 | 1 | 2 | 3 | 4 | 5]));
  }
}

/** Draws a tri tile's 3 real edges (left/right + top-or-bottom per orientation), each colored by its own edge label -- falls back to a flat faint outline when `tile` is `undefined`. */
function drawTriTileEdges(ctx: CanvasRenderingContext2D, corners: readonly { x: number; y: number }[], orientation: TriOrientation, tile: TriTile | undefined): void {
  if (!tile) {
    ctx.strokeStyle = "#00000022";
    ctx.beginPath();
    corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    return;
  }
  const directions: TriDirection[] = ["left", "right", orientation === "up" ? "top" : "bottom"];
  for (const d of directions) {
    const [a, b] = triEdgeSegment(corners, d);
    strokeEdgeSegment(ctx, a, b, edgeLabelColor(tile.edges[d]));
  }
}

/** One-line caption for a solve step, used both under the transport controls and as the aria-live status. */
export function stepLabel(step: SolveStep): string {
  return step.contradiction
    ? `Backtrack at (${step.row}, ${step.col})`
    : `Place tile at (${step.row}, ${step.col})`;
}

/** Same as `stepLabel`, for a compound (multi-cell) solve step -- names the placed tile since "at (row, col)" alone doesn't convey a footprint. */
export function compoundStepLabel(step: CompoundSolveStep): string {
  return step.contradiction
    ? `Backtrack at anchor (${step.anchorRow}, ${step.anchorCol})`
    : `Place tile "${step.tileId}" at anchor (${step.anchorRow}, ${step.anchorCol})`;
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
 * `CubeDirection` -> `THREE.BoxGeometry` material-group index (issue #296).
 * BoxGeometry's 6 material groups are ordered [+X, -X, +Y, -Y, +Z, -Z]
 * (three.js's own documented convention), and `CubeGridView` places grid
 * cell (x, y, z) directly at Three.js (+x, +y, +z) (see its own
 * `mesh.position.set` -- no axis swap or flip), so `cubeNeighborCoords`'s
 * own model (E = x+1, W = x-1, S = y+1, N = y-1, U = z+1, D = z-1) gives
 * the mapping directly: the face TOWARD direction d's neighbor is the one
 * d's own coordinate offset points at.
 */
const CUBE_FACE_MATERIAL_ORDER: readonly CubeDirection[] = ["E", "W", "S", "N", "U", "D"];

/** The 6 per-face materials for one cube tile, each face colored by its own label (the 3D equivalent of drawSquareTileEdges's per-edge coloring), in BoxGeometry's material-group order. */
function cubeFaceMaterials(tile: CubeTile): THREE.MeshStandardMaterial[] {
  return CUBE_FACE_MATERIAL_ORDER.map((d) => new THREE.MeshStandardMaterial({ color: new THREE.Color(edgeLabelColor(tile.faces[d])) }));
}

/** Disposes a mesh's material whether it's a single material (the no-tile fallback) or the per-face array `cubeFaceMaterials` builds. */
function disposeMeshMaterials(mesh: THREE.Mesh): void {
  const m = mesh.material;
  if (Array.isArray(m)) for (const mat of m) mat.dispose();
  else m.dispose();
}

/**
 * Renders a solved `CubeGrid` as a grid of colored boxes in an orbit-
 * controllable 3D scene (issue #92 M4) -- same Scene/Camera/Renderer/
 * OrbitControls/lighting/Group setup as VectorField3DPanel, with one
 * `THREE.Mesh` per placed cell (colored via `tileColor`) instead of one
 * arrow per sampled vector. A standalone, props-only component (no own
 * CellGraph) since it just visualizes whatever grid `TilesPanel` passes in.
 */
function CubeGridView({ grid, tileSet }: { grid: CubeGrid | null; tileSet: CubeTileSet | null }) {
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
      if (child instanceof THREE.Mesh) disposeMeshMaterials(child);
    }
    if (!grid) return;
    const tileMap = new Map((tileSet?.tiles ?? []).map((t) => [t.id, t]));
    const depth = grid.length;
    const height = grid[0]?.length ?? 0;
    const width = grid[0]?.[0]?.length ?? 0;
    for (let z = 0; z < depth; z++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const id = grid[z]![y]![x];
          if (!id) continue;
          // Per-face label coloring when the tile is known (issue #296, the
          // 3D counterpart of the 2D lattices' per-edge coloring); flat
          // tile-id color as the fallback for an id the set doesn't define.
          const tile = tileMap.get(id);
          const material = tile ? cubeFaceMaterials(tile) : new THREE.MeshStandardMaterial({ color: new THREE.Color(tileColor(id)) });
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
  }, [grid, tileSet]);

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

const CUBE_PALETTE_HEIGHT = 140;
// Spacing between palette entries -- wider than CUBE_CELL_SPACING so
// separate tiles read as separate objects, not one solved grid.
const CUBE_PALETTE_SPACING = 1.8;

/**
 * Every cube tile in the set rendered on its own, face-colored by label
 * (issue #296's palette half) -- ONE shared Three.js scene with the tiles
 * in a row, not one canvas per tile, since browsers cap live WebGL
 * contexts (~8-16) and a per-tile renderer would break on larger sets.
 * The id order caption below the canvas stands in for in-scene text
 * labels (3D text needs a font/sprite pipeline nothing else in this app
 * has needed yet).
 */
function CubeTilePaletteView({ tiles }: { tiles: readonly CubeTile[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getThemeColors().surface);
    const unsubscribeTheme = subscribeToThemeChange(() => {
      scene.background = new THREE.Color(getThemeColors().surface);
    });

    const camera = new THREE.PerspectiveCamera(50, CUBE_VIEW_SIZE / CUBE_PALETTE_HEIGHT, 0.1, 1000);
    camera.position.set(0, 2.2, 4.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(CUBE_VIEW_SIZE, CUBE_PALETTE_HEIGHT, false);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 7);
    scene.add(directional);

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
    };
  }, []);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh) disposeMeshMaterials(child);
    }
    tiles.forEach((tile, i) => {
      const mesh = new THREE.Mesh(CUBE_CELL_GEOMETRY, cubeFaceMaterials(tile));
      mesh.position.set((i - (tiles.length - 1) / 2) * CUBE_PALETTE_SPACING, 0, 0);
      group.add(mesh);
    });
  }, [tiles]);

  return (
    <div style={{ margin: "0.5rem 0" }}>
      <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>Tile palette (each tile on its own, faces colored by label -- drag to orbit)</label>
      <div ref={containerRef} style={{ position: "relative", maxWidth: CUBE_VIEW_SIZE, border: "1px solid var(--border)" }} />
      <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0.15rem 0" }}>Left to right: {tiles.map((t) => t.id).join(", ")}</p>
    </div>
  );
}

const PALETTE_SQUARE_SIZE = 56;

/**
 * A single square tile's own edge-colored shape, apart from the solved grid
 * -- so a tile's matching constraints can be read off its definition
 * directly. `weight`/`onWeightChange` are optional (#398/#403's weighted
 * random solver): when provided, a small number input renders below the
 * canvas so each tile's own sampling weight can be edited from the palette
 * it's already being shown in, rather than a separate list keyed by id.
 */
function SquareTilePaletteEntry({ tile, weight, onWeightChange }: { tile: Tile; weight?: number; onWeightChange?: (weight: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PALETTE_SQUARE_SIZE, PALETTE_SQUARE_SIZE);
    ctx.fillStyle = tileColor(tile.id);
    ctx.fillRect(0, 0, PALETTE_SQUARE_SIZE, PALETTE_SQUARE_SIZE);
    drawSquareTileEdges(ctx, 0, 0, PALETTE_SQUARE_SIZE, tile);
    ctx.fillStyle = "#fff";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(tile.id, PALETTE_SQUARE_SIZE / 2, PALETTE_SQUARE_SIZE / 2);
  }, [tile]);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.15rem" }}>
      <canvas
        ref={canvasRef}
        width={PALETTE_SQUARE_SIZE}
        height={PALETTE_SQUARE_SIZE}
        style={{ border: tile.locked ? "2px dashed var(--muted)" : "1px solid var(--border)" }}
      />
      {tile.locked && (
        <span style={{ fontSize: "0.7rem", color: "var(--muted)" }} title="Orientation-locked (#414): this tile keeps its drawn orientation even when symmetry expansion is on for the rest of the set.">
          locked
        </span>
      )}
      {onWeightChange && (
        <label style={{ fontSize: "0.7rem", color: "var(--muted)" }} title={`Weight for tile ${tile.id} -- higher = more likely to be tried first at each cell (weightedShuffle's own default is 1).`}>
          w: <input type="number" min={0} step="any" value={weight ?? 1} onChange={(e) => onWeightChange(Math.max(0, Number(e.target.value)))} style={{ font: "inherit", width: "4ch" }} />
        </label>
      )}
    </div>
  );
}

/**
 * A compound (multi-cell) tile's own fused shape, apart from the solved
 * grid (issue #390's "preview each full domino" ask) -- same drawing
 * language as `SquareTilePaletteEntry` (fill + `edgeLabelColor`-per-side +
 * centered id label) and the compound solve canvas's own render effect,
 * factored out here since both need "skip the edge between two cells of
 * the same tile" -- draws the whole footprint at `PALETTE_SQUARE_SIZE`
 * per cell, translated so its top-left offset sits at the canvas origin
 * regardless of what the footprint's actual (possibly negative) offsets
 * are.
 */
function CompoundTilePaletteEntry({ tile }: { tile: CompoundTile }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minRow = Math.min(...tile.footprint.map((o) => o.row));
  const minCol = Math.min(...tile.footprint.map((o) => o.col));
  const maxRow = Math.max(...tile.footprint.map((o) => o.row));
  const maxCol = Math.max(...tile.footprint.map((o) => o.col));
  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;
  const canvasWidth = cols * PALETTE_SQUARE_SIZE;
  const canvasHeight = rows * PALETTE_SQUARE_SIZE;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = tileColor(tile.id);
    for (const offset of tile.footprint) {
      const x = (offset.col - minCol) * PALETTE_SQUARE_SIZE;
      const y = (offset.row - minRow) * PALETTE_SQUARE_SIZE;
      ctx.fillRect(x, y, PALETTE_SQUARE_SIZE, PALETTE_SQUARE_SIZE);
    }
    for (const offset of tile.footprint) {
      const cell = tile.cells.get(offsetKey(offset))!;
      const x = (offset.col - minCol) * PALETTE_SQUARE_SIZE;
      const y = (offset.row - minRow) * PALETTE_SQUARE_SIZE;
      if (isBoundaryEdge(tile.footprint, offset, "N")) strokeEdgeSegment(ctx, { x, y }, { x: x + PALETTE_SQUARE_SIZE, y }, edgeLabelColor(cell.edges.N));
      if (isBoundaryEdge(tile.footprint, offset, "E")) strokeEdgeSegment(ctx, { x: x + PALETTE_SQUARE_SIZE, y }, { x: x + PALETTE_SQUARE_SIZE, y: y + PALETTE_SQUARE_SIZE }, edgeLabelColor(cell.edges.E));
      if (isBoundaryEdge(tile.footprint, offset, "S")) strokeEdgeSegment(ctx, { x, y: y + PALETTE_SQUARE_SIZE }, { x: x + PALETTE_SQUARE_SIZE, y: y + PALETTE_SQUARE_SIZE }, edgeLabelColor(cell.edges.S));
      if (isBoundaryEdge(tile.footprint, offset, "W")) strokeEdgeSegment(ctx, { x, y }, { x, y: y + PALETTE_SQUARE_SIZE }, edgeLabelColor(cell.edges.W));
    }
    ctx.fillStyle = "#fff";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(tile.id, canvasWidth / 2, canvasHeight / 2);
  }, [tile, canvasWidth, canvasHeight, minRow, minCol]);

  return <canvas ref={canvasRef} width={canvasWidth} height={canvasHeight} style={{ border: "1px solid var(--border)" }} />;
}

const PALETTE_CORNER_SIZE = 48;
const PALETTE_CORNER_DOT_RADIUS = 4;

/** A single corner tile's own shape, apart from the solved grid -- 4 colored dots at its corners (its actual matching locus) instead of `SquareTilePaletteEntry`'s 4 edge segments. */
function CornerTilePaletteEntry({ tile }: { tile: CornerTile }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PALETTE_CORNER_SIZE, PALETTE_CORNER_SIZE);
    ctx.fillStyle = tileColor(tile.id);
    ctx.fillRect(0, 0, PALETTE_CORNER_SIZE, PALETTE_CORNER_SIZE);
    const dots: readonly [number, number, string][] = [
      [0, 0, tile.corners.NW],
      [PALETTE_CORNER_SIZE, 0, tile.corners.NE],
      [PALETTE_CORNER_SIZE, PALETTE_CORNER_SIZE, tile.corners.SE],
      [0, PALETTE_CORNER_SIZE, tile.corners.SW],
    ];
    for (const [dx, dy, label] of dots) {
      ctx.beginPath();
      ctx.arc(dx, dy, PALETTE_CORNER_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = edgeLabelColor(label);
      ctx.fill();
      ctx.strokeStyle = "#00000055";
      ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(tile.id, PALETTE_CORNER_SIZE / 2, PALETTE_CORNER_SIZE / 2);
  }, [tile]);
  return <canvas ref={canvasRef} width={PALETTE_CORNER_SIZE} height={PALETTE_CORNER_SIZE} style={{ border: "1px solid var(--border)" }} />;
}

const PALETTE_HEX_SIZE = 26;
const PALETTE_HEX_CANVAS_SIZE = PALETTE_HEX_SIZE * 2 + 10;

/** A single hex tile's own edge-colored shape, apart from the solved grid. */
function HexTilePaletteEntry({ tile }: { tile: HexTile }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PALETTE_HEX_CANVAS_SIZE, PALETTE_HEX_CANVAS_SIZE);
    const cx = PALETTE_HEX_CANVAS_SIZE / 2;
    const cy = PALETTE_HEX_CANVAS_SIZE / 2;
    const corners = hexCorners(cx, cy, PALETTE_HEX_SIZE);
    ctx.beginPath();
    corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = tileColor(tile.id);
    ctx.fill();
    drawHexTileEdges(ctx, corners, tile);
    ctx.fillStyle = "#fff";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(tile.id, cx, cy);
  }, [tile]);
  return <canvas ref={canvasRef} width={PALETTE_HEX_CANVAS_SIZE} height={PALETTE_HEX_CANVAS_SIZE} style={{ border: "1px solid var(--border)" }} />;
}

const PALETTE_TRI_WIDTH = 44;
const PALETTE_TRI_HEIGHT = 44;

/**
 * A single tri tile's own edge-colored shape, apart from the solved grid --
 * rendered BOTH as "up" and as "down" (two small triangles, not one),
 * since a `TriTile` always carries all 4 possible edges (`left`/`right`/
 * `top`/`bottom`) but only 3 apply at any one placement (`top` when the
 * grid cell it lands on is "up", `bottom` when "down" -- see
 * tri-tile-model.ts's own doc comment). Showing only one orientation would
 * hide whichever of `top`/`bottom` doesn't apply there.
 */
function TriTilePaletteEntry({ tile }: { tile: TriTile }) {
  const upRef = useRef<HTMLCanvasElement | null>(null);
  const downRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    for (const [ref, orientation] of [
      [upRef, "up"],
      [downRef, "down"],
    ] as const) {
      const ctx = ref.current?.getContext("2d");
      if (!ctx) continue;
      ctx.clearRect(0, 0, PALETTE_TRI_WIDTH, PALETTE_TRI_HEIGHT);
      const corners = triCorners(0, 0, PALETTE_TRI_WIDTH, PALETTE_TRI_HEIGHT, orientation);
      ctx.beginPath();
      corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = tileColor(tile.id);
      ctx.fill();
      drawTriTileEdges(ctx, corners, orientation, tile);
      ctx.fillStyle = "#fff";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tile.id, PALETTE_TRI_WIDTH / 2, orientation === "up" ? PALETTE_TRI_HEIGHT * 0.65 : PALETTE_TRI_HEIGHT * 0.35);
    }
  }, [tile]);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.15rem" }}>
      <div style={{ display: "flex", gap: "0.15rem" }}>
        <canvas ref={upRef} width={PALETTE_TRI_WIDTH} height={PALETTE_TRI_HEIGHT} style={{ border: "1px solid var(--border)" }} />
        <canvas ref={downRef} width={PALETTE_TRI_WIDTH} height={PALETTE_TRI_HEIGHT} style={{ border: "1px solid var(--border)" }} />
      </div>
      <span style={{ fontSize: "0.65rem", color: "var(--muted)" }}>as up / as down</span>
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
  const tileWeights = useCell<Record<string, number>>(graph, ids.tileWeights);
  const weightedSeed = useCell<number>(graph, ids.weightedSeed);
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
  const startTilesExportJobFn = useServerFn(startTilesExportJob);

  const compoundTileSetResult = useCell<Result<CompoundTileSet>>(graph, ids.compoundTileSetResult);
  const isCompound = compoundTileSetResult.ok && compoundTileSetResult.value.tiles.some((t) => t.footprint.length > 1);
  const compoundSolveStatus = useCell<SolveStatus>(graph, ids.compoundSolveStatus);
  const compoundSolveSteps = useCell<CompoundSolveStep[]>(graph, ids.compoundSolveSteps);
  const compoundSolveGrid = useCell<CompoundWangGrid | null>(graph, ids.compoundSolveGrid);
  const compoundSolveError = useCell<string>(graph, ids.compoundSolveError);

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
  const cornerTilesText = useCell<string>(graph, ids.cornerTilesText);
  const cornerTileSetResult = useCell<Result<CornerTileSet>>(graph, ids.cornerTileSetResult);
  const cornerSolveStatus = useCell<SolveStatus>(graph, ids.cornerSolveStatus);
  const cornerSolveGrid = useCell<CornerGrid | null>(graph, ids.cornerSolveGrid);
  const cornerSolveError = useCell<string>(graph, ids.cornerSolveError);
  const linearTilesText = useCell<string>(graph, ids.linearTilesText);
  const linearTileSetResult = useCell<Result<LinearTileSet>>(graph, ids.linearTileSetResult);
  const linearPeriodic = useCell<boolean>(graph, ids.linearPeriodic);
  const linearSolveStatus = useCell<SolveStatus>(graph, ids.linearSolveStatus);
  const linearSolveGrid = useCell<LinearGrid | null>(graph, ids.linearSolveGrid);
  const linearSolveError = useCell<string>(graph, ids.linearSolveError);
  const linearEntropyResult = useCell<LinearEntropyResult | null>(graph, ids.linearEntropyResult);

  const [textInput, setTextInput] = useState(tilesText);
  useEffect(() => setTextInput(tilesText), [tilesText]);
  const [hexTextInput, setHexTextInput] = useState(hexTilesText);
  useEffect(() => setHexTextInput(hexTilesText), [hexTilesText]);
  const [triTextInput, setTriTextInput] = useState(triTilesText);
  useEffect(() => setTriTextInput(triTilesText), [triTilesText]);
  const [cubeTextInput, setCubeTextInput] = useState(cubeTilesText);
  useEffect(() => setCubeTextInput(cubeTilesText), [cubeTilesText]);
  const [cornerTextInput, setCornerTextInput] = useState(cornerTilesText);
  useEffect(() => setCornerTextInput(cornerTilesText), [cornerTilesText]);
  const [linearTextInput, setLinearTextInput] = useState(linearTilesText);
  useEffect(() => setLinearTextInput(linearTilesText), [linearTilesText]);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const duration = showAnimation ? (isCompound ? compoundSolveSteps.length : solveSteps.length) * STEP_SECONDS : 0;
  useTimelinePlayback(graph, playing, loop, speed, duration, setPlaying);

  useModelContextTool({
    name: `tiles_${cellId}_solve`,
    description:
      "Re-run the Wang tile solve with the panel's current tile set, width, height, and solver variant. Returns whether a tiling was found and how many search steps it took. If the tile set uses multi-cell (@row,col) tiles, `compound` is true and the result comes from the compound solver instead (solver/symmetry are ignored in that case -- see #383). Normally solving is triggered automatically whenever the tile set/width/height/solver changes, so this is mainly useful to force a re-solve after an external set_cell write.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const compound = graph.get<Result<CompoundTileSet>>(ids.compoundTileSetResult);
      if (compound.ok && compound.value.tiles.some((t) => t.footprint.length > 1)) {
        return {
          compound: true,
          status: graph.get<SolveStatus>(ids.compoundSolveStatus),
          found: graph.get<CompoundWangGrid | null>(ids.compoundSolveGrid) !== null,
          steps: graph.get<CompoundSolveStep[]>(ids.compoundSolveSteps).length,
        };
      }
      const status = graph.get<SolveStatus>(ids.solveStatus);
      return { compound: false, status, found: graph.get<WangGrid | null>(ids.solveGrid) !== null, steps: graph.get<SolveStep[]>(ids.solveSteps).length };
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
            : solver === "weighted"
              ? solveWangWeighted(expandedTileSetResult.value, width, height, new Map(Object.entries(tileWeights)) as TileWeights, new Rng(weightedSeed), {
                  trackSteps: showAnimation,
                })
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
  }, [graph, lattice, expandedTileSetResult, width, height, solver, showAnimation, tileWeights, weightedSeed]);

  // Compound (multi-cell footprint) auto-solve (#382/#383): same "drain the
  // async generator, write back via graph.set" shape as the unit solve
  // effect above, but only ever runs `solveWangCompound` -- torus/SAT
  // aren't compound-aware yet (see solveWangCompound's own doc comment),
  // so `solver` is ignored here regardless of the dropdown's value.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (lattice !== "square" || !isCompound || !compoundTileSetResult.ok) {
        graph.set(ids.compoundSolveStatus, "idle" satisfies SolveStatus);
        graph.set(ids.compoundSolveSteps, []);
        graph.set(ids.compoundSolveGrid, null);
        graph.set(ids.compoundSolveError, "");
        return;
      }
      if (width < 1 || height < 1 || width * height > MAX_CELLS) {
        graph.set(ids.compoundSolveStatus, "error" satisfies SolveStatus);
        graph.set(ids.compoundSolveError, `Grid must be at least 1x1 and at most ${MAX_CELLS} cells total.`);
        return;
      }
      graph.set(ids.compoundSolveStatus, "solving" satisfies SolveStatus);
      try {
        const gen = solveWangCompound(compoundTileSetResult.value, width, height, { trackSteps: showAnimation });
        const steps: CompoundSolveStep[] = [];
        let next = await gen.next();
        while (!next.done) {
          steps.push(next.value);
          if (steps.length > MAX_STEPS) throw new Error(`Search exceeded ${MAX_STEPS} steps -- reduce the grid size or tile set.`);
          next = await gen.next();
        }
        if (cancelled) return;
        graph.set(ids.compoundSolveSteps, steps);
        graph.set(ids.compoundSolveGrid, next.value);
        graph.set(ids.compoundSolveError, "");
        graph.set(ids.compoundSolveStatus, "done" satisfies SolveStatus);
      } catch (e) {
        if (cancelled) return;
        graph.set(ids.compoundSolveStatus, "error" satisfies SolveStatus);
        graph.set(ids.compoundSolveError, e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, lattice, isCompound, compoundTileSetResult, width, height, showAnimation]);

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

  // Corner-tile auto-solve (#388/#394): same shape as the hex/tri effects
  // above (no step-by-step animation, drained straight to a final grid).
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (lattice !== "corner" || !cornerTileSetResult.ok) {
        graph.set(ids.cornerSolveStatus, "idle" satisfies SolveStatus);
        graph.set(ids.cornerSolveGrid, null);
        graph.set(ids.cornerSolveError, "");
        return;
      }
      if (width < 1 || height < 1 || width * height > MAX_HEX_TRI_CELLS) {
        graph.set(ids.cornerSolveStatus, "error" satisfies SolveStatus);
        graph.set(ids.cornerSolveError, `Grid must be at least 1x1 and at most ${MAX_HEX_TRI_CELLS} cells total.`);
        return;
      }
      graph.set(ids.cornerSolveStatus, "solving" satisfies SolveStatus);
      try {
        const grid = await drainSolveToGrid(solveCornerTiles(cornerTileSetResult.value, width, height, { trackSteps: false }));
        if (cancelled) return;
        graph.set(ids.cornerSolveGrid, grid);
        graph.set(ids.cornerSolveError, "");
        graph.set(ids.cornerSolveStatus, "done" satisfies SolveStatus);
      } catch (e) {
        if (cancelled) return;
        graph.set(ids.cornerSolveStatus, "error" satisfies SolveStatus);
        graph.set(ids.cornerSolveError, e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, lattice, cornerTileSetResult, width, height]);

  // Linear (1D) auto-solve (#397): same shape as the hex/tri/corner effects
  // above (no step-by-step animation, drained straight to a final grid) --
  // reuses `width` as the row's length (no separate dimension field, same
  // "reuse width/height" convention every other lattice already follows).
  // Also recomputes `linearEntropyResult` right after a successful parse,
  // independent of whether the solve itself succeeds (a tile set can have
  // a well-defined entropy -- or a well-defined "no bi-infinite tiling"
  // failure -- regardless of whether THIS length's finite row happens to
  // solve).
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (lattice !== "linear" || !linearTileSetResult.ok) {
        graph.set(ids.linearSolveStatus, "idle" satisfies SolveStatus);
        graph.set(ids.linearSolveGrid, null);
        graph.set(ids.linearSolveError, "");
        graph.set(ids.linearEntropyResult, null);
        return;
      }
      try {
        graph.set(ids.linearEntropyResult, linearEntropy(linearTileSetResult.value));
      } catch {
        // A friendly "no bi-infinite tiling" message is shown from the
        // stored `null` below, not a caught error -- see the JSX's own
        // linearEntropyResult readout.
        graph.set(ids.linearEntropyResult, null);
      }
      if (width < 1 || width > MAX_LINEAR_CELLS) {
        graph.set(ids.linearSolveStatus, "error" satisfies SolveStatus);
        graph.set(ids.linearSolveError, `Length must be at least 1 and at most ${MAX_LINEAR_CELLS} tiles.`);
        return;
      }
      graph.set(ids.linearSolveStatus, "solving" satisfies SolveStatus);
      try {
        const solver = linearPeriodic ? solveLinearPeriodic : solveLinear;
        const grid = await drainSolveToGrid(solver(linearTileSetResult.value, width, { trackSteps: false }));
        if (cancelled) return;
        graph.set(ids.linearSolveGrid, grid);
        graph.set(ids.linearSolveError, "");
        graph.set(ids.linearSolveStatus, "done" satisfies SolveStatus);
      } catch (e) {
        if (cancelled) return;
        graph.set(ids.linearSolveStatus, "error" satisfies SolveStatus);
        graph.set(ids.linearSolveError, e instanceof Error ? e.message : String(e));
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, lattice, linearTileSetResult, width, linearPeriodic]);

  // A changed solve restarts the animation from the beginning.
  useEffect(() => {
    graph.set(TIME_CELL, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solveSteps, compoundSolveSteps]);

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
  const compoundCurrentStepIndex = compoundSolveSteps.length > 0 ? Math.min(compoundSolveSteps.length - 1, Math.floor(time / STEP_SECONDS)) : -1;
  const compoundCurrentStep = compoundCurrentStepIndex >= 0 ? compoundSolveSteps[compoundCurrentStepIndex] : undefined;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWidth = Math.max(1, width) * CELL_SIZE;
  const canvasHeight = Math.max(1, height) * CELL_SIZE;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    if (isCompound) {
      // Same fill/edge/label drawing as the unit-tile path below, except
      // an edge shared with another cell of the SAME placement (same
      // tileId + anchor) is skipped entirely -- that's exactly what makes
      // a multi-cell tile read as one shape instead of N independent
      // unit cells (#383's own "one tile lights up across its footprint"
      // ask).
      const displayGrid = showAnimation && compoundCurrentStep ? compoundCurrentStep.grid : compoundSolveGrid;
      if (!displayGrid) return;
      const cellMap = new Map<string, Tile>();
      if (compoundTileSetResult.ok) {
        for (const tile of compoundTileSetResult.value.tiles) {
          for (const offset of tile.footprint) {
            cellMap.set(`${tile.id}:${offset.row},${offset.col}`, tile.cells.get(`${offset.row},${offset.col}`)!);
          }
        }
      }
      for (let row = 0; row < displayGrid.length; row++) {
        for (let col = 0; col < displayGrid[row]!.length; col++) {
          const cell = displayGrid[row]![col];
          const x = col * CELL_SIZE;
          const y = row * CELL_SIZE;
          ctx.fillStyle = cell ? tileColor(cell.tileId) : EMPTY_CELL_FILL;
          ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
          if (cell) {
            const offset = { row: row - cell.anchorRow, col: col - cell.anchorCol };
            const cellTile = cellMap.get(`${cell.tileId}:${offset.row},${offset.col}`);
            const samePlacement = (r: number, c: number): boolean => {
              const neighbor = displayGrid[r]?.[c];
              return !!neighbor && neighbor.tileId === cell.tileId && neighbor.anchorRow === cell.anchorRow && neighbor.anchorCol === cell.anchorCol;
            };
            if (!cellTile) {
              ctx.strokeStyle = "#00000022";
              ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
            } else {
              if (!samePlacement(row - 1, col)) strokeEdgeSegment(ctx, { x, y }, { x: x + CELL_SIZE, y }, edgeLabelColor(cellTile.edges.N));
              if (!samePlacement(row, col + 1)) strokeEdgeSegment(ctx, { x: x + CELL_SIZE, y }, { x: x + CELL_SIZE, y: y + CELL_SIZE }, edgeLabelColor(cellTile.edges.E));
              if (!samePlacement(row + 1, col)) strokeEdgeSegment(ctx, { x, y: y + CELL_SIZE }, { x: x + CELL_SIZE, y: y + CELL_SIZE }, edgeLabelColor(cellTile.edges.S));
              if (!samePlacement(row, col - 1)) strokeEdgeSegment(ctx, { x, y }, { x, y: y + CELL_SIZE }, edgeLabelColor(cellTile.edges.W));
            }
            if (cell.anchorRow === row && cell.anchorCol === col) {
              ctx.fillStyle = "#fff";
              ctx.font = "13px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(cell.tileId, x + CELL_SIZE / 2, y + CELL_SIZE / 2);
            }
          }
        }
      }
      if (showAnimation && compoundCurrentStep) {
        const x = compoundCurrentStep.anchorCol * CELL_SIZE;
        const y = compoundCurrentStep.anchorRow * CELL_SIZE;
        ctx.strokeStyle = compoundCurrentStep.contradiction ? "#dc2626" : "#16a34a";
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
      }
      return;
    }

    const displayGrid: ReadonlyArray<ReadonlyArray<string | null>> | null =
      showAnimation && currentStep ? currentStep.grid : solveGrid;
    if (!displayGrid) return;

    const tileMap = new Map(expandedTileSetResult.ok ? expandedTileSetResult.value.tiles.map((t) => [t.id, t]) : []);
    for (let row = 0; row < displayGrid.length; row++) {
      for (let col = 0; col < displayGrid[row]!.length; col++) {
        const id = displayGrid[row]![col];
        const x = col * CELL_SIZE;
        const y = row * CELL_SIZE;
        ctx.fillStyle = id ? tileColor(id) : EMPTY_CELL_FILL;
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        drawSquareTileEdges(ctx, x, y, CELL_SIZE, id ? tileMap.get(id) : undefined);
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
  }, [canvasWidth, canvasHeight, showAnimation, currentStep, solveGrid, expandedTileSetResult, isCompound, compoundCurrentStep, compoundSolveGrid, compoundTileSetResult]);

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
    const tileMap = new Map(hexTileSetResult.ok ? hexTileSetResult.value.tiles.map((t) => [t.id, t]) : []);
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
        drawHexTileEdges(ctx, corners, tileMap.get(id));
        ctx.fillStyle = "#fff";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(id, cx, cy);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hexCanvasWidth, hexCanvasHeight, hexSolveGrid, hexTileSetResult]);

  // Tri canvas: a true edge-to-edge mesh (see tri-geometry.ts's own doc
  // comment) -- each row is cellHeight tall, and column x's triangle is
  // centered at triCenterX(x, cellWidth), so the canvas is (width+1) half-
  // widths wide, not width*cellWidth like the old bounding-box layout.
  const TRI_CELL_WIDTH = 48;
  const TRI_CELL_HEIGHT = 48;
  const triCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const triCanvasWidth = (Math.max(1, width) + 1) * (TRI_CELL_WIDTH / 2);
  const triCanvasHeight = Math.max(1, height) * TRI_CELL_HEIGHT;

  useEffect(() => {
    const ctx = triCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, triCanvasWidth, triCanvasHeight);
    if (!triSolveGrid) return;
    const tileMap = new Map(triTileSetResult.ok ? triTileSetResult.value.tiles.map((t) => [t.id, t]) : []);
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
        drawTriTileEdges(ctx, corners, orientation, tileMap.get(id));
        const midX = triCenterX(x, TRI_CELL_WIDTH);
        const midY = orientation === "up" ? (y + 0.65) * TRI_CELL_HEIGHT : (y + 0.35) * TRI_CELL_HEIGHT;
        ctx.fillStyle = "#fff";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(id, midX, midY);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triCanvasWidth, triCanvasHeight, triSolveGrid, triTileSetResult]);

  // Corner canvas (#388/#394): a plain axis-aligned square grid, same
  // CELL_SIZE as the square lattice's own canvas -- but draws 4 colored
  // dots at the cell's corners (its actual matching locus) instead of 4
  // colored side segments.
  const cornerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cornerCanvasWidth = Math.max(1, width) * CELL_SIZE;
  const cornerCanvasHeight = Math.max(1, height) * CELL_SIZE;
  const CORNER_DOT_RADIUS = 5;

  useEffect(() => {
    const ctx = cornerCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cornerCanvasWidth, cornerCanvasHeight);
    if (!cornerSolveGrid) return;
    const tileMap = new Map(cornerTileSetResult.ok ? cornerTileSetResult.value.tiles.map((t) => [t.id, t]) : []);
    for (let row = 0; row < cornerSolveGrid.length; row++) {
      for (let col = 0; col < cornerSolveGrid[row]!.length; col++) {
        const id = cornerSolveGrid[row]![col]!;
        const x = col * CELL_SIZE;
        const y = row * CELL_SIZE;
        ctx.fillStyle = tileColor(id);
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        const tile = tileMap.get(id);
        if (tile) {
          const dots: readonly [number, number, string][] = [
            [x, y, tile.corners.NW],
            [x + CELL_SIZE, y, tile.corners.NE],
            [x + CELL_SIZE, y + CELL_SIZE, tile.corners.SE],
            [x, y + CELL_SIZE, tile.corners.SW],
          ];
          for (const [dx, dy, label] of dots) {
            ctx.beginPath();
            ctx.arc(dx, dy, CORNER_DOT_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = edgeLabelColor(label);
            ctx.fill();
            ctx.strokeStyle = "#00000055";
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle = "#00000022";
          ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
        }
        ctx.fillStyle = "#fff";
        ctx.font = "13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(id, x + CELL_SIZE / 2, y + CELL_SIZE / 2);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cornerCanvasWidth, cornerCanvasHeight, cornerSolveGrid, cornerTileSetResult]);

  // Linear canvas (#397): a single horizontal row of colored rectangles,
  // one per solved tile (`width` reused as the row's length) -- same
  // CELL_SIZE as the square/corner lattices' own canvases. Two small tick
  // marks near the left/right edges of each cell show that tile's own
  // left/right labels (similar spirit to `drawSquareTileEdges`, but only
  // the 2 sides a linear tile actually has).
  const linearCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const linearCanvasWidth = Math.max(1, width) * CELL_SIZE;
  const linearCanvasHeight = CELL_SIZE;
  const LINEAR_TICK_INSET = 6;

  useEffect(() => {
    const ctx = linearCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, linearCanvasWidth, linearCanvasHeight);
    if (!linearSolveGrid) return;
    const tileMap = new Map(linearTileSetResult.ok ? linearTileSetResult.value.tiles.map((t) => [t.id, t]) : []);
    for (let col = 0; col < linearSolveGrid.length; col++) {
      const id = linearSolveGrid[col]!;
      const x = col * CELL_SIZE;
      ctx.fillStyle = tileColor(id);
      ctx.fillRect(x, 0, CELL_SIZE, CELL_SIZE);
      const tile = tileMap.get(id);
      if (tile) {
        strokeEdgeSegment(ctx, { x: x + LINEAR_TICK_INSET, y: 0 }, { x: x + LINEAR_TICK_INSET, y: CELL_SIZE }, edgeLabelColor(tile.left));
        strokeEdgeSegment(
          ctx,
          { x: x + CELL_SIZE - LINEAR_TICK_INSET, y: 0 },
          { x: x + CELL_SIZE - LINEAR_TICK_INSET, y: CELL_SIZE },
          edgeLabelColor(tile.right),
        );
      } else {
        ctx.strokeStyle = "#00000022";
        ctx.strokeRect(x, 0, CELL_SIZE, CELL_SIZE);
      }
      ctx.fillStyle = "#fff";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(id, x + CELL_SIZE / 2, CELL_SIZE / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linearCanvasWidth, linearCanvasHeight, linearSolveGrid, linearTileSetResult]);

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
    const tileMap = new Map(expandedTileSetResult.ok ? expandedTileSetResult.value.tiles.map((t) => [t.id, t]) : []);
    for (let row = 0; row < relaxResult.grid.length; row++) {
      for (let col = 0; col < relaxResult.grid[row]!.length; col++) {
        const id = relaxResult.grid[row]![col]!;
        const x = col * CELL_SIZE;
        const y = row * CELL_SIZE;
        ctx.fillStyle = tileColor(id);
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
        drawSquareTileEdges(ctx, x, y, CELL_SIZE, tileMap.get(id));
        ctx.fillStyle = "#fff";
        ctx.font = "13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(id, x + CELL_SIZE / 2, y + CELL_SIZE / 2);
      }
    }
  }, [relaxCanvasWidth, relaxCanvasHeight, relaxResult, expandedTileSetResult]);

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
      [
        ids.tilesText,
        ids.width,
        ids.height,
        ids.solver,
        ids.showAnimation,
        ids.symmetry,
        ids.lattice,
        ids.hexTilesText,
        ids.triTilesText,
        ids.cubeTilesText,
        ids.depth,
        ids.cornerTilesText,
        ids.tileWeights,
        ids.weightedSeed,
        ids.linearTilesText,
        ids.linearPeriodic,
      ],
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

  function updateCornerText(value: string) {
    setCornerTextInput(value);
    graph.set(ids.cornerTilesText, value);
  }

  function updateLinearText(value: string) {
    setLinearTextInput(value);
    graph.set(ids.linearTilesText, value);
  }

  return (
    <div>
      <details
        open
        style={{ margin: "0 0 0.75rem", padding: "0.5rem 0.75rem", border: "1px solid var(--border, #ccc)", borderRadius: 4 }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>How this works</summary>
        <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.5rem" }}>
          <p style={{ margin: "0 0 0.5rem" }}>
            This is a <strong>Wang tile laboratory</strong>: a Wang tile is a square (or hex/triangle/cube face) whose edges
            each carry a label. Two tiles may sit next to each other only when the labels on their touching edges match
            exactly -- any text works as a label (letters, numbers, or a shared placeholder like <code>x</code> for edges
            you want to freely match within your own tile set). Define a tile set as text below, pick a grid size, and the
            panel searches for a way to fill the grid so every shared edge matches.
          </p>
          <p style={{ margin: "0 0 0.5rem" }}>
            <strong>Notation</strong> depends on the lattice: square tiles are <code>id N E S W</code> (edge labels
            clockwise from north); hexagonal tiles are <code>id e0 e1 e2 e3 e4 e5</code> (E, NE, NW, W, SW, SE); triangular
            tiles are <code>id left right top bottom</code> (an up- or down-pointing triangle only uses 3 of its 4
            declared edges); cube tiles are <code>id N S E W U D</code> (the six face labels); corner-matched square
            tiles are <code>id NE SE SW NW</code> (4 CORNER labels instead of 4 edges -- two tiles match by agreeing on
            a shared corner, constraining diagonal neighbors too, not just orthogonal ones; see #388); linear (1D)
            tiles are <code>id left right</code> (only 2 edges -- a labeled domino placed in a single row; see #397).
          </p>
          <p style={{ margin: "0 0 0.5rem" }}>
            <strong>Solver</strong> (square lattice): "Backtracking" places tiles left-to-right, top-to-bottom, checking
            each new tile against its already-placed neighbors, and backtracks out of dead ends -- turn on "Animate step
            by step" to watch the search happen. "Backtracking (torus/periodic)" additionally requires the grid to wrap
            edge-to-edge. "SAT cross-check" solves the same constraints with an independent SAT solver, as a check on the
            backtracking result. "Weighted random" (#398) is the same backtracking search, but tries each cell's
            compatible candidates in a weighted-random order instead of tile-array order -- set each tile's own weight
            in the palette above (higher = tried first more often) and a seed for reproducibility; it still finds a
            tiling whenever one exists, since weights only affect search order, never completeness.{" "}
            <strong>Symmetry</strong> expands every tile into its rotated/reflected variants before
            solving, so a tile set stays small to write but can be used in any orientation -- except a tile whose id
            ends in <code>*</code> (e.g. <code>A*</code>, square lattice only, #414), which stays orientation-locked
            at its drawn orientation even while the rest of the set expands, for a tile whose specific facing is
            meaningful and shouldn't be treated as interchangeable with its own rotations/reflections.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Below the grid</strong> (square lattice only): <strong>Entropy</strong> estimates -- via the
            transfer-matrix method -- how many distinct valid tilings exist per cell on average (higher = more freedom,
            near zero = a highly constrained tile set). <strong>Patch census</strong> counts how many distinct patches
            of each size actually occur in the solved grid -- the finite-size "language" entropy is itself derived from
            as a growth-rate limit. <strong>Diffraction/autocorrelation</strong> treat "where does
            tile X appear in the solved grid" as a pattern and plot its frequency spectrum and self-similarity: periodic
            tilings show sharp peaks, disordered ones show a diffuse cloud. <strong>Differentiable relaxation</strong> is
            an experimental alternate solver that optimizes a soft tile assignment via gradient descent instead of
            backtracking search, to see whether it converges to a valid tiling.
          </p>
          <p style={{ margin: "0.5rem 0 0" }}>
            The <strong>linear (1D) lattice</strong>'s own entropy readout is EXACT, not an approximation -- unlike the
            square lattice's strip-height transfer-matrix estimate above (which only converges to the true 2D entropy
            as strip height grows), a 1D tile chain's tile-to-tile adjacency IS already the full transfer relation, so
            <code>log(dominant eigenvalue)</code> is the whole answer, with no strip-height normalization needed.
          </p>
        </div>
      </details>

      <div style={{ margin: "0.25rem 0" }}>
        <label>
          lattice:{" "}
          <select value={lattice} onChange={(e) => graph.set(ids.lattice, e.target.value as TilesLattice)}>
            <option value="square">Square (4 edges)</option>
            <option value="hex">Hexagonal (6 edges)</option>
            <option value="tri">Triangular (4 edges, 3 used per cell)</option>
            <option value="cube">Cube (6 faces, 3D)</option>
            <option value="corner">Corner-matched square (4 corners, #388)</option>
            <option value="linear">Linear (1D, #397)</option>
          </select>
        </label>
        {lattice !== "square" && (
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0 0" }}>
            Symmetry, entropy, and diffraction analysis are square-lattice-only for now (issue #92 M3).{" "}
            {lattice === "hex"
              ? "Hexagonal"
              : lattice === "tri"
                ? "Triangular"
                : lattice === "cube"
                  ? "Cube"
                  : lattice === "corner"
                    ? "Corner-matched square"
                    : "Linear (1D)"}{" "}
            tiling supports editing, solving, and rendering.
          </p>
        )}
      </div>

      {lattice === "square" && (
        <>
          <div style={{ margin: "0.25rem 0" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
              Tile set (one per line: <code>id N E S W</code> -- or, for a multi-cell tile, several lines sharing one{" "}
              <code>id@row,col N E S W</code>, with <code>?</code> marking a side welded to another cell of the same tile; a line with the id omitted, or just{" "}
              <code>?</code>, continues the tile above one row down; see #293/#390)
            </label>
            <textarea
              value={textInput}
              onChange={(e) => updateText(e.target.value)}
              rows={5}
              style={{ font: "inherit", fontFamily: "monospace", width: "24ch" }}
            />
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={() => updateText(DEFAULT_TILES_TEXT)}>
                Reset to default set
              </button>
              <label title="Canonical tile sets from the literature (#387) -- loading one also sets the symmetry dropdown below to its recommended setting.">
                load preset:{" "}
                <select
                  value=""
                  onChange={(e) => {
                    const entry = TILE_SET_CORPUS.find((p) => p.id === e.target.value);
                    if (!entry) return;
                    updateText(tileSetToText(entry.tileSet as TileSet));
                    graph.set(ids.symmetry, entry.recommendedSymmetry);
                  }}
                >
                  <option value="" disabled>
                    (choose a preset…)
                  </option>
                  {TILE_SET_CORPUS.map((entry) => (
                    <option key={entry.id} value={entry.id} title={entry.description}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {tileSetResult.ok && (
            <div style={{ margin: "0.5rem 0" }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>Tile palette (each tile on its own, apart from the grid)</label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {tileSetResult.value.tiles.map((t) => (
                  <SquareTilePaletteEntry
                    key={t.id}
                    tile={t}
                    weight={solver === "weighted" ? (tileWeights[t.id] ?? 1) : undefined}
                    onWeightChange={solver === "weighted" ? (w) => graph.set(ids.tileWeights, { ...tileWeights, [t.id]: w }) : undefined}
                  />
                ))}
              </div>
            </div>
          )}
          {isCompound && compoundTileSetResult.ok && (
            <div style={{ margin: "0.5rem 0" }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
                Compound tile palette ({compoundTileSetResult.value.tiles.length} tile{compoundTileSetResult.value.tiles.length === 1 ? "" : "s"}, each on its own -- #390)
              </label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {compoundTileSetResult.value.tiles.map((t) => (
                  <CompoundTilePaletteEntry key={t.id} tile={t} />
                ))}
              </div>
            </div>
          )}
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              width: <input type="number" min={1} value={width} onChange={(e) => graph.set(ids.width, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
            <label>
              height: <input type="number" min={1} value={height} onChange={(e) => graph.set(ids.height, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
            <label title={isCompound ? "Only plain backtracking solves multi-cell tile sets -- torus/SAT aren't compound-aware yet (#383)." : "How the grid gets filled -- see &quot;How this works&quot; above for what each option does."}>
              solver:{" "}
              <select value={solver} disabled={isCompound} onChange={(e) => graph.set(ids.solver, e.target.value as TilesSolverKind)}>
                <option value="wang">Backtracking</option>
                <option value="torus">Backtracking (torus/periodic)</option>
                <option value="sat">SAT cross-check</option>
                <option value="weighted">Weighted random (#398)</option>
              </select>
            </label>
            {solver === "weighted" && (
              <label title="Rng seed for the weighted solver -- same seed + same weights always finds the same tiling.">
                seed: <input type="number" value={weightedSeed} onChange={(e) => graph.set(ids.weightedSeed, Number(e.target.value))} style={{ font: "inherit", width: "6ch" }} />
              </label>
            )}
            <label title={isCompound ? "Symmetry expansion isn't compound-aware yet (#383)." : "Expands each tile into its rotated/reflected variants before solving, so a small tile set can be used in any orientation."}>
              symmetry:{" "}
              <select value={symmetry} disabled={isCompound} onChange={(e) => graph.set(ids.symmetry, e.target.value as SymmetryGroup)}>
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

          {isCompound && (
            <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              Multi-cell tile set: solving uses plain backtracking regardless of the solver dropdown above; symmetry, entropy, diffraction, and relaxation aren't available for these yet (#383).
            </p>
          )}
          {!isCompound && !tileSetResult.ok && <p style={{ color: "crimson" }}>{tileSetResult.message}</p>}
          {tileSetResult.ok && symmetry !== "none" && expandedTileSetResult.ok && (
            <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              Symmetry expansion: {tileSetResult.value.tiles.length} tile{tileSetResult.value.tiles.length === 1 ? "" : "s"} →{" "}
              {expandedTileSetResult.value.tiles.length} oriented variant{expandedTileSetResult.value.tiles.length === 1 ? "" : "s"} used for solving.
            </p>
          )}
          {expandedTileSetResult.ok &&
            expandedTileSetResult.value.tiles.length > 0 &&
            (() => {
              const total = expandedTileSetResult.value.tiles.length;
              const sustainable = pruneToSccSustainable(expandedTileSetResult.value).tiles.length;
              const unsustainable = total - sustainable;
              if (unsustainable === 0) return null;
              return (
                <p style={{ fontSize: "0.8rem", color: "var(--muted)" }} title="A tile is a dead end for an infinite/periodic tiling when it can be entered but never re-entered -- see #386. A finite grid can still legally use it once, e.g. at a boundary.">
                  Sustainability (#386): {unsustainable} of {total} tile{total === 1 ? "" : "s"} can never appear in an infinite/periodic tiling with this direction set.
                </p>
              );
            })()}
          {!isCompound && solveStatus === "error" && <p style={{ color: "crimson" }}>{solveError}</p>}
          {isCompound && compoundSolveStatus === "error" && <p style={{ color: "crimson" }}>{compoundSolveError}</p>}

          <canvas ref={canvasRef} width={canvasWidth} height={canvasHeight} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => canvasRef.current} label="tiles" />
          </div>

          {!isCompound && showAnimation && solver !== "sat" && solveSteps.length > 0 && (
            <>
              <TransportControls graph={graph} time={time} duration={duration} playing={playing} setPlaying={setPlaying} loop={loop} setLoop={setLoop} speed={speed} setSpeed={setSpeed} />
              {currentStep && (
                <p style={{ fontSize: "0.85rem", color: "var(--muted)" }} aria-live="polite">
                  {stepLabel(currentStep)}
                </p>
              )}
              {solver === "weighted" ? (
                <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Video export isn't available for the weighted-random solver yet -- the export scene only reruns plain/torus backtracking.</p>
              ) : (
                <VideoExportControls
                  filenameStem="mallory-graph-tiles"
                  start={(format, videoDuration) =>
                    startTilesExportJobFn({
                      data: {
                        tilesText,
                        width,
                        height,
                        symmetry,
                        solver: solver as "wang" | "torus",
                        duration: videoDuration,
                        format,
                      },
                    })
                  }
                />
              )}
            </>
          )}
          {isCompound && showAnimation && compoundSolveSteps.length > 0 && (
            <>
              <TransportControls graph={graph} time={time} duration={duration} playing={playing} setPlaying={setPlaying} loop={loop} setLoop={setLoop} speed={speed} setSpeed={setSpeed} />
              {compoundCurrentStep && (
                <p style={{ fontSize: "0.85rem", color: "var(--muted)" }} aria-live="polite">
                  {compoundStepLabel(compoundCurrentStep)}
                </p>
              )}
              <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Video export isn't available for multi-cell tile sets yet (#383).</p>
            </>
          )}

          {!isCompound && solveStatus === "solving" && <p>Solving…</p>}
          {!isCompound && solveStatus === "done" && (
            <p>
              {solveGrid
                ? `Tiling found${solver !== "sat" ? ` in ${solveSteps.length} search steps` : ""}.`
                : `No tiling exists for this tile set at ${width}x${height}${solver !== "sat" ? ` (search exhausted after ${solveSteps.length} steps)` : ""}.`}
            </p>
          )}
          {isCompound && compoundSolveStatus === "solving" && <p>Solving…</p>}
          {isCompound && compoundSolveStatus === "done" && (
            <p>{compoundSolveGrid ? `Tiling found in ${compoundSolveSteps.length} search steps.` : `No tiling exists for this tile set at ${width}x${height} (search exhausted after ${compoundSolveSteps.length} steps).`}</p>
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
              Patch census (issue #396) -- how many distinct patches of each size actually occur in the solved grid, the finite-size "language" entropy above is derived from as a growth-rate limit
            </label>
            {(() => {
              if (!solveGrid) return <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Solve for a tiling to see its patch census.</p>;
              try {
                const growth = patchCensusGrowth(solveGrid, 8);
                return (
                  <ul style={{ margin: "0.25rem 0", paddingLeft: "1.25rem", fontSize: "0.85rem" }}>
                    {growth.map((g) => (
                      <li key={g.size}>
                        {g.size}x{g.size}: {g.distinctPatches} distinct patch{g.distinctPatches === 1 ? "" : "es"}
                      </li>
                    ))}
                  </ul>
                );
              } catch (e) {
                return <p style={{ color: "crimson" }}>{e instanceof Error ? e.message : String(e)}</p>;
              }
            })()}
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
                  style={{ border: "1px solid var(--border)", maxWidth: "100%" }}
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
                  style={{ border: "1px solid var(--border)", maxWidth: "100%" }}
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
                    <canvas ref={relaxCanvasRef} width={relaxCanvasWidth} height={relaxCanvasHeight} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
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
                      style={{ border: "1px solid var(--border)", maxWidth: "100%" }}
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
          {hexTileSetResult.ok && (
            <div style={{ margin: "0.5rem 0" }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>Tile palette (each tile on its own, apart from the grid)</label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {hexTileSetResult.value.tiles.map((t) => (
                  <HexTilePaletteEntry key={t.id} tile={t} />
                ))}
              </div>
            </div>
          )}
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
          <canvas ref={hexCanvasRef} width={hexCanvasWidth} height={hexCanvasHeight} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
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
          {triTileSetResult.ok && (
            <div style={{ margin: "0.5rem 0" }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>Tile palette (each tile on its own, apart from the grid)</label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {triTileSetResult.value.tiles.map((t) => (
                  <TriTilePaletteEntry key={t.id} tile={t} />
                ))}
              </div>
            </div>
          )}
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
          <canvas ref={triCanvasRef} width={triCanvasWidth} height={triCanvasHeight} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
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
          {cubeTileSetResult.ok && <CubeTilePaletteView tiles={cubeTileSetResult.value.tiles} />}
          {cubeSolveStatus === "error" && <p style={{ color: "crimson" }}>{cubeSolveError}</p>}
          <CubeGridView grid={cubeSolveGrid} tileSet={cubeTileSetResult.ok ? cubeTileSetResult.value : null} />
          {cubeSolveStatus === "solving" && <p>Solving…</p>}
          {cubeSolveStatus === "done" && (
            <p>{cubeSolveGrid ? "Tiling found." : `No tiling exists for this tile set at ${width}x${height}x${depth} cells.`}</p>
          )}
        </>
      )}

      {lattice === "corner" && (
        <>
          <div style={{ margin: "0.25rem 0" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
              Tile set (one per line: <code>id NE SE SW NW</code> -- 4 corner labels, clockwise from northeast; see #388)
            </label>
            <textarea
              value={cornerTextInput}
              onChange={(e) => updateCornerText(e.target.value)}
              rows={5}
              style={{ font: "inherit", fontFamily: "monospace", width: "24ch" }}
            />
            <div>
              <button type="button" onClick={() => updateCornerText(DEFAULT_CORNER_TILES_TEXT)}>
                Reset to default set
              </button>
            </div>
          </div>
          {cornerTileSetResult.ok && (
            <div style={{ margin: "0.5rem 0" }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>Tile palette (each tile on its own, apart from the grid)</label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {cornerTileSetResult.value.tiles.map((t) => (
                  <CornerTilePaletteEntry key={t.id} tile={t} />
                ))}
              </div>
            </div>
          )}
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              width: <input type="number" min={1} value={width} onChange={(e) => graph.set(ids.width, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
            <label>
              height: <input type="number" min={1} value={height} onChange={(e) => graph.set(ids.height, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
          </div>
          {!cornerTileSetResult.ok && <p style={{ color: "crimson" }}>{cornerTileSetResult.message}</p>}
          {cornerSolveStatus === "error" && <p style={{ color: "crimson" }}>{cornerSolveError}</p>}
          <canvas ref={cornerCanvasRef} width={cornerCanvasWidth} height={cornerCanvasHeight} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => cornerCanvasRef.current} label="tiles-corner" />
          </div>
          {cornerSolveStatus === "solving" && <p>Solving…</p>}
          {cornerSolveStatus === "done" && <p>{cornerSolveGrid ? "Tiling found." : `No tiling exists for this tile set at ${width}x${height} cells.`}</p>}
        </>
      )}

      {lattice === "linear" && (
        <>
          <div style={{ margin: "0.25rem 0" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)" }}>
              Tile set (one per line: <code>id left right</code> -- 2 edge labels; see #397)
            </label>
            <textarea
              value={linearTextInput}
              onChange={(e) => updateLinearText(e.target.value)}
              rows={5}
              style={{ font: "inherit", fontFamily: "monospace", width: "24ch" }}
            />
            <div>
              <button type="button" onClick={() => updateLinearText(DEFAULT_LINEAR_TILES_TEXT)}>
                Reset to default set
              </button>
            </div>
          </div>
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              length: <input type="number" min={1} value={width} onChange={(e) => graph.set(ids.width, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "5ch" }} />
            </label>
            <label title="When checked, the row must also wrap: the last tile's right label must match the first tile's left label, so repeating the row end to end forms a genuinely periodic bi-infinite word.">
              <input type="checkbox" checked={linearPeriodic} onChange={(e) => graph.set(ids.linearPeriodic, e.target.checked)} /> periodic (wrap into a ring)
            </label>
          </div>
          {!linearTileSetResult.ok && <p style={{ color: "crimson" }}>{linearTileSetResult.message}</p>}
          {linearSolveStatus === "error" && <p style={{ color: "crimson" }}>{linearSolveError}</p>}
          <canvas ref={linearCanvasRef} width={linearCanvasWidth} height={linearCanvasHeight} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => linearCanvasRef.current} label="tiles-linear" />
          </div>
          {linearSolveStatus === "solving" && <p>Solving…</p>}
          {linearSolveStatus === "done" && (
            <p>{linearSolveGrid ? (linearPeriodic ? "Periodic tiling found." : "Tiling found.") : `No ${linearPeriodic ? "periodic " : ""}tiling exists for this tile set at length ${width}.`}</p>
          )}
          <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            <strong>Entropy</strong> (exact, not a strip-height approximation -- see "How this works" above):{" "}
            {linearEntropyResult
              ? `${linearEntropyResult.entropy.toFixed(4)} (dominant eigenvalue ${linearEntropyResult.dominantEigenvalue.toFixed(4)}, ${
                  linearEntropyResult.converged ? "converged" : "did not converge"
                } after ${linearEntropyResult.iterations} iterations)`
              : "no bi-infinite tiling exists for this tile set (no cycle in its tile-to-tile transfer relation)."}
          </p>
        </>
      )}
    </div>
  );
}
