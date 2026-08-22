import { Frame, type DType, type FieldDescriptor } from "@johnhenry/math-plus-frame-arrow";
import { MAX_CLASSES, type LabeledPoint } from "./ml-playground.ts";

const MAX_ROWS = 10000;
const MAX_COLS = 64;
/** Issue #253's CSV-to-ML-playground handoff: the regression handoff caps at 200 pairs (a hand-editable row list); the ML playground just trains on/renders a scatter, so it can take a good deal more before the URL-encoded state (see ml-playground-state.ts's csvPoints) gets unwieldy. */
const MAX_ML_POINTS = 1000;

export interface ParsedCsv {
  header: string[];
  /** Stringified cells, for the preview table's raw-text display only -- `numericColumn`/`pairedNumericColumns` read `typedRows` instead, to keep `mallory-frame-arrow`'s real per-column dtype inference (rather than re-parsing text). */
  rows: string[][];
  schema: FieldDescriptor[];
  /** Real typed cell values from `Frame.toRows()` -- notably `bigint` (not `number`) for an `int64` column, exact beyond `Number.MAX_SAFE_INTEGER` unlike a naive `Number()` parse. */
  typedRows: Record<string, unknown>[];
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") return value.toString();
  return String(value);
}

/**
 * Best-effort numeric conversion of one typed cell -- tried regardless of
 * the cell's own dtype (not just `int64`/`float64` columns), since
 * `Frame.fromCSV`'s inference is per-COLUMN: a single non-numeric cell (e.g.
 * a typo) widens the WHOLE column to `utf8`, arriving here as a `string` for
 * every row including the genuinely-numeric ones. Re-parsing a string cell
 * with `Number()` recovers exactly those, matching the old app-side
 * parser's per-CELL (not per-column) numeric salvage behavior. No
 * empty-string guard: `Frame.toRows()` never emits `""` for a `string`
 * cell (an empty or whitespace-only cell is always `null`, verified against
 * the real package), so `raw` is always non-blank when it's a string.
 */
function toNumber(raw: unknown): number {
  if (typeof raw === "bigint") return Number(raw);
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return Number(raw.trim());
  return Number.NaN;
}

/**
 * CSV parsing + per-column dtype inference (issue #36), delegated to
 * `mallory-frame-arrow`'s `Frame.fromCSV` (math-plus#86) -- this app's
 * own hand-rolled RFC-4180 tokenizer (see git history) is retired now that
 * the package has a real reader with an identical error-message format
 * (verified: both throw "Row N has X fields, but the header has Y." and
 * "Unterminated quoted field." with the exact same wording -- `Frame.fromCSV`
 * was ported near-verbatim from this file's old tokenizer).
 *
 * Two guards this app still enforces that `Frame.fromCSV` itself does not:
 * a header-only file (0 data rows) is rejected here rather than silently
 * producing an empty Frame, and `MAX_COLS`/`MAX_ROWS` cap runaway pastes --
 * both pre-existing UX guarantees from the hand-rolled parser, worth keeping
 * even though the library itself has no equivalent limits.
 */
export function parseCsv(text: string): ParsedCsv {
  const frame = Frame.fromCSV(text);
  if (frame.length === 0) throw new Error("Need a header row plus at least one data row.");
  if (frame.columns.length > MAX_COLS) throw new Error(`At most ${MAX_COLS} columns.`);
  if (frame.length > MAX_ROWS) throw new Error(`At most ${MAX_ROWS} data rows.`);
  const header = frame.columns;
  const typedRows = frame.toRows();
  const rows = typedRows.map((row) => header.map((name) => stringifyCell(row[name])));
  return { header, rows, schema: frame.schema, typedRows };
}

export interface NumericColumn {
  values: number[];
  /** Cells that were empty, non-numeric, or (for a `bool`/`utf8` column) not a number at all -- excluded from `values`, reported, never silently dropped. */
  skipped: number;
}

/**
 * The numeric values of one column, read from `Frame.toRows()`'s real typed
 * cells rather than re-parsing text -- an `int64` cell arrives as `bigint`
 * (converted via `Number()` here; downstream regression/statistics math is
 * already float-based, so this accepts the same precision ceiling that math
 * already has beyond `Number.MAX_SAFE_INTEGER`, a deliberate simplification,
 * not an oversight).
 */
