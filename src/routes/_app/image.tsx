import { createFileRoute } from "@tanstack/react-router";
import { ImageFrequencyPanel } from "~/components/ImageFrequencyPanel.tsx";

export const Route = createFileRoute("/_app/image")({
  component: ImagePage,
});

function ImagePage() {
  return (
    <div>
      <div className="page-head">
        <p className="page-eyebrow">Image</p>
        <h1>2D Fourier analysis, made tangible.</h1>
        <p className="lede">Pick a pattern, see its centered magnitude spectrum, paint a mask, and watch the filtered image invert back.</p>
      </div>
      <ImageFrequencyPanel />
    </div>
  );
}
