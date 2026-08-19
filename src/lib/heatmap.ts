/**
 * Generic numeric-matrix heatmap rendering -- built for `Graph.toAdjacencyMatrix()`
 * (part of #24's remaining scope) but not graph-specific: any `number[][]`
 * where `Infinity` marks an absent/undefined cell (mallory-math's own
 * convention for "no edge" -- confirmed directly: `toAdjacencyMatrix()`
 * returns `Infinity`, not `0` or `NaN`, off the diagonal where there's no
 * edge) works.
 */

/** The finite-valued range of a matrix, ignoring `Infinity`/`-Infinity`/`NaN` cells -- those are "absent", not extreme values, and would otherwise blow out the color scale. `{ min: 0, max: 0 }` when there are no finite cells at all. */
export function finiteRange(matrix: readonly (readonly number[])[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const row of matrix) {
    for (const v of row) {
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min > max) return { min: 0, max: 0 };
  return { min, max };
}

/**
 * White-to-blue sequential scale for a finite value, or a flat neutral gray
 * for a non-finite ("absent") one -- kept visually distinct from the lowest
 * finite value rather than folded into the numeric scale, so "no edge"
 * never looks like "a zero-weight edge".
 */
export function heatCellColor(value: number, min: number, max: number): string {
  if (!Number.isFinite(value)) return "rgb(243, 244, 246)";
  if (max <= min) return "rgb(191, 219, 254)";
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const r = Math.round(255 + t * (29 - 255));
  const g = Math.round(255 + t * (78 - 255));
  const b = Math.round(255 + t * (216 - 255));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Draws a square-celled heatmap of `matrix` into `ctx`, with `labels`
 * (matching `Graph.toAdjacencyMatrix()`'s own `order`) as row/column axis
 * text and each finite cell's own value overlaid. Assumes a square matrix
 * (true for an adjacency matrix); a ragged/rectangular one just draws each
 * row at its own length, no padding.
 */
export function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  matrix: readonly (readonly number[])[],
  labels: readonly string[],
  width: number,
  height: number,
  labelGutter = 24,
): void {
  const n = matrix.length;
  if (n === 0) return;
  const { min, max } = finiteRange(matrix);
  const gridWidth = width - labelGutter;
  const gridHeight = height - labelGutter;
  const cellW = gridWidth / n;
  const cellH = gridHeight / n;

  ctx.save();
  ctx.translate(labelGutter, labelGutter);
  for (let row = 0; row < n; row++) {
    const rowValues = matrix[row] ?? [];
    for (let col = 0; col < n; col++) {
      const value = rowValues[col] ?? Infinity;
      ctx.fillStyle = heatCellColor(value, min, max);
      ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
      if (Number.isFinite(value)) {
        ctx.fillStyle = "#111827";
        ctx.font = `${Math.max(8, Math.min(12, cellH * 0.4))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(value), col * cellW + cellW / 2, row * cellH + cellH / 2);
      }
    }
  }
  ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cellW, 0);
    ctx.lineTo(i * cellW, gridHeight);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cellH);
    ctx.lineTo(gridWidth, i * cellH);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#374151";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  labels.forEach((label, i) => {
    ctx.fillText(label, labelGutter + i * cellW + cellW / 2, labelGutter / 2);
    ctx.fillText(label, labelGutter / 2, labelGutter + i * cellH + cellH / 2);
  });
  ctx.restore();
}

export interface HeatmapBlock {
  /** Inclusive start / exclusive end row-and-column range of this diagonal block, in the SAME permuted index space as the matrix passed to `drawHeatmap`. */
  start: number;
  end: number;
}

/**
 * Overlays a Frobenius normal form's diagonal-block structure (issue #297
 * item 4) on top of an already-drawn `drawHeatmap` -- same `ctx`/`width`/
 * `height`/`labelGutter` so the grid geometry lines up exactly. Two layers:
 * a translucent shade over every cell strictly below-and-left of the
 * diagonal blocks (the region `frobeniusNormalForm` guarantees is all
 * zero -- shaded so that claim is visually verifiable, not just asserted
 * in text), and a bold outline around each diagonal block itself.
 */
export function drawFrobeniusOverlay(ctx: CanvasRenderingContext2D, n: number, width: number, height: number, blocks: readonly HeatmapBlock[], labelGutter = 24): void {
  if (n === 0) return;
  const gridWidth = width - labelGutter;
  const gridHeight = height - labelGutter;
  const cellW = gridWidth / n;
  const cellH = gridHeight / n;

  ctx.save();
  ctx.translate(labelGutter, labelGutter);

  ctx.fillStyle = "rgba(22, 163, 74, 0.14)";
  for (let bi = 0; bi < blocks.length; bi++) {
    for (let bj = 0; bj < bi; bj++) {
      const row = blocks[bi]!;
      const col = blocks[bj]!;
      ctx.fillRect(col.start * cellW, row.start * cellH, (col.end - col.start) * cellW, (row.end - row.start) * cellH);
    }
  }

  ctx.strokeStyle = "#dc2626";
  ctx.lineWidth = 2;
  for (const b of blocks) {
    ctx.strokeRect(b.start * cellW, b.start * cellH, (b.end - b.start) * cellW, (b.end - b.start) * cellH);
  }
  ctx.restore();
}
