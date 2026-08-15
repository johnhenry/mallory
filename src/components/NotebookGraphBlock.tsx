import type { Path2D } from "mallory-math";
import { useEffect, useRef } from "react";
import type { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsMultiRow, cellIdsNotebookBlock, notebookCurveCellId } from "../lib/cell-ids.ts";
import { drawAxes, drawExpressionLayer, drawPath, type Viewport } from "../lib/render-path.ts";
import { useCell } from "../lib/use-cell.ts";
import { ExpressionRow } from "./ExpressionRow.tsx";
import { PngExportButton } from "./PngExportButton.tsx";

/** A row's optional publish-name (issue #35 item 2) -- a plain controlled input against `ids.curveName`, since renaming is infrequent (unlike `expr`'s per-keystroke parse cost, nothing here justifies ExpressionRow's local-state-mirror pattern). */
function CurveNameInput({ graph, rowId, onRename }: { graph: CellGraph; rowId: string; onRename: (name: string) => void }) {
  const ids = cellIdsMultiRow(rowId);
  const name = useCell<string>(graph, ids.curveName);
  return (
    <label style={{ fontSize: "0.8rem", marginLeft: "0.5rem" }}>
      name:{" "}
      <input
        value={name}
        onChange={(e) => onRename(e.target.value)}
        placeholder="(unpublished)"
        style={{ font: "inherit", width: "10ch" }}
        title="Publish this row's curve under a name so a curve-transform block can reference it"
      />
    </label>
  );
}

const WIDTH = 400;
const HEIGHT = 400;
const DEFAULT_VIEWPORT: Viewport = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };
const PALETTE = [0x2563eb, 0xdc2626, 0x16a34a];

/**
 * A graph cell for the notebook surface (NotebookPanel.tsx): its own
 * namespaced viewport/expression-list cells (see `cellIdsNotebookBlock`),
 * but on the ONE `CellGraph` shared across every block in the document --
 * not a private instance -- which is what lets a later block's expression
 * reference an earlier "value" block's named cell (see NotebookPanel's own
 * doc comment for the cross-reference mechanism). Reuses
 * ExpressionRow/drawExpressionLayer directly, the same reactive core as
 * everywhere else in the app.
 *
 * NON-GOALS (v1): no URL persistence, fork, save, or annotations for an
 * individual block (a notebook *document* could still be saved as a whole
 * -- see NotebookPanel's own doc comment). A row can also be given a name
 * (see `CurveNameInput` above) to publish its whole curve for cross-block
 * reference (issue #35 item 2) -- see `notebookCurveCellId`'s doc comment.
 */
export function NotebookGraphBlock({
  graph,
  blockId,
  initialSource = "x",
}: {
  graph: CellGraph;
  blockId: string;
  initialSource?: string;
}) {
  const blockIds = cellIdsNotebookBlock(blockId);
  const initRef = useRef(false);
  if (!initRef.current) {
    initRef.current = true;
    if (!graph.hasValue(blockIds.expressionList)) {
      graph.set(blockIds.viewport, DEFAULT_VIEWPORT, { auxiliary: true });
      const id = crypto.randomUUID();
      const ids = cellIdsMultiRow(id);
      graph.set(ids.expr, initialSource);
      graph.set(ids.color, PALETTE[0] as number);
      graph.set(ids.visible, true);
      graph.set(ids.curveName, "", { auxiliary: true });
      graph.set(blockIds.expressionList, [id], { auxiliary: true });
    }
  }
  const rowIds = useCell<string[]>(graph, blockIds.expressionList);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  function addRow() {
    const current = graph.get<string[]>(blockIds.expressionList);
    const id = crypto.randomUUID();
    const ids = cellIdsMultiRow(id);
    graph.set(ids.expr, "x");
    graph.set(ids.color, PALETTE[current.length % PALETTE.length] as number);
    graph.set(ids.visible, true);
    graph.set(ids.curveName, "", { auxiliary: true });
    graph.set(blockIds.expressionList, [...current, id]);
  }

  /**
   * Publishes/renames/un-publishes a row's curve under a user-given name
   * (issue #35 item 2) -- mirrors NotebookPanel's `updateValueName`, but for
   * a whole curve rather than a scalar: `graph.define()` (not `set()`) so
   * the published cell stays a live passthrough to `ids.path`, tracking
   * viewport-driven resampling instead of freezing a snapshot. No
   * "still used elsewhere" cross-check on the old name (unlike
   * `updateValueName`) -- matches this component's/NotebookPanel's own
   * established orphan-tolerance convention for per-row cleanup.
   */
  function renameCurve(rowId: string, name: string) {
    const ids = cellIdsMultiRow(rowId);
    const oldName = graph.hasValue(ids.curveName) ? graph.get<string>(ids.curveName) : "";
    if (oldName && oldName !== name) graph.delete(notebookCurveCellId(oldName));
    graph.set(ids.curveName, name, { auxiliary: true });
    if (name) graph.define(notebookCurveCellId(name), () => graph.get<Path2D>(ids.path), { auxiliary: true });
  }

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    function redraw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      const viewport = graph.get<Viewport>(blockIds.viewport);
      drawAxes(ctx, viewport, WIDTH, HEIGHT);
      for (const id of graph.get<string[]>(blockIds.expressionList)) {
        const ids = cellIdsMultiRow(id);
        try {
          const path = graph.get<Path2D>(ids.path);
          const visible = graph.get<boolean>(ids.visible);
          drawExpressionLayer(ctx, path, visible, viewport, WIDTH, HEIGHT);
          if (visible) {
            const derivativePath = graph.get<Path2D | null>(ids.derivativePath);
            if (derivativePath) drawPath(ctx, derivativePath, viewport, WIDTH, HEIGHT, true);
          }
        } catch {
          // A row whose cells haven't registered yet -- skip this frame.
        }
      }
    }
    redraw();
    return graph.subscribeAll(redraw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, blockIds.viewport, blockIds.expressionList]);

  return (
    <div>
      {rowIds.map((id) => (
        <div key={id}>
          <ExpressionRow graph={graph} rowId={id} viewportCellId={blockIds.viewport} />
          <CurveNameInput graph={graph} rowId={id} onRename={(name) => renameCurve(id, name)} />
        </div>
      ))}
      <button type="button" onClick={addRow} style={{ fontSize: "0.8rem" }}>
        + Add expression
      </button>
      <div>
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
        <div style={{ margin: "0.25rem 0" }}>
          <PngExportButton getCanvas={() => canvasRef.current} label="notebook-graph" />
        </div>
      </div>
    </div>
  );
}
