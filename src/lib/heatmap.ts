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
