import { createFileRoute, Link } from "@tanstack/react-router";
import { LegacyBanner } from "../components/LegacyBanner.tsx";
import { LinkedGraphPanes } from "../components/LinkedGraphPanes.tsx";

export const Route = createFileRoute("/linked")({
  component: LinkedPage,
});

function LinkedPage() {
  return (
    <div>
      <h1>mallory — linked panes</h1>
      <details>
        <summary>Two panes, one shared clock.</summary>
        <p>Play or scrub the left pane's timeline and both curves advance together.</p>
      </details>
      <p>
        <Link to="/demos">← back</Link>
      </p>
      <LegacyBanner to="/graphing" label="Graphing" />
      <LinkedGraphPanes />
    </div>
  );
}
