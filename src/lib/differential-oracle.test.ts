/**
 * SciPy/SymPy verification oracle for mallory-graph's own numeric samplers
 * (issue #41's remaining "differential oracles for the samplers" item) --
 * mallory-ts's proven subprocess-oracle pattern applied to mallory-graph's
 * OWN wiring: `sampleOdeSolution` (the ODE panel's RK4 trajectory) against
 * scipy.integrate.solve_ivp, and `Symbolic.integrateDefinite` exactly as
 * GraphCanvas's area-under-curve cell calls it (see GraphCanvas.tsx's
 * `ids.area` definition) against SymPy's definite integrals.
 *
 * Oracle resolution: $MALLORY_GRAPH_ORACLE_PYTHON, else `python3` on PATH;
 * skip-don't-fail when no python with scipy+sympy is importable. On NixOS:
 *   nix-shell -p "python3.withPackages(ps: [ps.sympy ps.scipy])" --run "which python3"
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { Symbolic } from "mallory-math";
import { sampleOdeSolution } from "./sample-ode.ts";

const HERE = new URL(".", import.meta.url).pathname;
const ORACLE = join(HERE, "../../scripts/differential-oracle.py");

const PYTHON = process.env.MALLORY_GRAPH_ORACLE_PYTHON ?? "python3";
let SKIP_REASON: string | undefined;
try {
  execFileSync(PYTHON, ["-c", "import scipy.integrate, sympy"], { stdio: "ignore" });
} catch {
  SKIP_REASON =
    `no python with scipy+sympy (tried ${JSON.stringify(PYTHON)}) — set $MALLORY_GRAPH_ORACLE_PYTHON; ` +
    `on NixOS: nix-shell -p "python3.withPackages(ps: [ps.sympy ps.scipy])" --run "which python3"`;
}

interface OracleResult {
  values?: number[];
  value?: number;
  error?: string;
}

function runOracle(jobs: object[]): OracleResult[] {
  const out = execFileSync(PYTHON, [ORACLE], {
    input: JSON.stringify({ jobs }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return (JSON.parse(out) as { results: OracleResult[] }).results;
}

const RTOL = 1e-4;
const ATOL = 1e-6;
function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= ATOL + RTOL * Math.max(Math.abs(a), Math.abs(b));
}

test("sampleOdeSolution's RK4 trajectory agrees with scipy.integrate.solve_ivp on a fixed forward-IVP problem set", { skip: SKIP_REASON }, () => {
  const cases: Array<{ expr: string; x0: number; y0: number; domain: { min: number; max: number } }> = [
    { expr: "y", x0: 0, y0: 1, domain: { min: 0, max: 3 } }, // dy/dx=y -> exponential growth
    { expr: "-y", x0: 0, y0: 1, domain: { min: 0, max: 3 } }, // dy/dx=-y -> decay
    { expr: "cos(x)", x0: 0, y0: 0, domain: { min: 0, max: 2 * Math.PI } }, // dy/dx=cos(x) -> sin(x)
    { expr: "x*y", x0: 0, y0: 1, domain: { min: 0, max: 2 } }, // dy/dx=x*y -> e^(x^2/2)
  ];
  // Sample x0 itself, mid-run, and the domain end from each trajectory --
  // spans the RK4 run without needing every one of its 201 points.
  const SAMPLE_INDICES = [0, 50, 100, 150, 200];

  const perCaseXs: number[][] = [];
  const perCaseYs: number[][] = [];
  for (const c of cases) {
    const path = sampleOdeSolution(c.expr, c.x0, c.y0, c.domain, 200);
    const xs = SAMPLE_INDICES.map((i) => path.commands[i]?.x as number);
    const ys = SAMPLE_INDICES.map((i) => path.commands[i]?.y as number);
    perCaseXs.push(xs);
    perCaseYs.push(ys);
  }

  const jobs = cases.map((c, i) => ({
    op: "ode_ivp",
    expr: Symbolic.parse(c.expr),
    x0: c.x0,
    y0: c.y0,
    eval_xs: perCaseXs[i],
  }));
  const results = runOracle(jobs);

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i] as (typeof cases)[number];
    const r = results[i] as OracleResult;
    assert.ok(!r.error, `scipy failed on dy/dx=${c.expr}: ${r.error}`);
    const oracleYs = r.values as number[];
    const malloryYs = perCaseYs[i] as number[];
    for (let j = 0; j < oracleYs.length; j++) {
      assert.ok(
        close(malloryYs[j] as number, oracleYs[j] as number),
        `dy/dx=${c.expr}, y(${c.x0})=${c.y0}: at x=${(perCaseXs[i] as number[])[j]}: mallory=${malloryYs[j]} scipy=${oracleYs[j]}`,
      );
    }
  }
});

test("GraphCanvas's area-under-curve value (Symbolic.integrateDefinite) agrees with SymPy's definite integrals", { skip: SKIP_REASON }, () => {
  const cases: Array<{ expr: string; lower: number; upper: number }> = [
    { expr: "x^2", lower: 0, upper: 2 },
    { expr: "sin(x)", lower: 0, upper: Math.PI },
    { expr: "exp(-x)", lower: 0, upper: 5 },
    { expr: "x^3 - 2*x + 1", lower: -1, upper: 3 },
    { expr: "sqrt(x)", lower: 0, upper: 4 },
  ];
  const results = runOracle(
    cases.map((c) => ({ op: "integrate_definite", expr: Symbolic.parse(c.expr), variable: "x", lower: c.lower, upper: c.upper })),
  );
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i] as (typeof cases)[number];
    const r = results[i] as OracleResult;
    assert.ok(!r.error, `sympy failed on ${c.expr}: ${r.error}`);
    // The exact call GraphCanvas.tsx's `ids.area` cell makes (AXIS_VARIABLE="x", no extra params).
    const value = Symbolic.integrateDefinite(c.expr, c.lower, c.upper, "x", {});
    assert.ok(
      close(value, r.value as number),
      `∫[${c.lower},${c.upper}] ${c.expr}: mallory=${value} sympy=${r.value}`,
    );
  }
});
