import { ComplexNumber, Symbolic, type Expr } from "mallory-math";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsComplex, type CellIdsComplex } from "../lib/cell-ids.ts";
import {
  DEFAULT_COMPLEX_STATE,
  decodeComplexState,
  encodeComplexState,
  type ComplexState,
  type ConformalGridType,
} from "../lib/complex-state.ts";
import { evaluateComplex, type ComplexEnv } from "../lib/complex-eval.ts";
import { collectFreeVars, defaultSliderRange } from "../lib/free-vars.ts";
import { resolveNaturalLanguageQuery } from "../lib/nl-query.ts";
import { renderDomainColoring } from "../lib/complex-raster.ts";
import { nthRootsOfUnity } from "../lib/roots-of-unity.ts";
import { findComplexZeros, findComplexPoles, type ComplexDomain } from "../lib/complex-roots.ts";
import { autoFitViewport, mapGridLines, polarGridLines, rectangularGridLines, type MappedLine } from "../lib/conformal-grid.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";
import { polylinesToSvgDocument } from "../lib/svg-export.ts";
import { drawPolyline, drawScatter } from "../lib/render-path.ts";
import { saveGraph } from "../lib/saved-graphs.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import type { Viewport } from "../lib/viewport.ts";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const WIDTH = 480;
const HEIGHT = 480;
const VIEWPORT: Viewport = { xMin: -3, xMax: 3, yMin: -3, yMax: 3 };
const ROOT_SEARCH_DOMAIN: ComplexDomain = { reMin: VIEWPORT.xMin, reMax: VIEWPORT.xMax, imMin: VIEWPORT.yMin, imMax: VIEWPORT.yMax };

export function seedComplexState(graph: CellGraph, ids: CellIdsComplex, state: ComplexState): void {
  graph.set(ids.exprText, state.exprText);
  graph.set(ids.probeRe, state.probeRe);
  graph.set(ids.probeIm, state.probeIm);
  graph.set(ids.showRootsOfUnity, state.showRootsOfUnity);
  graph.set(ids.rootsN, state.rootsN);
  graph.set(ids.showConformalGrid, state.showConformalGrid);
  graph.set(ids.conformalGridType, state.conformalGridType);
  graph.set(ids.conformalGridSpacing, state.conformalGridSpacing);
  graph.set(ids.showZeros, state.showZeros);
  graph.set(ids.showPoles, state.showPoles);
}

export function getCurrentComplexState(graph: CellGraph, ids: CellIdsComplex): ComplexState {
  return {
    v: 3,
    exprText: graph.get<string>(ids.exprText),
    probeRe: graph.get<string>(ids.probeRe),
    probeIm: graph.get<string>(ids.probeIm),
    showRootsOfUnity: graph.get<boolean>(ids.showRootsOfUnity),
    rootsN: graph.get<string>(ids.rootsN),
    showConformalGrid: graph.get<boolean>(ids.showConformalGrid),
    conformalGridType: graph.get<ConformalGridType>(ids.conformalGridType),
    conformalGridSpacing: graph.get<string>(ids.conformalGridSpacing),
    showZeros: graph.get<boolean>(ids.showZeros),
    showPoles: graph.get<boolean>(ids.showPoles),
  };
}

/** Merges a real-valued free-variable slider snapshot into a ComplexEnv alongside the bound `z`. */
export function complexParamEnv(params: Record<string, number>, z: ComplexNumber): ComplexEnv {
  const env: ComplexEnv = { z };
  for (const [name, value] of Object.entries(params)) env[name] = ComplexNumber.fromNumber(value);
  return env;
}

interface ProbeReading {
  re: number;
  im: number;
  magnitude: number;
  angle: number;
}

interface ConformalGridReading {
  /** The un-mapped generator grid in the z-plane -- drawn as an overlay on the domain-coloring canvas. */
  zLines: MappedLine[];
  /** The same grid's image under f -- drawn on its own auto-fit w-plane canvas. */
  wLines: MappedLine[];
  wViewport: Viewport;
}

