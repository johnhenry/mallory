import { useMemo, useState } from "react";
import { inferColumnType, labeledPointsFromColumns, pairedNumericColumns, parseCsv, type ParsedCsv } from "../lib/csv-import.ts";
import { numericColumn } from "../lib/csv-import.ts";
import { DEFAULT_ML_PLAYGROUND_STATE, encodeMlPlaygroundState } from "../lib/ml-playground-state.ts";
import { DEFAULT_REGRESSION_STATE, encodeRegressionState } from "../lib/regression-state.ts";
import { DEFAULT_STATISTICS_STATE, encodeStatisticsState } from "../lib/statistics-state.ts";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const PREVIEW_ROWS = 8;
/** The regression panel is a hand-editable row list -- thousands of rows would make it unusable, so the handoff caps (and says so). */
const MAX_REGRESSION_PAIRS = 200;
const MAX_STATISTICS_VALUES = 1000;

const EXAMPLE_CSV = "x,y,label\n1,2.1,a\n2,3.9,b\n3,6.2,c\n4,7.8,d\n5,10.1,e";

/**
 * CSV import (issue #36, CSV-first v1; issue #253 added the ML playground
 * as a third target): paste or load a file entirely client-side
 * (FileReader; nothing hits the server), preview the parsed header/rows
 * with inferred column types, then hand picked columns to the existing
 * Regression (x/y pairs), Statistics (sample), or ML playground
 * (x/y/label points) panels.
 *
 * The handoff uses the target panel's OWN URL-state codec: build a
 * RegressionState/StatisticsState/MlPlaygroundState, encode it, and
 * navigate to `/data?tab=<target>#<encoded>` (or `/ml#<encoded>` for the ML
 * playground, which lives at its own route, not a /data tab) -- a full
 * navigation, so the target panel mounts fresh and hydrates from the hash
 * exactly as if the link had been shared. Zero new cross-panel plumbing;
 * each target already owns a private CellGraph, so writing into a
 * sibling's cells directly isn't an option anyway.
 *
 * This panel itself keeps NO url state -- it's a transient scratch surface,
 * and the durable artifact of an import session is the target panel's
 * hash-encoded state, which IS shareable.
 */
