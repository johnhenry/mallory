import type { Path2D } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsOde2, type CellIdsOde2 } from "../lib/cell-ids.ts";
import { drawPath, type Viewport } from "../lib/render-path.ts";
import {
  attemptOde2ndOrderClosedForm,
  type Ode2ndOrderClosedFormAttempt,
  sampleOde2ndOrderSolution,
} from "../lib/sample-ode.ts";
import { DEFAULT_ODE2_STATE, decodeOde2State, encodeOde2State, type Ode2State } from "../lib/ode2-state.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { CopyableTex } from "./CopyableTex.tsx";

type SolutionResult = { ok: true; path: Path2D } | { ok: false; message: string };

const WIDTH = 500;
const HEIGHT = 500;

const ROOT_CASE_LABEL: Record<string, string> = {
  "distinct-real": "Overdamped — two distinct real roots",
  repeated: "Critically damped — repeated root",
  complex: "Underdamped — complex conjugate roots",
};

/** a=1 throughout: b/c chosen so disc = b²-4c lands solidly in each case, all with the same y0=1, y'0=0 (released from rest) so the three curves are visually comparable. */
const PRESETS: Array<{ label: string; a: string; b: string; c: string }> = [
  { label: "Underdamped", a: "1", b: "0.4", c: "4" },
  { label: "Critically damped", a: "1", b: "4", c: "4" },
  { label: "Overdamped", a: "1", b: "5", c: "4" },
];

function seedOde2State(graph: CellGraph, ids: CellIdsOde2, state: Ode2State): void {
  graph.set(ids.a, state.a);
  graph.set(ids.b, state.b);
  graph.set(ids.c, state.c);
  graph.set(ids.x0, state.x0);
  graph.set(ids.y0, state.y0);
  graph.set(ids.yPrime0, state.yPrime0);
  graph.set(ids.xMin, state.xMin);
  graph.set(ids.xMax, state.xMax);
  graph.set(ids.yMin, state.yMin);
  graph.set(ids.yMax, state.yMax);
}

function getCurrentOde2State(graph: CellGraph, ids: CellIdsOde2): Ode2State {
  return {
    v: 1,
    a: graph.get<string>(ids.a),
    b: graph.get<string>(ids.b),
    c: graph.get<string>(ids.c),
    x0: graph.get<string>(ids.x0),
    y0: graph.get<string>(ids.y0),
    yPrime0: graph.get<string>(ids.yPrime0),
    xMin: graph.get<string>(ids.xMin),
    xMax: graph.get<string>(ids.xMax),
    yMin: graph.get<string>(ids.yMin),
    yMax: graph.get<string>(ids.yMax),
  };
}

function useOde2Graph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsOde2(cellId);
    const decoded = typeof window !== "undefined" ? decodeOde2State(window.location.hash.slice(1)) : null;
    seedOde2State(graph, ids, decoded ?? DEFAULT_ODE2_STATE);

    graph.define(ids.solution, (): SolutionResult => {
      try {
        const a = Number(graph.get<string>(ids.a));
        const b = Number(graph.get<string>(ids.b));
        const c = Number(graph.get<string>(ids.c));
        const x0 = Number(graph.get<string>(ids.x0));
        const y0 = Number(graph.get<string>(ids.y0));
        const yPrime0 = Number(graph.get<string>(ids.yPrime0));
        const xMin = Number(graph.get<string>(ids.xMin));
        const xMax = Number(graph.get<string>(ids.xMax));
        if ([a, b, c, x0, y0, yPrime0, xMin, xMax].some(Number.isNaN)) throw new Error("Every field must be a number.");
        if (xMin >= xMax) throw new Error("x-min must be less than x-max.");
        if (a === 0) throw new Error("a must be nonzero -- otherwise this isn't a second-order equation.");
        const path = sampleOde2ndOrderSolution({ a, b, c }, x0, y0, yPrime0, { min: xMin, max: xMax });
        return { ok: true, path };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.closedForm, (): Ode2ndOrderClosedFormAttempt => {
      const a = Number(graph.get<string>(ids.a));
      const b = Number(graph.get<string>(ids.b));
      const c = Number(graph.get<string>(ids.c));
      const x0 = Number(graph.get<string>(ids.x0));
      const y0 = Number(graph.get<string>(ids.y0));
      const yPrime0 = Number(graph.get<string>(ids.yPrime0));
      if ([a, b, c, x0, y0, yPrime0].some(Number.isNaN)) return { found: false, message: "Every field must be a number." };
      return attemptOde2ndOrderClosedForm({ a, b, c }, x0, y0, yPrime0);
    });

    ref.current = graph;
  }
  return ref.current;
}

