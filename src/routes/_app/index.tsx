import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});

const CARDS: Array<{ to: string; title: string; description: string }> = [
  { to: "/calculator", title: "Calculator", description: "Quick arithmetic and expressions — no plot, no viewport, just an answer." },
  { to: "/graphing", title: "Graphing", description: "Multi-expression plots, implicit relations, and parametric & polar curves." },
  { to: "/3d", title: "3D & Surfaces", description: "z = f(x, y) meshes paired live with their 2D cross-section." },
  { to: "/geo", title: "Geometry", description: "Compass-and-straightedge constructions with live dependent objects." },
  { to: "/calculus", title: "Calculus", description: "Single ODEs and coupled systems, slope fields, closed-form solving." },
  { to: "/data", title: "Data & Algebra", description: "Regression, descriptive statistics, and equation-system solving." },
  { to: "/signal", title: "Signal", description: "Compose a waveform and see its FFT amplitude spectrum, reactively linked." },
  { to: "/image", title: "Image", description: "2D Fourier analysis: centered magnitude spectrum, a parametric mask, and the filtered result inverted back." },
  { to: "/ml", title: "ML", description: "Train a tiny seeded MLP in-browser on toy datasets -- decision boundary and loss curve, fully reproducible." },
  { to: "/practice", title: "Practice", description: "Random integration problems from a 152-problem corpus -- check your answer, or reveal it." },
  { to: "/notes", title: "Notebook", description: "Mix text and live graph cells in one reactive document." },
  { to: "/gallery", title: "Gallery", description: "Every graph and notebook you've saved, in one place." },
];

function DashboardPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">mallory-graph</p>
        <h1>Twelve tools, one reactive core.</h1>
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
