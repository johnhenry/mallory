import { createFileRoute } from "@tanstack/react-router";
import { PracticePanel } from "~/components/PracticePanel.tsx";

export const Route = createFileRoute("/_app/practice")({
  component: PracticePage,
});

function PracticePage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Practice</p>
        <h1>Find the antiderivative.</h1>
        <p className="lede">A random integration problem from a 152-problem practice corpus -- check your answer, or reveal it.</p>
      </div>
      <PracticePanel />
    </div>
  );
}
