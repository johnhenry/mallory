import type { ComplexNumber } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsMatrix, type CellIdsMatrix } from "../lib/cell-ids.ts";
import {
  computeDecompositions,
  computeDeterminant,
  computeInverse,
  parseMatrixText,
  polynomialRootsViaCompanionMatrix,
  tracedRref,
  type DecompositionSet,
  type Mat,
  type TracedRref,
} from "../lib/matrix-ops.ts";
import { DEFAULT_MATRIX_STATE, decodeMatrixState, encodeMatrixState, type MatrixState } from "../lib/matrix-state.ts";
import { drawScatter, type Viewport } from "../lib/render-path.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { PngExportButton } from "./PngExportButton.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

function MatrixTable({ m }: { m: Mat }) {
  return (
    <table style={{ borderCollapse: "collapse", margin: "0.25rem 0" }}>
      <tbody>
        {m.map((row, i) => (
          <tr key={i}>
            {row.map((v, j) => (
              <td key={j} style={{ border: "1px solid var(--border)", padding: "2px 8px", textAlign: "right", fontFamily: "monospace" }}>
                {Number.isFinite(v) ? v.toFixed(4) : String(v)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function seedMatrixState(graph: CellGraph, ids: CellIdsMatrix, state: MatrixState): void {
  graph.set(ids.matrixText, state.matrixText);
  graph.set(ids.polyCoeffs, state.polyCoeffs);
}

function getCurrentMatrixState(graph: CellGraph, ids: CellIdsMatrix): MatrixState {
  return { v: 1, matrixText: graph.get<string>(ids.matrixText), polyCoeffs: graph.get<string>(ids.polyCoeffs) };
}

function useMatrixGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsMatrix(cellId);
    const decoded = typeof window !== "undefined" ? decodeMatrixState(window.location.hash.slice(1)) : null;
    seedMatrixState(graph, ids, decoded ?? DEFAULT_MATRIX_STATE);

    const matrix = (): Mat => parseMatrixText(graph.get<string>(ids.matrixText));

    graph.define(ids.determinant, (): Result<number> => {
      try {
        return { ok: true, value: computeDeterminant(matrix()).value };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.inverse, (): Result<Mat> => {
      try {
        return { ok: true, value: computeInverse(matrix()).matrix };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.rref, (): Result<TracedRref> => {
      try {
        return { ok: true, value: tracedRref(matrix()) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.decompositions, (): Result<DecompositionSet> => {
      try {
        return { ok: true, value: computeDecompositions(matrix()) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.polyRoots, (): Result<ComplexNumber[]> => {
      try {
        const coeffs = graph
          .get<string>(ids.polyCoeffs)
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number);
        if (coeffs.length === 0 || coeffs.some(Number.isNaN)) throw new Error("Enter comma/space-separated coefficients [a0, a1, ..., a(n-1)].");
        return { ok: true, value: polynomialRootsViaCompanionMatrix(coeffs) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

const ROOT_CANVAS_SIZE = 220;

/** Matrix playground: determinant/inverse, step-through RREF, every MatrixMath decomposition over one entered matrix, and polynomial roots (any degree) via a companion matrix fed to adapter-math's eigGeneral. */
export function MatrixPanel({ cellId = "matrix-1" }: { cellId?: string } = {}) {
  const graph = useMatrixGraph(cellId);
  useCellGraphTools(`data_matrix_${cellId}`, graph);
  const ids = cellIdsMatrix(cellId);
  const rootCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const matrixText = useCell<string>(graph, ids.matrixText);
  const polyCoeffs = useCell<string>(graph, ids.polyCoeffs);
  const determinant = useCell<Result<number>>(graph, ids.determinant);
  const inverse = useCell<Result<Mat>>(graph, ids.inverse);
  const rref = useCell<Result<TracedRref>>(graph, ids.rref);
  const decompositions = useCell<Result<DecompositionSet>>(graph, ids.decompositions);
  const polyRoots = useCell<Result<ComplexNumber[]>>(graph, ids.polyRoots);

  const [matrixTextInput, setMatrixTextInput] = useState(matrixText);
  useEffect(() => {
    setMatrixTextInput(matrixText);
  }, [matrixText]);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeMatrixState(getCurrentMatrixState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const ctx = rootCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, ROOT_CANVAS_SIZE, ROOT_CANVAS_SIZE);
    if (polyRoots.ok) {
      const points = polyRoots.value.map((r) => ({ x: r.value, y: r.iValue }));
      const maxAbs = Math.max(1, ...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
      const viewport: Viewport = { xMin: -maxAbs * 1.2, xMax: maxAbs * 1.2, yMin: -maxAbs * 1.2, yMax: maxAbs * 1.2 };
      // axes
      ctx.save();
      ctx.strokeStyle = "#e5e7eb";
      ctx.beginPath();
      ctx.moveTo(ROOT_CANVAS_SIZE / 2, 0);
      ctx.lineTo(ROOT_CANVAS_SIZE / 2, ROOT_CANVAS_SIZE);
      ctx.moveTo(0, ROOT_CANVAS_SIZE / 2);
      ctx.lineTo(ROOT_CANVAS_SIZE, ROOT_CANVAS_SIZE / 2);
      ctx.stroke();
      ctx.restore();
      drawScatter(ctx, points, viewport, ROOT_CANVAS_SIZE, ROOT_CANVAS_SIZE, 4, "#dc2626");
    }
  }, [polyRoots]);

  function updateMatrixText(value: string) {
    setMatrixTextInput(value);
    graph.set(ids.matrixText, value);
  }

  return (
    <div>
      <h2>Matrix</h2>
      <div style={{ margin: "0.25rem 0" }}>
        <textarea
          value={matrixTextInput}
          onChange={(e) => updateMatrixText(e.target.value)}
          rows={4}
          style={{ font: "inherit", fontFamily: "monospace", width: "30ch" }}
        />
      </div>
      <div style={{ margin: "0.5rem 0", display: "flex", gap: "2rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>Determinant</p>
          {determinant.ok ? <p>{determinant.value.toFixed(6)}</p> : <p style={{ color: "var(--danger)" }}>{determinant.message}</p>}
        </div>
        <div>
          <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>Inverse</p>
          {inverse.ok ? <MatrixTable m={inverse.value} /> : <p style={{ color: "var(--danger)" }}>{inverse.message}</p>}
        </div>
      </div>

      <h3>Reduced row echelon form</h3>
      {rref.ok ? (
        <div>
          <button type="button" onClick={() => setShowSteps((v) => !v)}>
            {showSteps ? "▾" : "▸"} Show steps ({rref.value.steps.length})
          </button>
          {showSteps && (
            <ol>
              {rref.value.steps.map((step, i) => (
                <li key={i}>
                  {step.description}
                  <MatrixTable m={step.matrix} />
                </li>
              ))}
            </ol>
          )}
          <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>Result</p>
          <MatrixTable m={rref.value.result} />
        </div>
      ) : (
        <p style={{ color: "var(--danger)" }}>{rref.message}</p>
      )}

      <h3>Decompositions</h3>
      {decompositions.ok ? (
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          <div>
            <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>LU (P·A = L·U, sign {decompositions.value.lu.sign})</p>
            <MatrixTable m={[...decompositions.value.lu.L].map((r) => [...r])} />
            <MatrixTable m={[...decompositions.value.lu.U].map((r) => [...r])} />
          </div>
          <div>
            <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>QR</p>
            <MatrixTable m={[...decompositions.value.qr.Q].map((r) => [...r])} />
            <MatrixTable m={[...decompositions.value.qr.R].map((r) => [...r])} />
          </div>
          {decompositions.value.eigenSymmetric && (
            <div>
              <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>Eigenvalues (symmetric)</p>
              <p>{[...decompositions.value.eigenSymmetric.values].map((v) => v.toFixed(4)).join(", ")}</p>
            </div>
          )}
          <div>
            <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>Rank / Condition number</p>
            <p>
              rank = {decompositions.value.rank}, κ = {decompositions.value.conditionNumber.toFixed(4)}
            </p>
            {decompositions.value.choleskyError && <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Cholesky: {decompositions.value.choleskyError}</p>}
          </div>
          {decompositions.value.nullSpace.some((row) => row.some((v) => v !== 0)) && (
            <div>
              <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>Null space basis</p>
              <MatrixTable m={decompositions.value.nullSpace} />
            </div>
          )}
        </div>
      ) : (
        <p style={{ color: "var(--danger)" }}>{decompositions.message}</p>
      )}

      <h2>Polynomial roots</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        Coefficients [a₀, a₁, ..., aₙ₋₁] of the monic polynomial xⁿ + aₙ₋₁xⁿ⁻¹ + ... + a₁x + a₀ (via a companion matrix's eigenvalues).
      </p>
      <div style={{ margin: "0.25rem 0" }}>
        <input
          value={polyCoeffs}
          onChange={(e) => graph.set(ids.polyCoeffs, e.target.value)}
          style={{ font: "inherit", fontFamily: "monospace", width: "30ch" }}
        />
      </div>
      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
        <div>
          <canvas ref={rootCanvasRef} width={ROOT_CANVAS_SIZE} height={ROOT_CANVAS_SIZE} style={{ border: "1px solid var(--border)" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => rootCanvasRef.current} label="matrix-roots" />
          </div>
        </div>
        {polyRoots.ok ? (
          <ul>
            {polyRoots.value.map((r, i) => (
              <li key={i}>{r.toString()}</li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "var(--danger)" }}>{polyRoots.message}</p>
        )}
      </div>
    </div>
  );
}
