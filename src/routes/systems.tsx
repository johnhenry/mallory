import { createFileRoute, Link } from "@tanstack/react-router";
import { LegacyBanner } from "../components/LegacyBanner.tsx";
import { SystemSolverPanel } from "../components/SystemSolverPanel.tsx";

export const Route = createFileRoute("/systems")({
  component: SystemsPage,
});

function SystemsPage() {
  return (
    <div>
      <h1>mallory — system of equations</h1>
      <details>
        <summary>Solves a system of equations, linear via Symbolic.solveSystem or nonlinear via a numeric fallback.</summary>
        <p>
          Bridging to <code>MatrixMath</code>'s LU-based solver for a linear system. A genuinely nonlinear system
          falls back to <code>Symbolic.solveSystemNumeric</code> (damped Newton's method) automatically, finding one
          root near its default initial guess -- a system with multiple solutions may not find every one, and a
          singular system still throws rather than returning a wrong answer. Add or remove equations freely -- just
          keep the equation count matching the variable count (a square system).
        </p>
      </details>
      <p>
        <Link to="/demos">← back</Link>
      </p>
      <LegacyBanner to="/data" label="Data & Algebra" />
      <SystemSolverPanel />
    </div>
  );
}
