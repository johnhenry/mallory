#!/usr/bin/env python3
"""SciPy/SymPy verification oracle for mallory's own numeric samplers
(issue #41's remaining "differential oracles for the samplers" item) --
@johnhenry/math's proven subprocess-oracle pattern (packages/math/scripts/sympy_oracle.py),
reapplied here against mallory's OWN wiring (sampleOdeSolution,
Symbolic.integrateDefinite as GraphCanvas's area-under-curve cell calls it),
not just @johnhenry/math's bare primitives.

Protocol (batch -- SymPy import dominates startup): a JSON object
{"jobs": [...]} on stdin, {"results": [...]} on stdout, one result per job.
Each job carries @johnhenry/math's Expr AST verbatim (the same plain JSON
discriminated union sympy_oracle.py consumes -- verified empirically to be
byte-identical to what mallory's own `Symbolic.parse` produces, since
both import the same published @johnhenry/math package).

Jobs:
  {"op": "ode_ivp", "expr": E, "x0": a, "y0": b, "eval_xs": [...]}
      dy/dx = E(x, y), y(x0) = y0, forward-only (every eval_x must be >= x0
      -- mallory's sampleOdeSolution also walks backward via a time-
      reversal substitution, but that's the same RK4 code path mirrored, not
      independently worth re-deriving in the oracle).
  {"op": "integrate_definite", "expr": E, "variable": v, "lower": a, "upper": b}

Results:
  ode_ivp -> {"values": [float, ...]} (one per eval_x, via scipy's dense
      output interpolant, or {"error": ...} if the solver fails)
  integrate_definite -> {"value": float}
Any per-job failure -> {"error": "message"} in that slot; the batch never dies.
"""
import json
import sys

import sympy as sp
from scipy.integrate import solve_ivp

UNARY = {
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan,
    "exp": sp.exp, "ln": sp.log, "sqrt": sp.sqrt,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan,
    "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
    "abs": sp.Abs,
}

CALL2 = {
    "atan2": sp.atan2,
    "hypot": lambda l, r: sp.sqrt(l**2 + r**2),
    "min": lambda l, r: sp.Min(l, r), "max": lambda l, r: sp.Max(l, r),
}


def build(e):
    t = e["type"]
    if t == "const":
        return sp.Float(e["value"]) if e["value"] != int(e["value"]) else sp.Integer(int(e["value"]))
    if t == "var":
        return sp.Symbol(e["name"], real=True)
    if t == "add":
        return build(e["left"]) + build(e["right"])
    if t == "sub":
        return build(e["left"]) - build(e["right"])
    if t == "mul":
        return build(e["left"]) * build(e["right"])
    if t == "div":
        return build(e["left"]) / build(e["right"])
    if t == "pow":
        return build(e["base"]) ** build(e["exp"])
    if t == "neg":
        return -build(e["arg"])
    if t == "func":
        fn = UNARY.get(e["name"])
        if fn is None:
            raise ValueError(f"no SymPy translation for func {e['name']!r}")
        return fn(build(e["arg"]))
    if t == "call2":
        fn = CALL2.get(e["name"])
        if fn is None:
            raise ValueError(f"no SymPy translation for call2 {e['name']!r}")
        return fn(build(e["left"]), build(e["right"]))
    raise ValueError(f"no SymPy translation for Expr type {t!r}")


def run_ode_ivp(job):
    x, y = sp.symbols("x y", real=True)
    rhs = build(job["expr"])
    f = sp.lambdify((x, y), rhs, "math")
    eval_xs = job["eval_xs"]
    x0 = job["x0"]
    if any(xv < x0 for xv in eval_xs):
        raise ValueError("ode_ivp is forward-only: every eval_x must be >= x0")
    sol = solve_ivp(
        lambda t, state: [f(t, state[0])],
        [x0, max(eval_xs)],
        [job["y0"]],
        method="RK45",
        dense_output=True,
        rtol=1e-10,
        atol=1e-12,
    )
    if not sol.success:
        return {"error": f"solve_ivp failed: {sol.message}"}
    values = [float(sol.sol(xv)[0]) for xv in eval_xs]
    return {"values": values}


def run_integrate_definite(job):
    v = sp.Symbol(job["variable"], real=True)
    expr = build(job["expr"])
    value = sp.integrate(expr, (v, job["lower"], job["upper"]))
    return {"value": float(value.evalf())}


def run_job(job):
    op = job["op"]
    if op == "ode_ivp":
        return run_ode_ivp(job)
    if op == "integrate_definite":
        return run_integrate_definite(job)
    raise ValueError(f"unknown op {op!r}")


def main():
    batch = json.load(sys.stdin)
    results = []
    for job in batch["jobs"]:
        try:
            results.append(run_job(job))
        except Exception as e:  # per-job isolation: one bad job never kills the batch
            results.append({"error": f"{type(e).__name__}: {e}"})
    json.dump({"results": results}, sys.stdout)


if __name__ == "__main__":
    main()
