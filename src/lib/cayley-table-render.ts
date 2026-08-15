import type { GroupInfo } from "./discrete-math.ts";
import { getThemeColors } from "./theme-colors.ts";

const IDENTITY_HIGHLIGHT = "#dcfce7";

/** The pixel size a canvas needs to be to render `info`'s Cayley table at `cellSize` px per cell -- (labels.length + 1) cells per side, the extra one for the header row/column. */
export function cayleyTableCanvasSize(info: GroupInfo, cellSize = 32): { width: number; height: number } {
  const side = (info.labels.length + 1) * cellSize;
  return { width: side, height: side };
}

/**
 * Draws `info`'s Cayley table onto `ctx`, matching `DiscretePanel.tsx`'s
 * own `<CayleyTable>` JSX rendering: a blank top-left corner, bold row/
 * column headers (the group's element labels), and body cells showing
 * `labels[table[i][j]]` with the identity element's cells highlighted --
 * the same visual structure, just rasterized for PNG export (issue #45
 * item 3), since an HTML `<table>` has no `PngExportButton`-compatible
 * `<canvas>` to hand off to `canvas.toBlob()`.
 */
export function drawCayleyTable(ctx: CanvasRenderingContext2D, info: GroupInfo, cellSize = 32): void {
  const theme = getThemeColors();
  const n = info.labels.length;
  const side = (n + 1) * cellSize;

  ctx.clearRect(0, 0, side, side);
  ctx.fillStyle = theme.surface;
  ctx.fillRect(0, 0, side, side);

  ctx.font = `${Math.round(cellSize * 0.4)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let row = 0; row <= n; row++) {
    for (let col = 0; col <= n; col++) {
      const x = col * cellSize;
      const y = row * cellSize;
      const isHeader = row === 0 || col === 0;
      const isCorner = row === 0 && col === 0;

      if (!isCorner && row >= 1 && col >= 1 && info.table[row - 1]?.[col - 1] === info.identityIndex) {
        ctx.fillStyle = IDENTITY_HIGHLIGHT;
        ctx.fillRect(x, y, cellSize, cellSize);
      }

      ctx.strokeStyle = theme.muted;
      ctx.strokeRect(x + 0.5, y + 0.5, cellSize, cellSize);

      if (isCorner) continue;
      const label = isHeader
        ? (info.labels[row === 0 ? col - 1 : row - 1] ?? "")
        : (info.labels[info.table[row - 1]?.[col - 1] ?? -1] ?? "");
      ctx.fillStyle = theme.ink;
      ctx.font = `${isHeader ? "600 " : ""}${Math.round(cellSize * 0.4)}px monospace`;
      ctx.fillText(label, x + cellSize / 2, y + cellSize / 2);
    }
  }
}
