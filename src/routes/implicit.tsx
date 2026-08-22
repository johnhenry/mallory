import { createFileRoute, Link } from "@tanstack/react-router";
import { ImplicitPanel } from "../components/ImplicitPanel.tsx";
import { LegacyBanner } from "../components/LegacyBanner.tsx";

export const Route = createFileRoute("/implicit")({
  component: ImplicitPage,
});

function ImplicitPage() {
  return (
    <div>
      <h1>mallory — implicit relations</h1>
      <details>
        <summary>Traces a two-variable relation like x^2+y^2=4 via marching squares.</summary>
        <p>
          Unlike every other view here, this plots a relation that isn't solved for <code>y</code>. v1 is a single
          relation over a fixed (non-pannable) domain. The saddle-case (ambiguous-crossing) resolution uses the
          standard asymptotic decider -- the cell-center average of the four corner values reveals which diagonal
          pair the contour actually separates -- rather than always connecting one fixed diagonal.
        </p>
      </details>
      <p>
        <Link to="/demos">← back</Link>
      </p>
      <LegacyBanner to="/graphing" label="Graphing" />
      <ImplicitPanel />
    </div>
  );
}
