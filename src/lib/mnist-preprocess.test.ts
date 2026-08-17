import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Tensor } from "mallory-tensor-core";
import { onnx, type OnnxModel } from "mallory-adapter-onnx";
import { canvasToMnistInput, rankDigitPredictions } from "./mnist-preprocess.ts";

const WIDTH = 280;
const HEIGHT = 280;

function blankCanvas(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  data.fill(255); // white background, opaque
  return data;
}

function fillRect(data: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * WIDTH + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
}

test("canvasToMnistInput: produces a [1,1,28,28] f32 tensor with values in [0,1]", () => {
  const data = blankCanvas();
  fillRect(data, 120, 40, 160, 240);
  const input = canvasToMnistInput(data, WIDTH, HEIGHT);
  assert.deepEqual(input.shape, [1, 1, 28, 28]);
  assert.equal(input.dtype, "f32");
  assert.ok(input.min().item() >= 0);
  assert.ok(input.max().item() <= 1);
});

test("canvasToMnistInput: a blank (all-white) canvas inverts to all-zero (black background, matching MNIST convention)", () => {
  const input = canvasToMnistInput(blankCanvas(), WIDTH, HEIGHT);
  assert.equal(input.max().item(), 0);
});

test("canvasToMnistInput: a fully black canvas inverts to all-one", () => {
  const data = blankCanvas();
  fillRect(data, 0, 0, WIDTH, HEIGHT);
  const input = canvasToMnistInput(data, WIDTH, HEIGHT);
  assert.equal(input.min().item(), 1);
});

test("rankDigitPredictions: sorts digits by probability descending and probabilities sum to ~1 (softmax)", () => {
  // Synthetic logits favoring digit 3 -- values chosen arbitrarily, only the
  // ORDER after softmax matters for this test (softmax is monotonic).
  const logits = Tensor.from([0, 1, 0, 5, 0, 0, 0, 0, 0, 0], { dtype: "f32" });
  const ranked = rankDigitPredictions(logits);
  assert.equal(ranked.length, 10);
  assert.equal(ranked[0]!.digit, 3);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1]!.probability >= ranked[i]!.probability);
  }
  const total = ranked.reduce((sum, r) => sum + r.probability, 0);
  assert.ok(Math.abs(total - 1) < 1e-5, `probabilities summed to ${total}`);
});

// End-to-end against the real bundled mnist-8.onnx model (public/models/) --
// loaded once and reused, since onnxruntime-web session init dominates the
// per-call cost (~2s for the first classification, <100ms after).
let model: OnnxModel;

before(async () => {
  const bytes = await readFile(new URL("../../public/models/mnist-8.onnx", import.meta.url));
  model = await onnx.load(new Uint8Array(bytes).buffer);
});

after(async () => {
  await model.release();
});

function classify(data: Uint8ClampedArray) {
  const input = canvasToMnistInput(data, WIDTH, HEIGHT);
  return model.run({ [model.inputNames[0]!]: input }).then((outputs) => rankDigitPredictions(outputs[model.outputNames[0]!]!));
}

test("end-to-end: a thick vertical bar (a hand-drawn '1') classifies as digit 1 with high confidence", async () => {
  const data = blankCanvas();
  fillRect(data, 120, 40, 160, 240);
  const ranked = await classify(data);
  assert.equal(ranked[0]!.digit, 1);
  assert.ok(ranked[0]!.probability > 0.9, `top probability was only ${ranked[0]!.probability}`);
});