export function DataImportPanel() {
  const [text, setText] = useState(EXAMPLE_CSV);
  const [xColumn, setXColumn] = useState(0);
  const [yColumn, setYColumn] = useState(1);
  const [sampleColumn, setSampleColumn] = useState(0);
  // Defaults match EXAMPLE_CSV's own "x,y,label" layout -- the label column
  // (unlike x/y) isn't restricted to numericColumns, since a label is
  // just as often text ("cat"/"dog") as it is numeric (see
  // labeledPointsFromColumns's own "any column" contract).
  const [mlXColumn, setMlXColumn] = useState(0);
  const [mlYColumn, setMlYColumn] = useState(1);
  const [mlLabelColumn, setMlLabelColumn] = useState(2);
  const [fileError, setFileError] = useState<string | null>(null);

  const parsed = useMemo<Result<ParsedCsv>>(() => {
    try {
      return { ok: true, value: parseCsv(text) };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);

  // Columns with AT LEAST ONE numeric value are offered -- not only the
  // strictly-all-numeric ones. A mostly-numeric column with a few bad cells
  // is exactly what the skip-count reporting exists for; gating on the
  // strict `inferColumnType` (which labels any column with one bad cell
  // "text") made that machinery unreachable -- found live: a height column
  // with a single "oops" cell offered nothing at all.
  const numericColumns = useMemo(() => {
    if (!parsed.ok) return [];
    return parsed.value.header
      .map((name, index) => ({ name, index }))
      .filter((c) => numericColumn(parsed.value, c.index).values.length > 0);
  }, [parsed]);

  function handleFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.onerror = () => setFileError("Couldn't read that file.");
    reader.readAsText(file);
  }

  function openInRegression() {
    if (!parsed.ok) return;
    const { pairs } = pairedNumericColumns(parsed.value, xColumn, yColumn);
    const points = pairs.slice(0, MAX_REGRESSION_PAIRS).map((p) => ({ x: String(p.x), y: String(p.y) }));
    if (points.length === 0) return;
    const encoded = encodeRegressionState({
      ...DEFAULT_REGRESSION_STATE,
      datasets: DEFAULT_REGRESSION_STATE.datasets.map((dataset) => ({ ...dataset, points })),
    });
    window.location.assign(`/data?tab=regression#${encoded}`);
  }

  function openInStatistics() {
    if (!parsed.ok) return;
    const { values } = numericColumn(parsed.value, sampleColumn);
    if (values.length === 0) return;
    const encoded = encodeStatisticsState({ ...DEFAULT_STATISTICS_STATE, data: values.slice(0, MAX_STATISTICS_VALUES).join(", ") });
    window.location.assign(`/data?tab=statistics#${encoded}`);
  }

  function openInMlPlayground() {
    if (!mlPreview || mlPreview.points.length === 0) return;
    const encoded = encodeMlPlaygroundState({
      ...DEFAULT_ML_PLAYGROUND_STATE,
      dataset: "csv",
      csvPoints: mlPreview.points,
      classNames: mlPreview.classNames,
    });
    window.location.assign(`/ml#${encoded}`);
  }

  const regressionPreview = parsed.ok && numericColumns.length >= 1 ? pairedNumericColumns(parsed.value, xColumn, yColumn) : null;
  const statisticsPreview = parsed.ok && numericColumns.length >= 1 ? numericColumn(parsed.value, sampleColumn) : null;
  // Issue #253's "send to ML" handoff -- wrapped in try/catch (unlike the
  // two previews above) because mlLabelColumn isn't restricted to
  // numericColumns the way xColumn/yColumn/sampleColumn are, so a column
  // count change (pasting a narrower CSV) can transiently leave a selected
  // index out of range before its <select> re-renders with valid options.
  const mlPreview = useMemo(() => {
    if (!parsed.ok || numericColumns.length === 0) return null;
    try {
      return labeledPointsFromColumns(parsed.value, mlXColumn, mlYColumn, mlLabelColumn);
    } catch {
      return null;
    }
  }, [parsed, numericColumns, mlXColumn, mlYColumn, mlLabelColumn]);

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        Paste CSV (first row = header) or load a file -- everything stays in your browser.
      </p>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          style={{ font: "inherit", fontFamily: "monospace", width: "42ch" }}
          aria-label="CSV text"
        />
        <label style={{ fontSize: "0.9rem" }}>
          or load a file: <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>
      </div>
      {fileError && <p style={{ color: "var(--danger)" }}>{fileError}</p>}
      {!parsed.ok ? (
        <p style={{ color: "var(--danger)" }}>{parsed.message}</p>
      ) : (
        <>
          <table style={{ borderCollapse: "collapse", fontSize: "0.85rem", margin: "0.5rem 0" }}>
            <thead>
              <tr>
                {parsed.value.header.map((name, i) => (
                  <th key={i} style={{ border: "1px solid var(--border)", padding: "0.2rem 0.5rem", textAlign: "left" }}>
                    {name}
                    <span style={{ color: "var(--muted)", fontWeight: 400 }}> ({inferColumnType(parsed.value, i)})</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parsed.value.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={{ border: "1px solid var(--border)", padding: "0.2rem 0.5rem" }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0" }}>
            {parsed.value.rows.length} row{parsed.value.rows.length === 1 ? "" : "s"}
            {parsed.value.rows.length > PREVIEW_ROWS ? ` (showing first ${PREVIEW_ROWS})` : ""} · {numericColumns.length} numeric column
            {numericColumns.length === 1 ? "" : "s"}
          </p>

          {numericColumns.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No numeric columns detected -- nothing to send to Regression, Statistics, or ML.</p>
          ) : (
            <>
              <h3>Send to Regression</h3>
              <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <label>
                  x:{" "}
                  <select value={xColumn} onChange={(e) => setXColumn(Number(e.target.value))}>
                    {numericColumns.map((c) => (
                      <option key={c.index} value={c.index}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  y:{" "}
                  <select value={yColumn} onChange={(e) => setYColumn(Number(e.target.value))}>
                    {numericColumns.map((c) => (
                      <option key={c.index} value={c.index}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={openInRegression} disabled={!regressionPreview || regressionPreview.pairs.length === 0}>
                  Open in Regression
                </button>
                {regressionPreview && (
                  <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                    {Math.min(regressionPreview.pairs.length, MAX_REGRESSION_PAIRS)} pair
                    {regressionPreview.pairs.length === 1 ? "" : "s"}
                    {regressionPreview.pairs.length > MAX_REGRESSION_PAIRS ? ` (capped at ${MAX_REGRESSION_PAIRS})` : ""}
                    {regressionPreview.skipped > 0 ? `, ${regressionPreview.skipped} row(s) skipped (non-numeric)` : ""}
                  </span>
                )}
              </div>

              <h3>Send to Statistics</h3>
              <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <label>
                  sample column:{" "}
                  <select value={sampleColumn} onChange={(e) => setSampleColumn(Number(e.target.value))}>
                    {numericColumns.map((c) => (
                      <option key={c.index} value={c.index}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={openInStatistics} disabled={!statisticsPreview || statisticsPreview.values.length === 0}>
                  Open in Statistics
                </button>
                {statisticsPreview && (
                  <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                    {Math.min(statisticsPreview.values.length, MAX_STATISTICS_VALUES)} value
                    {statisticsPreview.values.length === 1 ? "" : "s"}
                    {statisticsPreview.values.length > MAX_STATISTICS_VALUES ? ` (capped at ${MAX_STATISTICS_VALUES})` : ""}
                    {statisticsPreview.skipped > 0 ? `, ${statisticsPreview.skipped} cell(s) skipped` : ""}
                  </span>
                )}
              </div>

              <h3>Send to ML</h3>
              <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <label>
                  x:{" "}
                  <select value={mlXColumn} onChange={(e) => setMlXColumn(Number(e.target.value))}>
                    {numericColumns.map((c) => (
                      <option key={c.index} value={c.index}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  y:{" "}
                  <select value={mlYColumn} onChange={(e) => setMlYColumn(Number(e.target.value))}>
                    {numericColumns.map((c) => (
                      <option key={c.index} value={c.index}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  label:{" "}
                  <select value={mlLabelColumn} onChange={(e) => setMlLabelColumn(Number(e.target.value))}>
                    {parsed.value.header.map((name, index) => (
                      <option key={index} value={index}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={openInMlPlayground} disabled={!mlPreview || mlPreview.points.length === 0}>
                  Open in ML
                </button>
                {mlPreview && (
                  <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                    {mlPreview.points.length} point{mlPreview.points.length === 1 ? "" : "s"}, {mlPreview.classNames.length} class
                    {mlPreview.classNames.length === 1 ? "" : "es"}
                    {mlPreview.skipped > 0 ? `, ${mlPreview.skipped} row(s) skipped (non-numeric x/y, over the points cap, or over the class cap)` : ""}
                  </span>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
