import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount, domWindow } = await setupTestDom();
const { ExportPreviewScrubber } = await import("./ExportPreviewScrubber.tsx");

/**
 * Sets a range input's value via the native HTMLInputElement.value setter
 * then dispatches a real "input" event -- same React-value-tracker
 * workaround as ExpressionRow.test.ts's identically-named helper (React
 * normalizes range/text inputs' `onChange` to the native "input" event).
 */
function setRangeValue(input: HTMLInputElement, value: string) {
  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    (domWindow as unknown as { HTMLInputElement: { prototype: object } }).HTMLInputElement.prototype,
    "value",
  )?.set as (this: HTMLInputElement, v: string) => void;
  nativeValueSetter.call(input, value);
  input.dispatchEvent(new domWindow.Event("input", { bubbles: true }) as unknown as Event);
}

function releaseSlider(input: HTMLInputElement) {
  input.dispatchEvent(new domWindow.PointerEvent("pointerup", { bubbles: true }) as unknown as Event);
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

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test("ExportPreviewScrubber: an out-of-order (slower, earlier) frame fetch does not overwrite a faster, later scrub release's preview", async () => {
  const calls: Deferred<{ data: string; mimeType: string }>[] = [];
  const fetchFrame = () => {
    const d = deferred<{ data: string; mimeType: string }>();
    calls.push(d);
    return d.promise;
  };

  const { container, update } = await mount(createElement(ExportPreviewScrubber, { maxTime: 10, fetchFrame }));
  const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
  assert.ok(slider, "expected a range input");

  // Release A: slider set to 2s, released -- starts the FIRST fetch, resolves LAST.
  await update(() => {
    setRangeValue(slider, "2");
    releaseSlider(slider);
  });
  assert.equal(calls.length, 1, "expected release A to issue one fetchFrame call");

  // Release B: slider quickly moved to 7s and released again before A resolves -- starts the SECOND fetch, resolves FIRST.
  await update(() => {
    setRangeValue(slider, "7");
    releaseSlider(slider);
  });
  assert.equal(calls.length, 2, "expected release B to issue a second fetchFrame call");

  // B resolves first.
  await update(() => calls[1]!.resolve({ data: "frame-B", mimeType: "image/png" }));
  await update(() => wait(1));
  let img = container.querySelector("img");
  assert.ok(img?.getAttribute("src")?.includes("frame-B"), `expected B's frame to be showing, got ${img?.getAttribute("src")}`);

  // A resolves after -- stale by the time it lands, must NOT overwrite B's already-applied frame.
  await update(() => calls[0]!.resolve({ data: "frame-A", mimeType: "image/png" }));
  await update(() => wait(1));
  img = container.querySelector("img");
  assert.ok(
    img?.getAttribute("src")?.includes("frame-B"),
    `a slower, earlier release's frame must not overwrite a faster, later release's already-applied frame, got ${img?.getAttribute("src")}`,
  );
});

test("ExportPreviewScrubber: happy path -- a single scrub release's frame is applied normally once the fetch resolves", async () => {
  const calls: Deferred<{ data: string; mimeType: string }>[] = [];
  const fetchFrame = () => {
    const d = deferred<{ data: string; mimeType: string }>();
    calls.push(d);
    return d.promise;
  };

  const { container, update } = await mount(createElement(ExportPreviewScrubber, { maxTime: 10, fetchFrame }));
  const slider = container.querySelector('input[type="range"]') as HTMLInputElement;

  await update(() => {
    setRangeValue(slider, "3");
    releaseSlider(slider);
  });
  assert.equal(calls.length, 1);
  assert.ok(container.textContent?.includes("rendering"), "expected the loading indicator while the fetch is in flight");

  await update(() => calls[0]!.resolve({ data: "frame-C", mimeType: "image/png" }));
  await update(() => wait(1));
  const img = container.querySelector("img");
  assert.ok(img?.getAttribute("src")?.includes("frame-C"));
  assert.ok(!container.textContent?.includes("rendering"), "loading indicator should be gone once the fetch resolves");
});
