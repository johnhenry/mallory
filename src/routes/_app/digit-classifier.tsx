import { createFileRoute } from "@tanstack/react-router";
import { DigitClassifierPanel } from "~/components/DigitClassifierPanel.tsx";

export const Route = createFileRoute("/_app/digit-classifier")({
  component: DigitClassifierPage,
});

function DigitClassifierPage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Digit classifier</p>
        <h1>Draw a digit, classify it live.</h1>
        <p className="lede">A gallery demo of the adapter-onnx path: a real MNIST model running in your browser.</p>
      </div>
      <DigitClassifierPanel />
    </div>
  );
}
