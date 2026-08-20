/**
 * Statically-importable ecmanim scene for StreamingDatasetPanel's Demo A
 * ("watch epochs reshuffle") video export (`export-streaming-video.ts`) --
 * johnhenry/mallory-graph#337. A bare top-level `construct(scene, params)`
 * function, matching `ode-scene.ts`'s shape (this is a flat 2D row of
 * squares, no camera/depth-sorting needed -- so no `ThreeDScene` subclass
 * like `ca-scene.ts`'s `CaVoxelExportScene`).
 *
 * Like `ca-scene.ts`'s `construct2d`, this recomputes the simulation from
 * scratch inside the scene via the exact same function the on-page panel
 * calls (`runShuffleEpochsDemo`) rather than accepting the precomputed
 * per-epoch arrays as a param -- `renderParallel`'s worker_threads
 * re-`import()` the scene by file path + export name, and the render has to
 * be provably the same simulation the page showed, not a re-implementation.
 *
 * Rather than reparametrize by the panel's own on-page step timing (a fixed
 * 700ms per epoch via `setInterval`), this spreads the FULL epoch history
 * evenly across whatever `duration` the caller picks -- the same
 * "reparametrize the whole history across duration" approach `ca-scene.ts`
 * uses for its generation history, so the exported clip always shows every
 * epoch regardless of the chosen duration.
 *
 * Unlike `ca-scene.ts`'s squares (fixed grid position, toggled opacity),
 * these squares stay fully opaque and instead ANIMATE POSITION: one square
 * per original dataset index, colored by `swatchColor(originalIndex)` (the
 * same small fixed palette `StreamingDatasetPanel.tsx` uses -- duplicated
 * here rather than imported since it lives in a component file this
 * server-only scene module can't pull in). At each epoch boundary the
 * squares snap directly to that epoch's row order -- matching the on-page
 * Play button's own instant-jump behavior exactly (moving to the next
 * epoch's swatch row with no intermediate tween) -- rather than tweening
 * smoothly between epochs, which would be a nicer-looking but separate
 * animation this scene isn't trying to invent.
 */
import { Square, VGroup } from "ecmanim/node";
import { runShuffleEpochsDemo } from "../streaming-dataset-demo.ts";
import { SQUARE_HALF_SPAN } from "../export-render.ts";

// Matches StreamingDatasetPanel.tsx's own SWATCH_COLORS/swatchColor exactly.
const SWATCH_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d", "#4f46e5", "#ea580c"];
function swatchColor(originalIndex: number): string {
  return SWATCH_COLORS[originalIndex % SWATCH_COLORS.length]!;
}

/** Small gap between squares so the row reads as discrete swatches, not a solid block -- same spirit as ca-scene.ts's own CELL_FILL_RATIO. */
const SQUARE_FILL_RATIO = 0.85;

export interface SceneParams {
  size: number;
  epochCount: number;
  seed: number;
  bufferSize?: number;
  duration: number;
}

export async function construct(scene: any, data: SceneParams): Promise<void> {
  const epochs = await runShuffleEpochsDemo(data.size, data.epochCount, data.seed, data.bufferSize);

  // positionOf[epochIdx][originalIndex] = that item's slot (x-position index) within that epoch's row.
  const positionOf: number[][] = epochs.map((epoch) => {
    const positions = new Array<number>(data.size);
    epoch.forEach((originalIndex, slot) => {
      positions[originalIndex] = slot;
    });
    return positions;
  });

  const cellSpan = (2 * SQUARE_HALF_SPAN) / data.size;
  const squareSize = cellSpan * SQUARE_FILL_RATIO;
  const group = new VGroup();
  const squares: Square[] = [];
  for (let originalIndex = 0; originalIndex < data.size; originalIndex++) {
    const square = new Square({
      sideLength: squareSize,
      fillColor: swatchColor(originalIndex),
      fillOpacity: 1,
      strokeWidth: 0,
    });
    const initialSlot = positionOf[0]![originalIndex]!;
    square.moveTo([(initialSlot - (data.size - 1) / 2) * cellSpan, 0, 0]);
    group.add(square);
    squares.push(square);
  }
  scene.add(group);

  let elapsed = 0;
  let lastEpoch = -1;
  group.addUpdater(
    (_m: unknown, dt: number) => {
      elapsed += dt;
      const epochIdx = Math.min(epochs.length - 1, Math.floor((elapsed / data.duration) * epochs.length));
      if (epochIdx === lastEpoch) return;
      lastEpoch = epochIdx;
      const positions = positionOf[epochIdx]!;
      for (let originalIndex = 0; originalIndex < data.size; originalIndex++) {
        const slot = positions[originalIndex]!;
        squares[originalIndex]!.moveTo([(slot - (data.size - 1) / 2) * cellSpan, 0, 0]);
      }
    },
    { hashExtra: () => String(elapsed) },
  );

  await scene.wait(data.duration);
}