/**
 * Sets up the complex-plane panel's reactive cells -- a function-of-z
 * domain plus a probe point and a roots-of-unity demo, none of which fit
 * `cellIds`/GraphCanvas's real-axis-only expression shape (see
 * complex-eval.ts's doc comment for why `Symbolic`'s own evaluators can't
 * be reused here either). Shares an `externalGraph` when supplied (e.g. a
 * notebook block) instead of creating a private one, mirroring OdePanel's
 * `useOdeGraph`. URL-hash hydration only applies to the standalone,
 * private-graph case, since an external graph's owner (NotebookPanel) is
 * responsible for its own seeding.
 */
function useComplexGraph(cellId: string, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    const ids = cellIdsComplex(cellId);
    if (!graph.has(ids.exprText)) {
      const decoded = !externalGraph && typeof window !== "undefined" ? decodeComplexState(window.location.hash.slice(1)) : null;
      seedComplexState(graph, ids, decoded ?? DEFAULT_COMPLEX_STATE);

      graph.define(ids.parseResult, (): Result<Expr> => {
        try {
          return { ok: true, value: Symbolic.parse(graph.get<string>(ids.exprText)) };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });

      // Free-variable sliders (e.g. `f(z) = z^2 + c`) -- reuses the same
      // collectFreeVars/defaultSliderRange machinery as GraphCanvas/
      // ExpressionRow, just keyed off "z" instead of the real-axis variable.
      // `params` is auxiliary (not schema/gallery state): it depends on
      // per-name slider cells seeded lazily by an effect in the component
      // below, mirroring GraphCanvas's `ids.params`.
      graph.define(
        ids.freeVars,
        (): string[] => {
          const parsed = graph.get<Result<Expr>>(ids.parseResult);
          if (!parsed.ok) return [];
          return collectFreeVars(parsed.value, "z");
        },
        { auxiliary: true },
      );

      graph.define(
        ids.params,
        (): Record<string, number> => {
          const names = graph.get<string[]>(ids.freeVars);
          const params: Record<string, number> = {};
          for (const name of names) params[name] = graph.get<number>(ids.param(name));
          return params;
        },
        { auxiliary: true },
      );

      graph.define(ids.probeResult, (): Result<ProbeReading> => {
        try {
          const parsed = graph.get<Result<Expr>>(ids.parseResult);
          if (!parsed.ok) throw new Error(parsed.message);
          const re = Number(graph.get<string>(ids.probeRe));
          const im = Number(graph.get<string>(ids.probeIm));
          if (Number.isNaN(re) || Number.isNaN(im)) throw new Error("Probe re/im must both be numbers.");
          const env = complexParamEnv(graph.get<Record<string, number>>(ids.params), new ComplexNumber(re, im));
          const w = evaluateComplex(parsed.value, env);
          return { ok: true, value: { re: w.value, im: w.iValue, magnitude: w.magnitude(), angle: w.angle() } };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });

      graph.define(ids.rootsResult, (): Result<ComplexNumber[]> => {
        try {
          const n = Number(graph.get<string>(ids.rootsN));
          return { ok: true, value: nthRootsOfUnity(n) };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });

      graph.define(ids.conformalGridResult, (): Result<ConformalGridReading> => {
        try {
          const parsed = graph.get<Result<Expr>>(ids.parseResult);
          if (!parsed.ok) throw new Error(parsed.message);
          const expr = parsed.value;
          const spacing = Number(graph.get<string>(ids.conformalGridSpacing));
          if (Number.isNaN(spacing) || spacing <= 0) throw new Error("Grid spacing must be a positive number.");
          const gridType = graph.get<ConformalGridType>(ids.conformalGridType);
          const zGrid = gridType === "polar" ? polarGridLines(VIEWPORT.xMax, spacing, 12) : rectangularGridLines(VIEWPORT, spacing);
          const zLines = zGrid.map((line) => line.map((z) => ({ x: z.value, y: z.iValue })));
          const params = graph.get<Record<string, number>>(ids.params);
          const wLines = mapGridLines(zGrid, (z) => evaluateComplex(expr, complexParamEnv(params, z)));
          const wViewport = autoFitViewport(wLines, VIEWPORT);
          return { ok: true, value: { zLines, wLines, wViewport } };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });

      graph.define(ids.zerosResult, (): Result<ComplexNumber[]> => {
        try {
          const parsed = graph.get<Result<Expr>>(ids.parseResult);
          if (!parsed.ok) throw new Error(parsed.message);
          const expr = parsed.value;
          const derivative = Symbolic.differentiate(expr, "z");
          const params = graph.get<Record<string, number>>(ids.params);
          const g = (z: ComplexNumber) => evaluateComplex(expr, complexParamEnv(params, z));
          const gPrime = (z: ComplexNumber) => evaluateComplex(derivative, complexParamEnv(params, z));
          return { ok: true, value: findComplexZeros(g, gPrime, ROOT_SEARCH_DOMAIN) };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });

      graph.define(ids.polesResult, (): Result<ComplexNumber[]> => {
        try {
          const parsed = graph.get<Result<Expr>>(ids.parseResult);
          if (!parsed.ok) throw new Error(parsed.message);
          const expr = parsed.value;
          const derivative = Symbolic.differentiate(expr, "z");
          const params = graph.get<Record<string, number>>(ids.params);
          const f = (z: ComplexNumber) => evaluateComplex(expr, complexParamEnv(params, z));
          const fPrime = (z: ComplexNumber) => evaluateComplex(derivative, complexParamEnv(params, z));
          return { ok: true, value: findComplexPoles(f, fPrime, ROOT_SEARCH_DOMAIN) };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      });
    }

    ref.current = graph;
  }
  return ref.current;
}

export interface ComplexPanelProps {
  cellId?: string;
  /** Share an existing CellGraph (e.g. from a notebook block) instead of creating a private one. */
  graph?: CellGraph;
  /** Hydrate from and write to the URL fragment. Off for a notebook-embedded instance, whose document owns persistence instead. */
  syncUrl?: boolean;
}

/**
 * v1 of the complex-plane panel (part of #20): domain coloring of f(z) as a
 * per-pixel raster, a probe-point evaluator, and an n-th-roots-of-unity
 * overlay demo. Conformal grid mapping (image of a rectangular/polar grid
 * under f) shipped as a follow-up, still part of #20. General zero/pole
 * finding for an arbitrary f(z) and MathLive keyboard entry remain deferred.
 */
export function ComplexPanel({ cellId = "complex-1", graph: externalGraph, syncUrl = true }: ComplexPanelProps = {}) {
  const graph = useComplexGraph(cellId, externalGraph);
  useCellGraphTools(`graphing_complex_${cellId}`, graph);
  const ids = cellIdsComplex(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const exprText = useCell<string>(graph, ids.exprText);
  const parseResult = useCell<Result<Expr>>(graph, ids.parseResult);
  const probeRe = useCell<string>(graph, ids.probeRe);
  const probeIm = useCell<string>(graph, ids.probeIm);
  const probeResult = useCell<Result<ProbeReading>>(graph, ids.probeResult);
  const showRootsOfUnity = useCell<boolean>(graph, ids.showRootsOfUnity);
  const rootsN = useCell<string>(graph, ids.rootsN);
  const rootsResult = useCell<Result<ComplexNumber[]>>(graph, ids.rootsResult);
  const showConformalGrid = useCell<boolean>(graph, ids.showConformalGrid);
  const conformalGridType = useCell<ConformalGridType>(graph, ids.conformalGridType);
  const conformalGridSpacing = useCell<string>(graph, ids.conformalGridSpacing);
  const conformalGridResult = useCell<Result<ConformalGridReading>>(graph, ids.conformalGridResult);
  const showZeros = useCell<boolean>(graph, ids.showZeros);
  const zerosResult = useCell<Result<ComplexNumber[]>>(graph, ids.zerosResult);
  const showPoles = useCell<boolean>(graph, ids.showPoles);
  const polesResult = useCell<Result<ComplexNumber[]>>(graph, ids.polesResult);
  const freeVars = useCell<string[]>(graph, ids.freeVars);
  const params = useCell<Record<string, number>>(graph, ids.params);

  // Seeds a slider cell for each newly-discovered free variable -- mirrors
  // GraphCanvas's identically-reasoned effect (must run after render, not
  // inline in `params`'s compute, or it trips React's "update during render"
  // guard).
  useEffect(() => {
    for (const name of freeVars) {
      const id = ids.param(name);
      if (!graph.hasValue(id)) graph.set(id, defaultSliderRange(name).default);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, freeVars]);

  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const saveGraphFn = useServerFn(saveGraph);

  async function handleSave() {
    const title = window.prompt("Title for this saved complex-plane setup:", "Untitled");
    if (title === null) return;
    setSaveStatus("Saving…");
    try {
      await saveGraphFn({ data: { title, kind: "complex", state: getCurrentComplexState(graph, ids) } });
      setSaveStatus(`Saved as "${title || "Untitled"}" — see the gallery to reopen it.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const [exprInput, setExprInput] = useState(exprText);
  // Keeps the input box in sync when exprText changes for a reason other
  // than typing in this box -- e.g. URL-hash hydration -- mirrors
  // GraphCanvas/TaylorPanel's identically-reasoned effect.
  useEffect(() => {
    setExprInput(exprText);
  }, [exprText]);

  function updateExprText(value: string) {
    setExprInput(value);
    graph.set(ids.exprText, resolveNaturalLanguageQuery(value, "z") ?? value);
  }

  useEffect(() => {
    if (!syncUrl) return;
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeComplexState(getCurrentComplexState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, syncUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!parseResult.ok) return;
    const expr = parseResult.value;
    renderDomainColoring(ctx, WIDTH, HEIGHT, VIEWPORT, (z) => evaluateComplex(expr, complexParamEnv(params, z)));
    if (showRootsOfUnity && rootsResult.ok) {
      const points = rootsResult.value.map((r) => ({ x: r.value, y: r.iValue }));
      drawScatter(ctx, points, VIEWPORT, WIDTH, HEIGHT, 6, "#111827");
    }
    if (showConformalGrid && conformalGridResult.ok) {
      for (const line of conformalGridResult.value.zLines) drawPolyline(ctx, line, VIEWPORT, WIDTH, HEIGHT, "rgba(255,255,255,0.6)");
    }
    if (showZeros && zerosResult.ok) {
      const points = zerosResult.value.map((r) => ({ x: r.value, y: r.iValue }));
      drawScatter(ctx, points, VIEWPORT, WIDTH, HEIGHT, 5, "#16a34a");
    }
    if (showPoles && polesResult.ok) {
      const points = polesResult.value.map((r) => ({ x: r.value, y: r.iValue }));
      drawScatter(ctx, points, VIEWPORT, WIDTH, HEIGHT, 5, "#dc2626");
    }
  }, [parseResult, showRootsOfUnity, rootsResult, showConformalGrid, conformalGridResult, showZeros, zerosResult, showPoles, polesResult, params]);

  useEffect(() => {
    const canvas = wCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!showConformalGrid || !conformalGridResult.ok) return;
    const { wLines, wViewport } = conformalGridResult.value;
    for (const line of wLines) drawPolyline(ctx, line, wViewport, WIDTH, HEIGHT, "#2563eb");
  }, [showConformalGrid, conformalGridResult]);

  return (
    <div>
      <h2>Domain coloring of f(z)</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        Hue = arg(f(z)), lightness = log-scaled |f(z)| (black at zeros, white at poles, mid-gray at |f(z)|=1).
      </p>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          f(z) ={" "}
          <input value={exprInput} onChange={(e) => updateExprText(e.target.value)} style={{ font: "inherit", width: "20ch" }} />
        </label>
      </div>
      {!parseResult.ok && <p style={{ color: "var(--danger)" }}>{parseResult.message}</p>}
      {freeVars.length > 0 && (
        <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          {freeVars.map((name) => (
            <ComplexParamSlider key={name} graph={graph} paramId={ids.param(name)} name={name} />
          ))}
        </div>
      )}

      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          <input
            type="checkbox"
            checked={showRootsOfUnity}
            onChange={(e) => graph.set(ids.showRootsOfUnity, e.target.checked)}
          />{" "}
          show n-th roots of unity
        </label>
        <label>
          n:{" "}
          <input
            type="number"
            min={1}
            value={rootsN}
            onChange={(e) => graph.set(ids.rootsN, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
            disabled={!showRootsOfUnity}
          />
        </label>
      </div>
      {showRootsOfUnity && !rootsResult.ok && <p style={{ color: "var(--danger)" }}>{rootsResult.message}</p>}

      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          <input
            type="checkbox"
            checked={showConformalGrid}
            onChange={(e) => graph.set(ids.showConformalGrid, e.target.checked)}
          />{" "}
          show conformal grid mapping
        </label>
        <label>
          grid:{" "}
          <select
            value={conformalGridType}
            onChange={(e) => graph.set(ids.conformalGridType, e.target.value as ConformalGridType)}
            disabled={!showConformalGrid}
          >
            <option value="rectangular">rectangular</option>
            <option value="polar">polar</option>
          </select>
        </label>
        <label>
          spacing:{" "}
          <input
            type="number"
            min={0.05}
            step={0.05}
            value={conformalGridSpacing}
            onChange={(e) => graph.set(ids.conformalGridSpacing, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
            disabled={!showConformalGrid}
          />
        </label>
      </div>
      {showConformalGrid && !conformalGridResult.ok && <p style={{ color: "var(--danger)" }}>{conformalGridResult.message}</p>}

      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ color: "#16a34a" }}>
          <input type="checkbox" checked={showZeros} onChange={(e) => graph.set(ids.showZeros, e.target.checked)} /> show zeros of f(z)
        </label>
        <label style={{ color: "#dc2626" }}>
          <input type="checkbox" checked={showPoles} onChange={(e) => graph.set(ids.showPoles, e.target.checked)} /> show poles of f(z)
        </label>
      </div>
      {showZeros && !zerosResult.ok && <p style={{ color: "var(--danger)" }}>{zerosResult.message}</p>}
      {showPoles && !polesResult.ok && <p style={{ color: "var(--danger)" }}>{polesResult.message}</p>}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
        {showConformalGrid && (
          <div>
            <canvas ref={wCanvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
              Image of the grid under f(z), z-plane on the left → w-plane on the right (auto-fit window).
            </p>
            <div style={{ margin: "0.25rem 0" }}>
              <PngExportButton getCanvas={() => wCanvasRef.current} label="complex-plane-w" />{" "}
              <SvgExportButton
                getSvg={() => {
                  if (!conformalGridResult.ok) return null;
                  const { wLines, wViewport } = conformalGridResult.value;
                  return polylinesToSvgDocument(wLines, wViewport, WIDTH, HEIGHT, "#2563eb");
                }}
                label="complex-plane-w"
              />
            </div>
          </div>
        )}
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="complex-plane" />
      </div>

      <h3>Probe a point</h3>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          re(z): <input value={probeRe} onChange={(e) => graph.set(ids.probeRe, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
        </label>
        <label>
          im(z): <input value={probeIm} onChange={(e) => graph.set(ids.probeIm, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
        </label>
      </div>
      {probeResult.ok ? (
        <p>
          f({probeRe}{Number(probeIm) >= 0 ? "+" : ""}{probeIm}i) = {probeResult.value.re.toFixed(4)}
          {probeResult.value.im >= 0 ? "+" : ""}
          {probeResult.value.im.toFixed(4)}i (|f(z)| = {probeResult.value.magnitude.toFixed(4)}, arg = {probeResult.value.angle.toFixed(4)})
        </p>
      ) : (
        <p style={{ color: "var(--danger)" }}>{probeResult.message}</p>
      )}

      {syncUrl && (
        <div style={{ margin: "0.5rem 0" }}>
          <button type="button" onClick={handleSave}>
            Save to gallery
          </button>
          {saveStatus && <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{saveStatus}</p>}
        </div>
      )}
    </div>
  );
}

function ComplexParamSlider({ graph, paramId, name }: { graph: CellGraph; paramId: string; name: string }) {
  const range = defaultSliderRange(name);
  const value = useCell<number>(graph, paramId) ?? range.default;
  return (
    <label style={{ fontSize: "0.85rem" }}>
      {name} ={" "}
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => graph.set(paramId, Number(e.target.value))}
      />{" "}
      {value.toFixed(2)}
    </label>
  );
}
