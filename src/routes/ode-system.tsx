import { createFileRoute, Link } from "@tanstack/react-router";
import { LegacyBanner } from "../components/LegacyBanner.tsx";
import { OdeSystemPanel } from "../components/OdeSystemPanel.tsx";

export const Route = createFileRoute("/ode-system")({
  component: OdeSystemPage,
});

function OdeSystemPage() {
  return (
    <div>
      <h1>mallory — system of differential equations</h1>
      <details>
        <summary>A coupled 2-variable first-order system, plotted as a phase portrait.</summary>
        <p>
          Via <code>Numerical.rk4</code>, which was already a vector-state (system) solver -- extending{" "}
          <Link to="/ode">/ode</Link>'s single-equation solver to two coupled equations dx/dt = f(x,y,t),
          dy/dt = g(x,y,t) only needed new glue code, not a new numerical method. v1 is fixed at 2 equations/2
          variables (the same scope cut <code>SystemSolverPanel</code> made for algebraic systems), with one
          trajectory from a single initial condition overlaid on a direction field sampled at t0 -- no
          multi-trajectory overlay, no animation.
        </p>
      </details>
      <p>
        <Link to="/demos">← back</Link>
      </p>
      <LegacyBanner to="/calculus" label="Calculus" />
      <OdeSystemPanel />
    </div>
  );
}
