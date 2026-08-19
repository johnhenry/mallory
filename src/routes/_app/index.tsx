import { createFileRoute, Link } from "@tanstack/react-router";
import { NAV_SECTIONS } from "../../lib/nav-sections.ts";

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});

// Curated blurb copy for each panel, keyed by route path. This is the ONLY
// hand-maintained list left for the dashboard grid -- which tools show up,
// and their order, comes from NAV_SECTIONS (the sidebar's own single source
// of truth, see nav-sections.ts) so the grid can't silently drift out of
// sync with the sidebar / route list the way it did before issue #249 (a
// newly-added panel would show up in the sidebar but never make it onto the
// dashboard). A panel added to NAV_SECTIONS without an entry here still
// renders, just with a generic fallback description below.
const CARD_DESCRIPTIONS: Record<string, string> = {
  "/calculator": "Quick arithmetic and expressions — no plot, no viewport, just an answer.",
  "/graphing": "Multi-expression plots, implicit relations, parametric & polar curves, and complex-plane domain coloring.",
  "/3d": "z = f(x, y) meshes paired live with their 2D cross-section.",
  "/geo": "Compass-and-straightedge constructions with live dependent objects.",
  "/calculus": "Single ODEs and coupled systems, slope fields, closed-form solving.",
  "/data": "Regression, descriptive statistics, and equation-system solving.",
  "/signal": "Compose a waveform and see its FFT amplitude spectrum, reactively linked.",
  "/image": "2D Fourier analysis: centered magnitude spectrum, a parametric mask, and the filtered result inverted back.",
  "/ml": "Train a tiny seeded MLP in-browser on toy or imported datasets, or classify a hand-drawn digit with a real ONNX model.",
  "/practice": "Random integration problems from a 152-problem corpus -- check your answer, or reveal it.",
  "/notes": "Mix text and live graph cells in one reactive document.",
  "/gallery": "Every graph and notebook you've saved, in one place.",
  "/workspace": "A shared variable graph any panel -- or an outside agent -- can read and write live.",
  "/tiles": "Wang-tile laboratory: edge-matching solvers (backtracking, SAT), symmetry expansion, entropy & diffraction analysis across square/hex/tri/cube lattices.",
  "/streaming-dataset": "Watch a live-updating dataset drive a chart in real time, point by point.",
  "/cellular-automata": "Step and animate 1D and 2D cellular automata rules, live.",
};

export const CARDS: Array<{ to: string; title: string; description: string }> = NAV_SECTIONS.filter(
  (section) => section.to !== "/",
).map((section) => ({
  to: section.to,
  title: section.label,
  description: CARD_DESCRIPTIONS[section.to] ?? `Open the ${section.label} tool.`,
}));

function DashboardPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">mallory-graph</p>
        <h1>{CARDS.length} tools, one reactive core.</h1>
        <p className="lede">
          Plot, construct, solve, and animate — every tool below shares the same underlying math engine, so a curve
          you build in Graphing can drive a surface in 3D or a slope field in Calculus.
        </p>
      </div>

      <div className="card-grid">
        {CARDS.map((card) => (
          <Link key={card.to} to={card.to} className="dashboard-card">
            <h3>{card.title}</h3>
            <p>{card.description}</p>
          </Link>
        ))}
      </div>

      <div className="demos-strip">
        Looking for an older single-purpose page? <Link to="/demos">Browse the legacy demo index →</Link>
      </div>
    </div>
  );
}
