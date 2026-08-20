/**
 * Statically-importable ecmanim scenes for CellularAutomataPanel's video
 * export (`export-ca-video.ts`) -- johnhenry/mallory-graph#337. Two exports,
 * one per animated sub-mode (the 1D mode has no `TransportControls` at all
 * -- see the panel's own doc comment -- so it has nothing to export):
 *
 * - `construct2d`: a bare top-level `construct(scene, params)` function for
 *   the 2D life-like grid, matching `ode-scene.ts`'s shape.
 * - `CaVoxelExportScene`: a `ThreeDScene` subclass for the 3D totalistic
 *   voxel grid, matching `surface-scene.ts`'s shape (a plain `Scene` has no
 *   camera/depth-sorting machinery for 3D).
 *
 * Both must be top-level exports (not closures) and deterministic given
 * `params` -- `renderParallel`'s worker_threads re-`import()` the scene by
 * file path + export name, and its per-segment partial cache requires
 * `construct()` to produce the same output for the same params every time.
 * Both recompute the simulation from scratch inside the scene via the exact
 * same functions the on-page panel calls (`spacetimeLifeLike`,
 * `spacetimeTotalistic3D`) rather than accepting a precomputed spacetime
 * array as a param, so the rendered video is provably the same simulation
 * the panel showed, not a re-implementation -- same reasoning as
 * `expression-2d-scene.ts` recomputing its root crossings from `params`
 * instead of accepting them pre-computed.
 *
 * Rather than reparametrize by the panel's own `STEP_SECONDS` (which would
 * either truncate the generation history for a short chosen export duration
 * or hold on the final generation for a long one), both scenes spread the
 * FULL generation history evenly across whatever `duration` the caller
 * picks -- the same "reparametrize the whole path across duration"
 * approach `ode-scene.ts` uses for its trajectory, so the exported clip
 * always shows every generation regardless of the chosen duration.
 */
import { Box, Square, ThreeDCamera, ThreeDScene, VGroup } from "ecmanim/node";
import { Rng } from "mallory-tensor-core";
import { SQUARE_HALF_SPAN } from "../export-render.ts";
import { initialGrid, parseBSRule, spacetimeLifeLike, type Boundary as Boundary2D, type InitialCondition as InitialCondition2D } from "../ca/life-like.ts";
import { parseTotalisticRule3D, randomGrid3D, spacetimeTotalistic3D, type Boundary as Boundary3D } from "../ca/totalistic-3d.ts";

const ALIVE_COLOR = "#1c2531"; // matches theme-colors.ts's FALLBACK.ink -- the on-page canvas's alive-cell fill.
/** Small gap between cells so the grid reads as discrete squares, not a solid block -- same spirit as the on-page canvas's 1px-per-cell fillRect grid. */
const CELL_FILL_RATIO = 0.92;
/** Matches Voxel3DFrameView's own 0.9-sideLength/1.1-spacing cube-to-gap ratio. */
const CUBE_FILL_RATIO = 0.9 / 1.1;

export interface Ca2dSceneParams {
  bsRule: string;
  width: number;
  height: number;
  boundary: Boundary2D;
  initial: InitialCondition2D;
  seed: number;
  density: number;
  customGrid?: string;
  generations: number;
  duration: number;
}

export async function construct2d(scene: any, data: Ca2dSceneParams): Promise<void> {
  const rule = parseBSRule(data.bsRule);
  const rng = data.initial === "random" ? new Rng(data.seed) : undefined;
  const initial = initialGrid(data.width, data.height, data.initial, rng, data.density, data.customGrid);
  const spacetime = spacetimeLifeLike(initial, rule, data.generations, data.boundary);

  const cellSpan = (2 * SQUARE_HALF_SPAN) / Math.max(data.width, data.height);
  const group = new VGroup();
  const squares: Square[][] = [];
  for (let row = 0; row < data.height; row++) {
    const rowSquares: Square[] = [];
    for (let col = 0; col < data.width; col++) {
      const square = new Square({
        sideLength: cellSpan * CELL_FILL_RATIO,
        fillColor: ALIVE_COLOR,
        fillOpacity: 0,
        strokeWidth: 0,
      });
      // +y is up in scene space; row 0 is the top of the on-page canvas.
      square.moveTo([(col - (data.width - 1) / 2) * cellSpan, ((data.height - 1) / 2 - row) * cellSpan, 0]);
      group.add(square);
      rowSquares.push(square);
    }
    squares.push(rowSquares);
  }
  scene.add(group);

  let elapsed = 0;
  let lastGen = -1;
  group.addUpdater(
    (_m: unknown, dt: number) => {
      elapsed += dt;
      const gen = Math.min(spacetime.length - 1, Math.floor((elapsed / data.duration) * spacetime.length));
      if (gen === lastGen) return;
      lastGen = gen;
      const frame = spacetime[gen]!;
      for (let row = 0; row < data.height; row++) {
        for (let col = 0; col < data.width; col++) {
          squares[row]![col]!.setOpacity(frame[row]![col] === 1 ? 1 : 0);
        }
      }
    },
    { hashExtra: () => String(elapsed) },
  );

  await scene.wait(data.duration);
}

