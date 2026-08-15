import assert from "node:assert/strict";
import { test } from "node:test";
import { inferColumnType, numericColumn, pairedNumericColumns, parseCsv } from "./csv-import.ts";

test("parseCsv: plain grid, LF line endings, trailing newline tolerated", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n3,4\n"), { header: ["a", "b"], rows: [["1", "2"], ["3", "4"]] });
});

test("parseCsv: quoted fields keep commas; doubled quotes escape; newline survives inside quotes; CRLF endings work", () => {
  const parsed = parseCsv('name,note\r\n"Smith, Jo","He said ""hi"""\r\nplain,"x\ny"');
  assert.deepEqual(parsed.header, ["name", "note"]);
  assert.deepEqual(parsed.rows, [
    ["Smith, Jo", 'He said "hi"'],
    ["plain", "x\ny"],
  ]);
});

test("parseCsv: a stray mid-field quote is a literal character (lenient convention), not a quote-mode trap", () => {
  const parsed = parseCsv('a,b\nline"three,9');
  assert.deepEqual(parsed.rows, [['line"three', "9"]]);
});

test("parseCsv: rejects ragged rows with the row number, an unterminated quote, and header-only input", () => {
  assert.throws(() => parseCsv("a,b\n1"), /Row 1 has 1 fields, but the header has 2/);
  assert.throws(() => parseCsv('a,b\n"unterminated'), /Unterminated quoted field/);
  assert.throws(() => parseCsv("a,b\n"), /header row plus at least one data row/);
});

test("parseCsv: blank lines mid-file are dropped, not turned into phantom single-field rows", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n\n3,4").rows, [["1", "2"], ["3", "4"]]);
});

test("parseCsv: enforces the row and column caps", () => {
  const wide = Array.from({ length: 65 }, (_, i) => `c${i}`).join(",");
  assert.throws(() => parseCsv(`${wide}\n${Array(65).fill("1").join(",")}`), /At most 64 columns/);
  const tall = ["a", ...Array.from({ length: 10001 }, () => "1")].join("\n");
  assert.throws(() => parseCsv(tall), /At most 10000 data rows/);
});

test("numericColumn: extracts finite values and reports (never silently drops) skipped cells", () => {
  const parsed = parseCsv("v\n1.5\n\noops\n-2e3");
  // blank line dropped entirely; "oops" skipped; two numerics remain.
  assert.deepEqual(numericColumn(parsed, 0), { values: [1.5, -2000], skipped: 1 });
  assert.throws(() => numericColumn(parsed, 5), /No column at index 5/);
});

test("inferColumnType: all-numeric (ignoring empties) is number; any non-numeric or all-empty is text", () => {
  const parsed = parseCsv("a,b,c\n1,x,\n2.5,3,");
  assert.equal(inferColumnType(parsed, 0), "number");
  assert.equal(inferColumnType(parsed, 1), "text");
  assert.equal(inferColumnType(parsed, 2), "text"); // no numeric evidence at all
});

test("pairedNumericColumns: a row skips as a UNIT when either side is non-numeric (regression needs aligned pairs)", () => {
  const parsed = parseCsv("x,y\n1,2\n3,oops\nnope,4\n5,6");
  assert.deepEqual(pairedNumericColumns(parsed, 0, 1), {
    pairs: [
      { x: 1, y: 2 },
      { x: 5, y: 6 },
    ],
    skipped: 2,
  });
});
