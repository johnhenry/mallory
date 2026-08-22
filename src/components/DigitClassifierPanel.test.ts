import assert from "node:assert/strict";
import { test } from "node:test";
import { Tensor } from "@johnhenry/math-plus-tensor-core";
import { onnx } from "@johnhenry/math-plus-adapter-onnx";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount, domWindow } = await setupTestDom();

// happy-dom's canvas has no real 2D rendering context (getContext("2d")
// returns null) -- DigitClassifierPanel bails out of every canvas-touching
// handler when that happens, so a fake context (every method a no-op,
// getImageData returning a blank white buffer) stands in, matching how
// mnist-preprocess.test.ts's own blankCanvas() fixture represents "nothing
// drawn". The fake's content is irrelevant here: this test only exercises
// request ordering, not the actual drawing-to-classification pipeline.
function installFakeCanvasContext(): void {
  (domWindow.HTMLCanvasElement.prototype as unknown as { getContext: (type: string) => unknown }).getContext = function (type: string) {
    if (type !== "2d") return null;
    return {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
      fillRect() {},
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      getImageData(_x: number, _y: number, w: number, h: number) {
        const data = new Uint8ClampedArray(w * h * 4);
        data.fill(255); // blank white canvas, opaque
        return { data, width: w, height: h };
      },
    };
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A fake OnnxModel (mallory-adapter-onnx's real shape) whose `run()` calls resolve on demand, one deferred promise per call, so the test controls resolution order independently of call order. */
function installFakeOnnxModel() {
  const runCalls: Deferred<Record<string, Tensor>>[] = [];
  const fakeModel = {
    inputNames: ["input"],
    outputNames: ["output"],
    run() {
      const d = deferred<Record<string, Tensor>>();
      runCalls.push(d);
      return d.promise;
    },
    release: async () => {},
  };
  const originalLoad = onnx.load;
  onnx.load = async () => fakeModel as unknown as Awaited<ReturnType<typeof onnx.load>>;
  return { runCalls, restore: () => { onnx.load = originalLoad; } };
}

/** `[1,10]` logits whose softmax argmax is `digit`, for a distinctive top prediction. */
function logitsFor(digit: number): Tensor {
  const values = new Array(10).fill(0);
  values[digit] = 10; // dominant enough that softmax's argmax is unambiguous
  return Tensor.from(values, { dtype: "f32" });
}

function firePointer(el: Element, type: string, pointerId = 1): void {
  el.dispatchEvent(
    new domWindow.PointerEvent(type, { bubbles: true, cancelable: true, pointerId, clientX: 10, clientY: 10 }) as unknown as Event,
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The digit whose prediction row is rendered bold (fontWeight 700 -- regressionPlot's own maxProbability convention), i.e. the top-ranked prediction currently shown. */
function topRenderedDigit(container: HTMLElement): string | null {
  const boldSpans = Array.from(container.querySelectorAll("span")).filter((s) => (s as HTMLElement).style.fontWeight === "700");
  assert.equal(boldSpans.length, 1, `expected exactly one bold (top-prediction) digit span, found ${boldSpans.length}`);
  return boldSpans[0]!.textContent;
}

test("DigitClassifierPanel: an out-of-order (slower, earlier) inference result does not overwrite a faster, later stroke's prediction", async () => {
  installFakeCanvasContext();
  const { runCalls, restore } = installFakeOnnxModel();
  try {
    const { DigitClassifierPanel } = await import("./DigitClassifierPanel.tsx");
    const { container, update } = await mount(createElement(DigitClassifierPanel));

    const canvas = container.querySelector("canvas")!;
    assert.ok(canvas, "expected the drawing pad canvas to be rendered");

    // Warm-up stroke: loads (and caches) the model in isolation from the
    // race below, so the two strokes that follow only race on model.run(),
    // not on the one-time onnx.load().
    await update(() => {
      firePointer(canvas, "pointerdown");
      firePointer(canvas, "pointerup");
    });
    await update(() => wait(5));
    assert.equal(runCalls.length, 1, "expected the warm-up stroke to issue exactly one inference call");
    await update(() => runCalls[0]!.resolve({ output: logitsFor(1) }));
    await update(() => wait(5));
    assert.equal(topRenderedDigit(container), "1");

    // Stroke A: starts first, resolves LAST (the slow one).
    await update(() => {
      firePointer(canvas, "pointerdown");
      firePointer(canvas, "pointerup");
    });
    await update(() => wait(5));
    assert.equal(runCalls.length, 2, "expected stroke A to issue a second inference call");

    // Stroke B: starts second, resolves FIRST (the fast one) -- e.g. a
    // multi-stroke digit's last stroke landing before an earlier stroke's
    // slower inference call.
    await update(() => {
      firePointer(canvas, "pointerdown");
      firePointer(canvas, "pointerup");
    });
    await update(() => wait(5));
    assert.equal(runCalls.length, 3, "expected stroke B to issue a third inference call");

    // B resolves first.
    await update(() => runCalls[2]!.resolve({ output: logitsFor(7) }));
    await update(() => wait(5));
    assert.equal(topRenderedDigit(container), "7", "the later stroke's (B's) prediction should be showing once it resolves");

    // A resolves after -- stale by the time it lands. It must NOT overwrite B's prediction.
    await update(() => runCalls[1]!.resolve({ output: logitsFor(3) }));
    await update(() => wait(5));
    assert.equal(
      topRenderedDigit(container),
      "7",
      "a slower, earlier stroke's inference result must not overwrite a faster, later stroke's already-applied prediction",
    );
  } finally {
    restore();
  }
});

test("DigitClassifierPanel: happy path -- a single stroke's prediction is applied normally once inference resolves", async () => {
  installFakeCanvasContext();
  const { runCalls, restore } = installFakeOnnxModel();
  try {
    const { DigitClassifierPanel } = await import("./DigitClassifierPanel.tsx");
    const { container, update } = await mount(createElement(DigitClassifierPanel));
    const canvas = container.querySelector("canvas")!;

    await update(() => {
      firePointer(canvas, "pointerdown");
      firePointer(canvas, "pointerup");
    });
    await update(() => wait(5));
    assert.equal(runCalls.length, 1);
    await update(() => runCalls[0]!.resolve({ output: logitsFor(4) }));
    await update(() => wait(5));
    assert.equal(topRenderedDigit(container), "4");
    assert.ok(!container.textContent?.includes("Classifying"), "status should have returned to idle, not stuck on 'Classifying…'");
  } finally {
    restore();
  }
});