export interface Ca3dSceneParams {
  rule: string;
  width: number;
  height: number;
  depth: number;
  boundary: Boundary3D;
  seed: number;
  density: number;
  generations: number;
  duration: number;
}

/** hue sweeps across the Z axis, matching the on-page Voxel3DFrameView's own `layerColor3D`. */
function layerColor(z: number, depth: number): string {
  const hue = depth <= 1 ? 0 : (z / (depth - 1)) * 260;
  return `hsl(${hue}, 65%, 55%)`;
}

export class CaVoxelExportScene extends ThreeDScene {
  constructor(config: any = {}) {
    super(config);
    this.camera = new ThreeDCamera({
      phi: (65 * Math.PI) / 180,
      theta: (-45 * Math.PI) / 180,
      zoom: 0.75,
      background: "#ffffff",
    });
  }

  override async construct(): Promise<void> {
    const data = this.params as Ca3dSceneParams;
    const rule = parseTotalisticRule3D(data.rule);
    const initial = randomGrid3D(data.width, data.height, data.depth, new Rng(data.seed), data.density);
    const spacetime = spacetimeTotalistic3D(initial, rule, data.generations, data.boundary);

    const cellSpan = (2 * SQUARE_HALF_SPAN) / Math.max(data.width, data.height, data.depth);
    const cubeSize = cellSpan * CUBE_FILL_RATIO;

    this.enableDepthSorting(true);
    const group = new VGroup();
    // cubes[z][y][x], matching totalistic-3d.ts's own Grid3D indexing.
    const cubes: Box[][][] = [];
    for (let z = 0; z < data.depth; z++) {
      const yLayer: Box[][] = [];
      for (let y = 0; y < data.height; y++) {
        const xRow: Box[] = [];
        for (let x = 0; x < data.width; x++) {
          const cube = new Box({
            dimensions: [cubeSize, cubeSize, cubeSize],
            fillColor: layerColor(z, data.depth),
            fillOpacity: 0,
            point: [(x - (data.width - 1) / 2) * cellSpan, (y - (data.height - 1) / 2) * cellSpan, (z - (data.depth - 1) / 2) * cellSpan],
          });
          group.add(cube);
          xRow.push(cube);
        }
        yLayer.push(xRow);
      }
      cubes.push(yLayer);
    }
    this.add(group);

    let elapsed = 0;
    let lastGen = -1;
    group.addUpdater(
      (_m: unknown, dt: number) => {
        elapsed += dt;
        const gen = Math.min(spacetime.length - 1, Math.floor((elapsed / data.duration) * spacetime.length));
        if (gen === lastGen) return;
        lastGen = gen;
        const frame = spacetime[gen]!;
        for (let z = 0; z < data.depth; z++) {
          for (let y = 0; y < data.height; y++) {
            for (let x = 0; x < data.width; x++) {
              cubes[z]![y]![x]!.setOpacity(frame[z]![y]![x] === 1 ? 1 : 0);
            }
          }
        }
      },
      { hashExtra: () => String(elapsed) },
    );

    // One full orbit over the clip, same as surface-scene.ts, so the voxel
    // structure reads as 3D instead of a flat silhouette from a static angle.
    this.beginAmbientCameraRotation({ rate: (2 * Math.PI) / data.duration });
    await this.wait(data.duration);
    this.stopAmbientCameraRotation();
  }
}
