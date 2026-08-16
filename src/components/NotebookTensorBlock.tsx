import type { Path2D } from "mallory-math";
import { useMemo } from "react";
import type { CellGraph } from "../lib/cell-graph.ts";
import { notebookCurveCellId } from "../lib/cell-ids.ts";
import { finiteRange, heatCellColor } from "../lib/heatmap.ts";
import {
  TENSOR_OPS_WITH_ARG,
  TENSOR_OP_LABELS,
  applyTensorOp,
  curveToTensorGrid,
  parseTensorGrid,
  summarizeTensor,
  type TensorOpType,
  type TensorSummary,
} from "../lib/tensor-block.ts";
import { useCell } from "../lib/use-cell.ts";

interface TensorView {
  result: number[][];
  summary: TensorSummary;
}

type Result<T> = { ok: true; value: T } | { ok: false; message: string };
export type TensorSourceMode = "literal" | "curve";

export interface NotebookTensorBlockProps {
  graph: CellGraph;
  source: string;
  sourceMode: TensorSourceMode;
  curveName: string;
  op: TensorOpType;
  opArg: number;
  onSourceChange: (source: string) => void;
  onSourceModeChange: (mode: TensorSourceMode) => void;
  onCurveNameChange: (curveName: string) => void;
  onOpChange: (op: TensorOpType) => void;
  onOpArgChange: (opArg: number) => void;
}

/**
 * A small-tensor notebook block (issue #35 item 1): either a hand-typed
 * literal grid, or (issue #35's remaining scope, "a tensor block built
 * from a curve's samples") a named published curve converted via
 * `curveToTensorGrid` -- one tensor-core op applied for display either
 * way, rendered as a table with heatmap-colored cells (reusing
 * heatmap.ts's shared color scale -- an HTML table rather than
 * `drawHeatmap`'s canvas, since a hand-typed <=16x16 grid reads better as
 * selectable text than as pixels).
 *
 * The literal-grid text/op/opArg still live entirely in the block's own
 * serialized state (see NotebookPanel's Block union) with no CellGraph
 * cells of their own. Curve mode is the one exception: it reads
 * `notebookCurveCellId(curveName)` reactively via `useCell` (the same
 * `get()`-before-`hasValue()` idiom `NotebookCurveTransformBlock` already
 * uses) so the tensor stays live as the referenced curve resamples --
 * `useCell` is called unconditionally on every render (not just in curve
 * mode) since React hooks can't be called conditionally; reading an
 * always-undefined cell in literal mode is harmless.
 */
export function NotebookTensorBlock({
  graph,
  source,
  sourceMode,
  curveName,
  op,
  opArg,
  onSourceChange,
  onSourceModeChange,
  onCurveNameChange,
  onOpChange,
  onOpArgChange,
}: NotebookTensorBlockProps) {
  const curveCellId = notebookCurveCellId(curveName);
  const curvePath = useCell<Path2D | undefined>(graph, curveCellId);

  const view = useMemo<Result<TensorView>>(() => {
    try {
      let grid: number[][];
      if (sourceMode === "curve") {
        if (!curveName) throw new Error("Enter a curve name to reference (name a graph row to publish one).");
        if (!graph.hasValue(curveCellId) || curvePath === undefined) throw new Error(`No curve named "${curveName}" is published yet.`);
        grid = curveToTensorGrid(curvePath);
      } else {
        grid = parseTensorGrid(source);
      }
      const result = applyTensorOp(grid, op, opArg);
      return { ok: true, value: { result, summary: summarizeTensor(result) } };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }, [source, sourceMode, curveName, curvePath, graph, curveCellId, op, opArg]);

  return (
    <div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <label style={{ fontSize: "0.9rem" }}>
          source:{" "}
          <select value={sourceMode} onChange={(e) => onSourceModeChange(e.target.value as TensorSourceMode)}>
            <option value="literal">literal grid</option>
            <option value="curve">from a curve</option>
          </select>
        </label>
        {sourceMode === "literal" ? (
          <label style={{ fontSize: "0.9rem" }}>
            tensor{" "}
            <textarea
              value={source}
              onChange={(e) => onSourceChange(e.target.value)}
              rows={4}
              style={{ font: "inherit", fontFamily: "monospace", width: "24ch", verticalAlign: "top" }}
            />
          </label>
        ) : (
          <label style={{ fontSize: "0.9rem" }}>
            curve:{" "}
            <input
              value={curveName}
              onChange={(e) => onCurveNameChange(e.target.value)}
              placeholder="e.g. f"
              style={{ font: "inherit", width: "10ch" }}
            />
          </label>
        )}
        <label style={{ fontSize: "0.9rem" }}>
          op:{" "}
          <select value={op} onChange={(e) => onOpChange(e.target.value as TensorOpType)}>
            {(Object.keys(TENSOR_OP_LABELS) as TensorOpType[]).map((key) => (
              <option key={key} value={key}>
                {TENSOR_OP_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        {TENSOR_OPS_WITH_ARG.has(op) && (
          <label style={{ fontSize: "0.9rem" }} title={op === "pad" ? "Border width added on all four sides" : "How many times each row repeats"}>
            {op === "pad" ? "width" : "count"}:{" "}
            <input
              type="number"
              min={op === "pad" ? 0 : 1}
              step={1}
              value={opArg}
              onChange={(e) => onOpArgChange(Number(e.target.value))}
              style={{ font: "inherit", width: "5ch" }}
            />
          </label>
        )}
      </div>
      {view.ok ? (
        <TensorTable view={view.value} />
      ) : (
        <p style={{ color: "var(--danger)", fontSize: "0.9rem", margin: "0.25rem 0" }}>{view.message}</p>
      )}
    </div>
  );
}

function TensorTable({ view }: { view: TensorView }) {
  const { min, max } = finiteRange(view.result);
  const { rows, cols, mean, sum } = view.summary;
  return (
    <div style={{ margin: "0.25rem 0" }}>
      <table style={{ borderCollapse: "collapse", fontFamily: "monospace", fontSize: "0.85rem" }}>
        <tbody>
          {view.result.map((row, r) => (
            <tr key={r}>
              {row.map((value, c) => (
                <td
                  key={c}
                  style={{
                    border: "1px solid var(--border)",
                    padding: "0.2rem 0.5rem",
                    textAlign: "right",
                    background: heatCellColor(value, min, max),
                    color: "#111827",
                  }}
                >
                  {Number.isFinite(value) ? Number(value.toPrecision(6)) : "NaN"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        {rows}×{cols} · min {Number.isFinite(view.summary.min) ? Number(view.summary.min.toPrecision(6)) : "NaN"} · max{" "}
        {Number.isFinite(view.summary.max) ? Number(view.summary.max.toPrecision(6)) : "NaN"} · mean{" "}
        {Number.isFinite(mean) ? Number(mean.toPrecision(6)) : "NaN"} · sum {Number.isFinite(sum) ? Number(sum.toPrecision(6)) : "NaN"}
      </p>
    </div>
  );
}
