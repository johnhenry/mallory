import { useMemo } from "react";
import { finiteRange, heatCellColor } from "../lib/heatmap.ts";
import {
  TENSOR_OP_LABELS,
  applyTensorOp,
  parseTensorGrid,
  summarizeTensor,
  type TensorOpType,
  type TensorSummary,
} from "../lib/tensor-block.ts";

interface TensorView {
  result: number[][];
  summary: TensorSummary;
}

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export interface NotebookTensorBlockProps {
  source: string;
  op: TensorOpType;
  onSourceChange: (source: string) => void;
  onOpChange: (op: TensorOpType) => void;
}

/**
 * A small-tensor notebook block (issue #35 item 1): a hand-typed literal
 * grid, one tensor-core op applied for display, rendered as a table with
 * heatmap-colored cells (reusing heatmap.ts's shared color scale --
 * an HTML table rather than `drawHeatmap`'s canvas, since a hand-typed
 * <=16x16 grid reads better as selectable text than as pixels).
 *
 * Unlike graph/value blocks this holds NO CellGraph cells: the grid text
 * and op live in the block's own serialized state (see NotebookPanel's
 * Block union), and the parsed/derived view is a pure render-time compute.
 * Cross-block referencing (a tensor built FROM another block's curve, and
 * the whole-curve reference convention it needs) is issue #35's item 2,
 * still open.
 */
export function NotebookTensorBlock({ source, op, onSourceChange, onOpChange }: NotebookTensorBlockProps) {
  const view = useMemo<Result<TensorView>>(() => {
    try {
      const grid = parseTensorGrid(source);
      const result = applyTensorOp(grid, op);
      return { ok: true, value: { result, summary: summarizeTensor(result) } };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }, [source, op]);

  return (
    <div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <label style={{ fontSize: "0.9rem" }}>
          tensor{" "}
          <textarea
            value={source}
            onChange={(e) => onSourceChange(e.target.value)}
            rows={4}
            style={{ font: "inherit", fontFamily: "monospace", width: "24ch", verticalAlign: "top" }}
          />
        </label>
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