export function numericColumn(parsed: ParsedCsv, columnIndex: number): NumericColumn {
  const name = parsed.header[columnIndex];
  if (name === undefined) throw new Error(`No column at index ${columnIndex}.`);
  const values: number[] = [];
  let skipped = 0;
  for (const row of parsed.typedRows) {
    const value = toNumber(row[name]);
    if (Number.isFinite(value)) values.push(value);
    else skipped++;
  }
  return { values, skipped };
}

/** The real inferred dtype of one column (`bool`/`int64`/`float64`/`utf8`, from `Frame.fromCSV`'s own inference), replacing the old app-side binary "number"/"text" guess. */
export function inferColumnType(parsed: ParsedCsv, columnIndex: number): DType {
  const field = parsed.schema[columnIndex];
  if (!field) throw new Error(`No column at index ${columnIndex}.`);
  return field.dtype;
}

/**
 * Paired (x, y) numeric rows from two columns -- a row contributes only when
 * BOTH cells are numeric (regression needs aligned pairs, so a row that's
 * numeric in one column but not the other is skipped as a unit).
 */
export function pairedNumericColumns(parsed: ParsedCsv, xIndex: number, yIndex: number): { pairs: Array<{ x: number; y: number }>; skipped: number } {
  const xName = parsed.header[xIndex];
  const yName = parsed.header[yIndex];
  if (xName === undefined) throw new Error(`No column at index ${xIndex}.`);
  if (yName === undefined) throw new Error(`No column at index ${yIndex}.`);
  const pairs: Array<{ x: number; y: number }> = [];
  let skipped = 0;
  for (const row of parsed.typedRows) {
    const x = toNumber(row[xName]);
    const y = toNumber(row[yName]);
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push({ x, y });
    else skipped++;
  }
  return { pairs, skipped };
}

export interface LabeledPointsFromColumns {
  points: LabeledPoint[];
  /** `classNames[i]` is the original cell text that became label `i` -- first-seen order, so the same CSV always assigns the same indices given the same row order. */
  classNames: string[];
  /** Rows dropped: a non-numeric x/y cell, OR a label value seen only after MAX_CLASSES distinct classes were already assigned, OR beyond the MAX_ML_POINTS cap. Reported, never silently absorbed. */
  skipped: number;
}

/**
 * Issue #253's "load custom datasets" for the ML playground: (x, y, label)
 * triples from three CSV columns, handed off to MlPlaygroundPanel's `"csv"`
 * dataset (see DataImportPanel.tsx's "Open in ML" action and
 * ml-playground-state.ts's `csvPoints`/`classNames`).
 *
 * The label column can be ANY column (unlike x/y, which must be numeric) --
 * its distinct cell values, in first-seen row order, become 0-indexed
 * integer classes (`TinyMlp`'s own label contract, see ml-playground.ts).
 * A row whose x or y cell isn't numeric is skipped as a unit (same
 * reasoning as `pairedNumericColumns`); a row introducing a class beyond
 * `MAX_CLASSES` is also skipped, keeping the imported dataset within what
 * `TinyMlp`'s output layer can ever represent -- rather than throwing and
 * discarding an otherwise-good import over one over-cardinality column.
 */
export function labeledPointsFromColumns(parsed: ParsedCsv, xIndex: number, yIndex: number, labelIndex: number): LabeledPointsFromColumns {
  const xName = parsed.header[xIndex];
  const yName = parsed.header[yIndex];
  const labelName = parsed.header[labelIndex];
  if (xName === undefined) throw new Error(`No column at index ${xIndex}.`);
  if (yName === undefined) throw new Error(`No column at index ${yIndex}.`);
  if (labelName === undefined) throw new Error(`No column at index ${labelIndex}.`);
  const classIndex = new Map<string, number>();
  const classNames: string[] = [];
  const points: LabeledPoint[] = [];
  let skipped = 0;
  for (const row of parsed.typedRows) {
    if (points.length >= MAX_ML_POINTS) {
      skipped++;
      continue;
    }
    const x = toNumber(row[xName]);
    const y = toNumber(row[yName]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      skipped++;
      continue;
    }
    const name = stringifyCell(row[labelName]);
    let label = classIndex.get(name);
    if (label === undefined) {
      if (classIndex.size >= MAX_CLASSES) {
        skipped++;
        continue;
      }
      label = classIndex.size;
      classIndex.set(name, label);
      classNames.push(name);
    }
    points.push({ x, y, label });
  }
  return { points, classNames, skipped };
}
