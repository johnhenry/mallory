import { createFileRoute } from "@tanstack/react-router";
import { SignalPanel } from "~/components/SignalPanel.tsx";

export const Route = createFileRoute("/_app/signal")({
  component: SignalPage,
});

function SignalPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Signal</p>
        <h1>Compose, transform, analyze.</h1>
        <p className="lede">A waveform and its FFT amplitude spectrum, reactively linked.</p>
      </div>
      <SignalPanel />
    </div>
  );
}
