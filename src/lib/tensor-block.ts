import { Tensor } from "mallory-tensor-core";

export type TensorOpType = "none" | "abs" | "neg" | "exp" | "sqrt" | "clip01" | "transpose" | "fliplr" | "flipud" | "roll" | "pad" | "repeat";

export const TENSOR_OP_LABELS: Record<TensorOpType, string> = {
  none: "none",
  abs: "abs",
  neg: "negate",
  exp: "exp",
  sqrt: "sqrt",
  clip01: "clip to [0, 1]",
  transpose: "transpose",
  fliplr: "flip left-right",
  flipud: "flip up-down",
  roll: "roll right by 1",
  pad: "pad border with 0s",
  repeat: "repeat rows",
};

/** Ops from `TENSOR_OP_LABELS` that read `arg` (the "Also remaining from item 1's original sketch: pad/repeat/split ops (parameterized, need arg inputs...)" line from issue #35) -- every other op takes none, matching the original v1 no-arg op picker. `split` isn't included: unlike every other op it returns MULTIPLE tensors, a genuinely different UI shape (which piece to display) deserving its own design rather than forcing it through this single-grid-in-single-grid-out picker. */
export const TENSOR_OPS_WITH_ARG: ReadonlySet<TensorOpType> = new Set(["pad", "repeat"]);

const MAX_DIM = 16;

/**
 * Parses a literal 2D grid: one row per line, numbers separated by spaces
 * and/or commas. Rejects ragged rows, non-numeric entries, empty input, and
 * anything larger than 16x16 (a notebook tensor block is for looking at a
 * SMALL tensor, per issue #35 -- big data belongs in the data-import
 * ticket's world, not a hand-typed grid).
 */
export function parseTensorGrid(text: string): number[][] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("Enter at least one row of numbers.");
  if (lines.length > MAX_DIM) throw new Error(`At most ${MAX_DIM} rows.`);
  const grid = lines.map((line) => {
    const parts = line.split(/[,\s]+/).filter((p) => p.length > 0);
    return parts.map((p) => {
      const value = Number(p);
      if (Number.isNaN(value)) throw new Error(`"${p}" is not a number.`);
      return value;
    });
  });
  const width = grid[0]!.length;
  if (width > MAX_DIM) throw new Error(`At most ${MAX_DIM} columns.`);
  for (const row of grid) {
    if (row.length !== width) throw new Error(`Rows must all have the same length -- got ${row.length} and ${width}.`);
  }
  return grid;
}

function gridToTensor(grid: readonly (readonly number[])[]): Tensor {
  const flat: number[] = [];
  for (const row of grid) for (const v of row) flat.push(v);
  return Tensor.from(flat, { dtype: "f64" }).reshape([grid.length, grid[0]!.length]);
}

function tensorToGrid(tensor: Tensor): number[][] {
  const [rows, cols] = tensor.shape as [number, number];
  const grid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) row.push(tensor.at(r, c) as number);
    grid.push(row);
  }
  return grid;
}

/**
 * Applies one of the supported ops through REAL tensor-core methods (the
 * whole point of issue #35's tensor block: exercising the library, not
 * reimplementing per-element math app-side). `sqrt` of a negative and `log`-
 * family domain issues surface as NaN cells in the rendered grid rather
 * than throwing -- visible, honest, and exactly what the library itself
 * produces.
 *
 * `arg` is only read by `pad`/`repeat` (see `TENSOR_OPS_WITH_ARG`) -- a
 * non-negative integer for `pad` (border width on all four sides, via a
 * `[[arg,arg],[arg,arg]]` padding spec covering both axes of the 2D grid)
 * and a positive integer for `repeat` (per-row repeat count along axis 0,
 * NumPy `repeat` semantics -- each row duplicated in place, not tiled).
 */
export function applyTensorOp(grid: readonly (readonly number[])[], op: TensorOpType, arg = 1): number[][] {
  const tensor = gridToTensor(grid);
  switch (op) {
    case "none":
      return tensorToGrid(tensor);
    case "abs":
      return tensorToGrid(tensor.abs());
    case "neg":
      return tensorToGrid(tensor.neg());
    case "exp":
      return tensorToGrid(tensor.exp());
    case "sqrt":
      return tensorToGrid(tensor.sqrt());
    case "clip01":
      return tensorToGrid(tensor.clip(0, 1));
    case "transpose":
      return tensorToGrid(tensor.transpose());
    case "fliplr":
      return tensorToGrid(tensor.flip(1));
    case "flipud":
      return tensorToGrid(tensor.flip(0));
    case "roll":
      return tensorToGrid(tensor.roll(1, { axis: 1 }));
    case "pad": {
      const width = Math.max(0, Math.trunc(arg));
      return tensorToGrid(
        tensor.pad([
          [width, width],
          [width, width],
        ]),
      );
    }
    case "repeat":
      return tensorToGrid(tensor.repeat(Math.max(1, Math.trunc(arg)), { axis: 0 }));
  }
}

export interface TensorSummary {
  rows: number;
  cols: number;
  min: number;
  max: number;
  mean: number;
  sum: number;
}

/** Shape + full-reduction stats via tensor-core's own reductions (not re-summed app-side). */
export function summarizeTensor(grid: readonly (readonly number[])[]): TensorSummary {
  const tensor = gridToTensor(grid);
  return {
    rows: grid.length,
    cols: grid[0]!.length,
    min: tensor.min().item() as number,
    max: tensor.max().item() as number,
    mean: tensor.mean().item() as number,
    sum: tensor.sum().item() as number,
  };
}
