import { createFileRoute, Link } from "@tanstack/react-router";
import { LegacyBanner } from "../components/LegacyBanner.tsx";
import { RegressionPanel } from "../components/RegressionPanel.tsx";

export const Route = createFileRoute("/regression")({
  component: RegressionPage,
});

function RegressionPage() {
  return (
    <div>
      <h1>mallory — regression</h1>
      <details>
        <summary>Linear or nonlinear regression over a spreadsheet-style (x, y) row list.</summary>
        <p>
          Linear is via <code>mallory-math</code>'s <code>Statistics.linearRegression</code>/<code>correlation</code>.
          Nonlinear fits any custom model you type (e.g. <code>a*exp(b*x)</code>) via{" "}
          <code>Numerical.levenbergMarquardt</code> -- a damped Gauss-Newton fit starting from the initial guess
          shown beside each parameter, with the fitted curve resampled and redrawn over the current view.
        </p>
      </details>
      <p>
        <Link to="/demos">← back</Link>
      </p>
      <LegacyBanner to="/data" label="Data & Algebra" />
      <RegressionPanel />
    </div>
  );
}
