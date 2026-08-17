/**
 * Issue #49's ONNX showcase demo: draw a digit, classify it with a real
 * MNIST model. A standalone demo with plain React state (no CellGraph) --
 * a drawn stroke and its prediction aren't "current calculator state"
 * worth bookmarking/sharing, matching the streaming-dataset panel's own
 * reasoning (issue #58).
 *
 * `mallory-adapter-onnx` (which pulls in onnxruntime-web's WASM payload)
 * is only imported by THIS file, which only loads on this route -- the
 * issue's "lazy-load it like the WebMCP polyfill" ask is already satisfied
 * by the router's own per-route code splitting, the same way every other
 * heavy per-panel dependency (Three.js, KaTeX, ...) in this app works,
 * without needing a bespoke dynamic-import gate.
 */
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { onnx, type OnnxModel } from "mallory-adapter-onnx";
import { env } from "onnxruntime-web";
import { canvasToMnistInput, rankDigitPredictions, type DigitPrediction } from "../lib/mnist-preprocess.ts";
import { canvasEventPoint } from "../lib/viewport.ts";

// onnxruntime-web's default multi-threaded WASM build needs SharedArrayBuffer,
// which requires COOP/COEP cross-origin-isolation response headers -- this
// app's server doesn't set them, and without them the threaded build hangs
// silently (a worker spins up and never reports back) rather than throwing.
// Single-threaded WASM has no such requirement and is plenty fast for a
// model this small.
env.wasm.numThreads = 1;
// Also disable proxying inference to a Web Worker -- ruled out as a second
// possible silent-hang source alongside the WebGPU probe above.
env.wasm.proxy = false;
// onnxruntime-web locates its own .wasm/.mjs runtime relative to wherever it
// guesses its own script came from, which doesn't resolve correctly once
// Vite has bundled it into a route chunk -- vendored under public/ort/ (the
// same "check the binary in, matching the mnist-8.onnx model" approach)
// and pointed at explicitly, rather than relying on that guess.
env.wasm.wasmPaths = "/ort/";

const PAD_SIZE = 280;
const STROKE_WIDTH = 18;
const MODEL_URL = "/models/mnist-8.onnx";

function paintBlank(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAD_SIZE, PAD_SIZE);
}

export function DigitClassifierPanel() {
  const padRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const modelRef = useRef<OnnxModel | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [predictions, setPredictions] = useState<DigitPrediction[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading-model" | "classifying" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctx = padRef.current?.getContext("2d");
    if (ctx) paintBlank(ctx);
    return () => {
      void modelRef.current?.release();
    };
  }, []);

  async function getModel(): Promise<OnnxModel> {
    if (modelRef.current) return modelRef.current;
    setStatus("loading-model");
    // Restricted to the wasm EP: onnxruntime-web otherwise also probes
    // webgpu/webnn first, and a WebGPU probe hangs indefinitely in
    // environments with no real GPU backend (see issue #48's own findings)
    // rather than failing fast, which would leave this stuck on "loading"
    // forever on exactly the machines least likely to have WebGPU at all.
    const model = await onnx.load(MODEL_URL, { executionProviders: ["wasm"] });
    modelRef.current = model;
    return model;
  }

  async function classify() {
    const canvas = padRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    setError(null);
    try {
      const model = await getModel();
      setStatus("classifying");
      const { data } = ctx.getImageData(0, 0, PAD_SIZE, PAD_SIZE);
      const input = canvasToMnistInput(data, PAD_SIZE, PAD_SIZE);
      const outputs = await model.run({ [model.inputNames[0]!]: input });
      const logits = outputs[model.outputNames[0]!];
      if (!logits) throw new Error("Model returned no output.");
      setPredictions(rankDigitPredictions(logits));
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  function strokeTo(sx: number, sy: number, moveTo: boolean) {
    const ctx = padRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (moveTo) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy);
    } else {
      ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, PAD_SIZE, PAD_SIZE);
    strokeTo(sx, sy, true);
    setHasDrawing(true);
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const { sx, sy } = canvasEventPoint(e, e.currentTarget, PAD_SIZE, PAD_SIZE);
    strokeTo(sx, sy, false);
  }

  function handlePointerUp(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    void classify();
  }

  function handleClear() {
    const ctx = padRef.current?.getContext("2d");
    if (ctx) paintBlank(ctx);
    setHasDrawing(false);
    setPredictions(null);
    setError(null);
  }

  const maxProbability = predictions ? Math.max(...predictions.map((p) => p.probability)) : 0;

  return (
    <div>
      <h2>Draw a digit</h2>
      <p style={{ color: "var(--muted)" }}>
        A real MNIST digit classifier, running entirely in the browser via <code>mallory-adapter-onnx</code> (onnxruntime-web) -- draw a
        digit 0-9 below and release to classify.
      </p>
      <canvas
        ref={padRef}
        width={PAD_SIZE}
        height={PAD_SIZE}
        style={{ border: "1px solid var(--border)", touchAction: "none", cursor: "crosshair", maxWidth: "100%" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div style={{ margin: "0.5rem 0", display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <button type="button" onClick={handleClear} disabled={!hasDrawing && !predictions}>
          Clear
        </button>
        {status === "loading-model" && <span style={{ color: "var(--muted)" }}>Loading model…</span>}
        {status === "classifying" && <span style={{ color: "var(--muted)" }}>Classifying…</span>}
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {predictions && (
        <div style={{ margin: "0.5rem 0" }}>
          {predictions.map((p) => (
            <div key={p.digit} style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.15rem 0" }}>
              <span style={{ width: "1.5ch", textAlign: "right", fontWeight: p.probability === maxProbability ? 700 : 400 }}>{p.digit}</span>
              <div style={{ flex: "1 1 auto", background: "var(--border-soft)", borderRadius: "3px", height: "1rem" }}>
                <div
                  style={{
                    width: `${(p.probability * 100).toFixed(1)}%`,
                    height: "100%",
                    background: p.probability === maxProbability ? "var(--accent)" : "var(--muted)",
                    borderRadius: "3px",
                  }}
                />
              </div>
              <span style={{ width: "5ch", fontSize: "0.85rem", color: "var(--muted)" }}>{(p.probability * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
