export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

const MAX_ROWS = 10000;
const MAX_COLS = 64;

/**
 * RFC-4180-style CSV parsing (issue #36, CSV-first v1): quoted fields,
 * doubled-quote escapes, commas and newlines INSIDE quoted fields, CRLF or
 * LF line endings. First row is the header. Ragged rows are rejected with a
 * clear error rather than silently padded -- for a data-import flow,
 * a column-count mismatch almost always means a quoting bug in the source,
 * and feeding misaligned columns to regression/statistics silently would be
 * worse than stopping.
 *
 * App-side rather than `mallory-frame-arrow` for now: that package has no
 * CSV *reader* (only a `tableToCSV` writer), and installing it currently
 * ERESOLVEs against this app's `mallory-tensor-core@0.1.0` (it exact-pins
 * the 0.0.1 peer) -- both filed upstream; see the issue-36 trim for links.
 */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.length === 0) {
      // A quote only OPENS a quoted section at field start (RFC 4180 forbids
      // quotes in unquoted fields entirely; the lenient convention -- what
      // Python's csv module does -- is to treat a mid-field quote as a
      // literal character, which the `else` fallthrough below handles).
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r" && text[i + 1] === "\n") {
      pushRecord();
      i += 2;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      pushRecord();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) throw new Error("Unterminated quoted field.");
  // Final record, unless the text ended exactly on a record boundary.
  if (field.length > 0 || record.length > 0) pushRecord();

  // A trailing newline leaves no phantom empty record (handled above), but a
  // genuinely empty line mid-file parses as a single empty field -- drop those.
  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0] === ""));
  if (nonEmpty.length < 2) throw new Error("Need a header row plus at least one data row.");
  const header = nonEmpty[0]!;
  const rows = nonEmpty.slice(1);
  if (header.length > MAX_COLS) throw new Error(`At most ${MAX_COLS} columns.`);
  if (rows.length > MAX_ROWS) throw new Error(`At most ${MAX_ROWS} data rows.`);
  for (const [rowIndex, row] of rows.entries()) {
    if (row.length !== header.length) {
      throw new Error(`Row ${rowIndex + 1} has ${row.length} fields, but the header has ${header.length}.`);
    }
  }
  return { header, rows };
}

export interface NumericColumn {
  values: number[];
  /** Cells that were empty or non-numeric, excluded from `values` -- reported, never silently dropped. */
  skipped: number;
}

/** The numeric values of one column, with a skip count for empty/non-numeric cells. */
export function numericColumn(parsed: ParsedCsv, columnIndex: number): NumericColumn {
  if (columnIndex < 0 || columnIndex >= parsed.header.length) throw new Error(`No column at index ${columnIndex}.`);
  const values: number[] = [];
  let skipped = 0;
  for (const row of parsed.rows) {
    const cell = (row[columnIndex] ?? "").trim();
    const value = cell === "" ? Number.NaN : Number(cell);
    if (Number.isFinite(value)) values.push(value);
    else skipped++;
  }
  return { values, skipped };
}

/** "number" when every non-empty cell parses as a finite number (and at least one does); "text" otherwise. */
export function inferColumnType(parsed: ParsedCsv, columnIndex: number): "number" | "text" {
  let numeric = 0;
  let nonNumeric = 0;
  for (const row of parsed.rows) {
    const cell = (row[columnIndex] ?? "").trim();
    if (cell === "") continue;
    if (Number.isFinite(Number(cell))) numeric++;
    else nonNumeric++;
  }
  return numeric > 0 && nonNumeric === 0 ? "number" : "text";
}

/**
 * Paired (x, y) numeric rows from two columns -- a row contributes only when
 * BOTH cells are numeric (regression needs aligned pairs, so a row that's
 * numeric in one column but not the other is skipped as a unit).
 */
export function pairedNumericColumns(parsed: ParsedCsv, xIndex: number, yIndex: number): { pairs: Array<{ x: number; y: number }>; skipped: number } {
  if (xIndex < 0 || xIndex >= parsed.header.length) throw new Error(`No column at index ${xIndex}.`);
  if (yIndex < 0 || yIndex >= parsed.header.length) throw new Error(`No column at index ${yIndex}.`);
  const pairs: Array<{ x: number; y: number }> = [];
  let skipped = 0;
  for (const row of parsed.rows) {
    const x = Number((row[xIndex] ?? "").trim() || "NaN");
    const y = Number((row[yIndex] ?? "").trim() || "NaN");
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push({ x, y });
    else skipped++;
  }
  return { pairs, skipped };
}
