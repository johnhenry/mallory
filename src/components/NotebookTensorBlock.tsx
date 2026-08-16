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
  parseSplitSections,
  parseTensorGrid,
  splitTensorGrid,
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
  splitEnabled: boolean;
  splitAxis: 0 | 1;
  splitSections: string;
  onSourceChange: (source: string) => void;
  onSourceModeChange: (mode: TensorSourceMode) => void;
  onCurveNameChange: (curveName: string) => void;
  onOpChange: (op: TensorOpType) => void;
  onOpArgChange: (opArg: number) => void;
  onSplitEnabledChange: (enabled: boolean) => void;
  onSplitAxisChange: (axis: 0 | 1) => void;
  onSplitSectionsChange: (sections: string) => void;
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
 * "split into multiple tensors" (issue #35's last remaining scope item)
 * is a sibling mode, not another op: checking it hides the op/opArg
 * controls and swaps in an axis picker + sections input, and the single
 * table becomes one table per part from `splitTensorGrid`.
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
  splitEnabled,
  splitAxis,
  splitSections,
  onSourceChange,
  onSourceModeChange,
  onCurveNameChange,
  onOpChange,
  onOpArgChange,
  onSplitEnabledChange,
  onSplitAxisChange,
  onSplitSectionsChange,
}: NotebookTensorBlockProps) {
  const curveCellId = notebookCurveCellId(curveName);
  const curvePath = useCell<Path2D | undefined>(graph, curveCellId);

  const sourceGrid = useMemo<Result<number[][]>>(() => {
    try {
      if (sourceMode === "curve") {
        if (!curveName) throw new Error("Enter a curve name to reference (name a graph row to publish one).");
        if (!graph.hasValue(curveCellId) || curvePath === undefined) throw new Error(`No curve named "${curveName}" is published yet.`);
        return { ok: true, value: curveToTensorGrid(curvePath) };
      }
      return { ok: true, value: parseTensorGrid(source) };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }, [source, sourceMode, curveName, curvePath, graph, curveCellId]);

  const view = useMemo<Result<TensorView>>(() => {
    if (!sourceGrid.ok) return sourceGrid;
    try {
      const result = applyTensorOp(sourceGrid.value, op, opArg);
      return { ok: true, value: { result, summary: summarizeTensor(result) } };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }, [sourceGrid, op, opArg]);

  /**
   * "split" mode's own render path (issue #35's last remaining scope):
   * `Tensor.split()` returns MULTIPLE grids, a genuinely different shape
   * from every other op's single-grid-in-single-grid-out result, so it
   * gets its own computed value and its own render branch below rather
   * than being folded into `view` above.
   */
  const splitView = useMemo<Result<TensorView[]>>(() => {
    if (!sourceGrid.ok) return sourceGrid;
    try {
      const sections = parseSplitSections(splitSections);
      const parts = splitTensorGrid(sourceGrid.value, sections, splitAxis);
      return { ok: true, value: parts.map((result) => ({ result, summary: summarizeTensor(result) })) };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }, [sourceGrid, splitSections, splitAxis]);

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
          <input type="checkbox" checked={splitEnabled} onChange={(e) => onSplitEnabledChange(e.target.checked)} /> split into multiple tensors
        </label>
        {splitEnabled ? (
          <>
            <label style={{ fontSize: "0.9rem" }}>
              axis:{" "}
              <select value={splitAxis} onChange={(e) => onSplitAxisChange(Number(e.target.value) as 0 | 1)}>
                <option value={0}>rows</option>
                <option value={1}>columns</option>
              </select>
            </label>
            <label style={{ fontSize: "0.9rem" }} title='A bare integer ("2") splits into that many equal parts; comma-separated integers ("1,3") are explicit cut-point indices.'>
              sections:{" "}
              <input
                value={splitSections}
                onChange={(e) => onSplitSectionsChange(e.target.value)}
                placeholder="e.g. 2 or 1,3"
                style={{ font: "inherit", width: "8ch" }}
              />
            </label>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
      {splitEnabled ? (
        splitView.ok ? (
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-start" }}>
            {splitView.value.map((part, i) => (
              <TensorTable key={i} view={part} />
            ))}
          </div>
        ) : (
          <p style={{ color: "var(--danger)", fontSize: "0.9rem", margin: "0.25rem 0" }}>{splitView.message}</p>
        )
      ) : view.ok ? (
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
