import { Frame, type DType, type FieldDescriptor } from "mallory-frame-arrow";

const MAX_ROWS = 10000;
const MAX_COLS = 64;

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
 * `mallory-frame-arrow`'s `Frame.fromCSV` (mallory-plus#86) -- this app's
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
