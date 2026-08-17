/**
 * Issue #49's preprocessing/postprocessing halves -- pure and testable,
 * unlike the actual ONNX inference (browser-only, onnxruntime-web).
 */
import { Tensor } from "mallory-tensor-core";
import { resize } from "mallory-image";
import { rgbaToGrayscaleGrid } from "./image-frequency.ts";

/**
 * Converts a hand-drawn canvas's raw RGBA pixels into the `[1,1,28,28]`
 * float32 input mnist-8.onnx expects: a single-channel image with white
 * digit strokes on a black background, pixel values in `[0,1]` (per the
 * model's own published README).
 *
 * The drawing pad itself renders black strokes on a white background (the
 * natural "pen and paper" convention) -- inverted here (`1 - v`) to match
 * MNIST's training-data convention instead.
 */
export function canvasToMnistInput(data: Uint8ClampedArray, width: number, height: number): Tensor {
  const grid = rgbaToGrayscaleGrid(data, width, height);
  const flat = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      flat[y * width + x] = 1 - grid[y]![x]! / 255;
    }
  }
  const full = Tensor.fromTypedArray(flat, [height, width, 1], { dtype: "f32" });
  const resized = resize(full, { height: 28, width: 28 }, { method: "bilinear" });
  // [28,28,1] -> [1,1,28,28]: for a single channel this is a pure metadata
  // reshape (identical flat element order), not a real transpose.
  return resized.contiguous().reshape([1, 1, 28, 28]);
}

export interface DigitPrediction {
  digit: number;
  probability: number;
}

/** Softmax over the model's raw `[1,10]`/`[10]` logits, ranked most-likely first. */
export function rankDigitPredictions(logits: Tensor): DigitPrediction[] {
  const probs = logits.reshape([10]).softmax(-1).contiguous();
  const values = Array.from(probs.data as Float32Array | Float64Array);
  return values.map((probability, digit) => ({ digit, probability })).sort((a, b) => b.probability - a.probability);
}
