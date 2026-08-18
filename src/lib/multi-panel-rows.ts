import type { CellGraph } from "./cell-graph.ts";

/**
 * Shared color palette for per-row curve/surface/field coloring across
 * every "unlimited expressions" panel (issue #251) -- the same six-color
 * cycle GraphCanvasMulti (the app's reference multi-expression
 * implementation) already uses, so a row's color stays visually consistent
 * with the app's other multi-expression panels regardless of which one
 * it's on.
 */
export const MULTI_PANEL_PALETTE = [0x2563eb, 0xdc2626, 0x16a34a, 0xd97706, 0x9333ea, 0x0891b2];

export function paletteColor(index: number): number {
  return MULTI_PANEL_PALETTE[index % MULTI_PANEL_PALETTE.length] as number;
}

/**
 * Appends a fresh row id to an ordered row-id list cell, returning the new
 * id and its index (for palette-color cycling) -- the list-management half
 * of every "unlimited expressions" panel's own addRow() (issue #251).
 * Mirrors GraphCanvasMulti's own addRow, generalized: this only manages the
 * *list*; each panel still seeds its own row-specific cells (expr, domain
 * bounds, color, visible, ...) right after calling this, since those cell
 * shapes differ panel to panel (a 2-variable relation vs. a 3-expression
 * parametric surface vs. ...).
 */
export function appendRow(graph: CellGraph, listCellId: string): { id: string; index: number } {
  const current = graph.get<string[]>(listCellId);
  const id = crypto.randomUUID();
  graph.set(listCellId, [...current, id]);
  return { id, index: current.length };
}

/**
 * Removes a row id from the ordered list FIRST -- so any subscribeAll/
 * subscribeMany listener firing synchronously on that write never observes
 * a list entry whose cells are already deleted, the same ordering
 * GraphCanvasMulti's own removeRow documents -- then deletes every one of
 * that row's own cells. `rowIds` is whatever a panel's own
 * `cellIdsXxx(rowId)` factory returned: a plain string-valued id bag,
 * deleted by value the same way GraphCanvasMulti/NotebookGraphBlock already
 * do (a `param`/`track`-style function field is skipped, same as those two
 * -- there's nothing to enumerate without also tracking which parameter
 * names exist, which callers with per-variable params already do
 * themselves before calling this).
 */
export function removeRow(graph: CellGraph, listCellId: string, rowId: string, rowIds: Record<string, unknown>): void {
  graph.set(
    listCellId,
    graph.get<string[]>(listCellId).filter((id) => id !== rowId),
  );
  for (const cellId of Object.values(rowIds)) {
    if (typeof cellId === "string") graph.delete(cellId);
  }
}