/** a*y'' + b*y' + c*y = 0, y(x0)=y0, y'(x0)=yPrime0 -- closed form (Symbolic.solveOde2ndOrderConstCoeff) plotted against its RK4 numeric trajectory as a built-in self-check; the two should visually overlap. */
export function Ode2Panel({ cellId = "ode2-1" }: { cellId?: string } = {}) {
  const graph = useOde2Graph(cellId);
  useCellGraphTools(`calculus_ode2_${cellId}`, graph);
  const ids = cellIdsOde2(cellId);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const a = useCell<string>(graph, ids.a);
  const b = useCell<string>(graph, ids.b);
  const c = useCell<string>(graph, ids.c);
  const x0 = useCell<string>(graph, ids.x0);
  const y0 = useCell<string>(graph, ids.y0);
  const yPrime0 = useCell<string>(graph, ids.yPrime0);
  const xMin = useCell<string>(graph, ids.xMin);
  const xMax = useCell<string>(graph, ids.xMax);
  const yMin = useCell<string>(graph, ids.yMin);
  const yMax = useCell<string>(graph, ids.yMax);
  const solution = useCell<SolutionResult>(graph, ids.solution);
  const closedForm = useCell<Ode2ndOrderClosedFormAttempt>(graph, ids.closedForm);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeOde2State(getCurrentOde2State(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const viewport: Viewport = {
    xMin: Number(xMin) || -5,
    xMax: Number(xMax) || 5,
    yMin: Number(yMin) || -5,
    yMax: Number(yMax) || 5,
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (solution.ok) drawPath(ctx, solution.path, viewport, WIDTH, HEIGHT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solution, xMin, xMax, yMin, yMax]);

  function applyPreset(preset: (typeof PRESETS)[number]) {
    graph.set(ids.a, preset.a);
    graph.set(ids.b, preset.b);
    graph.set(ids.c, preset.c);
  }

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        {PRESETS.map((preset) => (
          <button key={preset.label} type="button" onClick={() => applyPreset(preset)} style={{ marginRight: "0.5rem" }}>
            {preset.label}
          </button>
        ))}
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          <input value={a} onChange={(e) => graph.set(ids.a, e.target.value)} style={{ font: "inherit", width: "5ch" }} />
          {" y'' + "}
          <input value={b} onChange={(e) => graph.set(ids.b, e.target.value)} style={{ font: "inherit", width: "5ch" }} />
          {" y' + "}
          <input value={c} onChange={(e) => graph.set(ids.c, e.target.value)} style={{ font: "inherit", width: "5ch" }} />
          {" y = 0"}
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          y(
          <input value={x0} onChange={(e) => graph.set(ids.x0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ) ={" "}
          <input value={y0} onChange={(e) => graph.set(ids.y0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>{" "}
        <label>
          y'(
          <input value={x0} readOnly style={{ font: "inherit", width: "6ch" }} />
          ) ={" "}
          <input value={yPrime0} onChange={(e) => graph.set(ids.yPrime0, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          x: [<input value={xMin} onChange={(e) => graph.set(ids.xMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ,{" "}
          <input value={xMax} onChange={(e) => graph.set(ids.xMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>{" "}
        <label>
          y: [<input value={yMin} onChange={(e) => graph.set(ids.yMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ,{" "}
          <input value={yMax} onChange={(e) => graph.set(ids.yMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
      </div>
      {closedForm.found ? (
        <p style={{ margin: "0.25rem 0" }}>
          Closed form: <CopyableTex tex={`y = ${closedForm.latex}`} />
          <br />
          <span style={{ fontSize: "0.85rem", color: "#5b6b8c" }}>
            Discriminant b² − 4ac = {closedForm.discriminant?.toFixed(4)} — {ROOT_CASE_LABEL[closedForm.rootCase ?? ""]}
          </span>
        </p>
      ) : (
        closedForm.message && <p style={{ color: "crimson" }}>{closedForm.message}</p>
      )}
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid #ccc" }} />
      {!solution.ok && <p style={{ color: "crimson" }}>{solution.message}</p>}
    </div>
  );
}
