import { createFileRoute, Link } from "@tanstack/react-router";
import { LegacyBanner } from "../components/LegacyBanner.tsx";
import { StatisticsPanel } from "../components/StatisticsPanel.tsx";

export const Route = createFileRoute("/statistics")({
  component: StatisticsPage,
});

function StatisticsPage() {
  return (
    <div>
      <h1>mallory — statistics &amp; probability</h1>
      <details>
        <summary>Descriptive statistics plus an interval-probability calculator over five distributions.</summary>
        <p>
          Via <code>mallory-math</code>'s <code>Statistics</code> module (mean, median, standard deviation,
          five-number summary), plus <code>Distributions.normal</code>/<code>binomial</code>/<code>poisson</code>/
          <code>studentT</code>/<code>chiSquare</code> for interval probability — every distribution factory exposes
          the same <code>cdf(x)</code> shape regardless of continuous/discrete, so P(lower ≤ X ≤ upper) is computed
          identically across all five. An interactive draggable-marker axis (GeoGebra's Probability Calculator UX)
          is a later extension.
        </p>
      </details>
      <p>
        <Link to="/demos">← back</Link>
      </p>
      <LegacyBanner to="/data" label="Data & Algebra" />
      <StatisticsPanel />
    </div>
  );
}
