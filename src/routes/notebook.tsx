import { createFileRoute, Link } from "@tanstack/react-router";
import { LegacyBanner } from "../components/LegacyBanner.tsx";
import { NotebookPanel } from "../components/NotebookPanel.tsx";

export const Route = createFileRoute("/notebook")({
  component: NotebookPage,
});

function NotebookPage() {
  return (
    <div>
      <h1>mallory — notebook</h1>
      <details>
        <summary>A reactive document mixing free-form text with live graph cells, built on CellGraph.</summary>
        <p>
          The biggest single item from the feature-adoption research. Every graph cell and named "value" cell below
          shares one <code>CellGraph</code>, so a graph cell's free variable can reference an earlier value cell by
          name -- add a value block named e.g. <code>k</code>, then a graph cell plotting <code>k*sin(x)</code>{" "}
          sources <code>k</code> live from that value cell instead of getting its own independent slider. v1 only
          supports referencing a named scalar this way, not another graph cell's entire curve/function. The whole
          document (every block, in order, with each graph cell's rows/viewport) lives in the URL, so reload
          restores it exactly, "Fork this view" opens the same document in a new tab to explore an alternate path
          independently, and "Save to gallery" adds it to the same shared gallery <code>/multi</code> saves to.
        </p>
      </details>
      <p>
        <Link to="/demos">← back</Link>
      </p>
      <LegacyBanner to="/notes" label="Notebook" />
      <NotebookPanel />
    </div>
  );
}
