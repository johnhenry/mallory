import type { Path2D } from "mallory-math";
import { useEffect, useRef } from "react";
import type { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsMultiRow, cellIdsNotebookBlock, notebookCurveCellId } from "../lib/cell-ids.ts";
import { drawAxes, drawExpressionLayer, drawPath, type Viewport } from "../lib/render-path.ts";
import { pathsToSvgDocument } from "../lib/svg-export.ts";
import { useCell } from "../lib/use-cell.ts";
import { ExpressionRow } from "./ExpressionRow.tsx";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

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
 * Every currently-visible row's `Path2D`, in row order -- shared by the SVG
 * export getter and (indirectly, via the same `graph.get` calls) the
 * Canvas2D draw effect, so the two can't drift. `hasValue` (not a try/catch)
 * gates a row whose `path` cell hasn't registered yet -- `get()` on an
 * unregistered cell auto-creates a placeholder and returns `undefined`
 * rather than throwing (see cell-graph.ts's own `ensure()`), so a plain
 * truthiness/try check would silently push `undefined` into the result.
 * Derivative overlays aren't included -- `pathsToSvgDocument` has no
 * dashed-stroke support yet, unlike `drawPath`'s own `dashed` param.
 */
export function visiblePaths(graph: CellGraph, blockIds: ReturnType<typeof cellIdsNotebookBlock>): Path2D[] {
  const paths: Path2D[] = [];
  for (const id of graph.get<string[]>(blockIds.expressionList)) {
    const ids = cellIdsMultiRow(id);
    if (graph.hasValue(ids.path) && graph.get<boolean>(ids.visible)) paths.push(graph.get<Path2D>(ids.path));
  }
  return paths;
}

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

  // subscribeMany (not subscribeAll, issue #235) over blockIds.viewport plus
  // exactly this block's own rows' path/visible/derivativePath cells --
  // NotebookPanel puts every block on ONE shared CellGraph (see this
  // component's own doc comment), so a subscribeAll here used to redraw
  // this block on every write to ANY other block in the same document too:
  // a slider drag in a value block, an RAF-driven TIME_CELL tick from a
  // different graph block's animation, a per-epoch metric from an ML
  // block, none of which this block's own canvas depends on. `rowIds` is
  // already tracked reactively above (`useCell(graph, blockIds.expressionList)`),
  // so the subscribed id list is rebuilt (and re-subscribed) whenever rows
  // are added/removed/reordered, same as `redraw` itself already re-reads
  // the row list fresh from the graph each call.
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
    const watchedIds = [blockIds.viewport, ...rowIds.flatMap((id) => [cellIdsMultiRow(id).path, cellIdsMultiRow(id).visible, cellIdsMultiRow(id).derivativePath])];
    return graph.subscribeMany(watchedIds, redraw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, blockIds.viewport, blockIds.expressionList, rowIds]);

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
          <PngExportButton getCanvas={() => canvasRef.current} label="notebook-graph" />{" "}
          <SvgExportButton
            getSvg={() => {
              const paths = visiblePaths(graph, blockIds);
              if (paths.length === 0) return null;
              return pathsToSvgDocument(paths, graph.get<Viewport>(blockIds.viewport), WIDTH, HEIGHT);
            }}
            label="notebook-graph"
          />
        </div>
      </div>
    </div>
  );
}
