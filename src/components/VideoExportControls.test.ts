import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount, domWindow } = await setupTestDom();

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

function clickButton(el: Element) {
  el.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
}

/**
 * Polls `predicate` until true. Used to synchronize on the async chain
 * inside handleExport (e.g. "the first getExportVideoJob call has actually
 * been issued") without hardcoding a guessed delay.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    await wait(2);
  }
}

interface JobStatus {
  status: "pending" | "done" | "error";
  result?: { data: string; mimeType: string };
  message?: string;
}

/**
 * `useServerFn(getExportVideoJob)` needs a real `<RouterProvider>` (absent
 * in this component-mount harness -- no other test in this codebase mounts
 * a component that actually INVOKES its `useServerFn`-derived function, only
 * ones that never click the button that would) and `getExportVideoJob`
 * itself needs the real TanStack Start server runtime (calling it directly
 * throws "No Start context found in AsyncLocalStorage" outside one). Both
 * are sidestepped here via `mock.module` on `../lib/export-video.ts`'s named
 * export (issue #237's own polling/cancellation fix is what motivated
 * turning on `--experimental-test-module-mocks` in package.json's test
 * script), swapping in a controllable fake `getExportVideoJob` so this test
 * can drive real out-of-order/cancellation timing.
 */
function installFakeGetExportVideoJob() {
  const calls: Deferred<JobStatus>[] = [];
  mock.module("../lib/export-video.ts", {
    namedExports: {
      getExportVideoJob: async (_args: unknown) => {
        const d = deferred<JobStatus>();
        calls.push(d);
        return d.promise;
      },
    },
  });
  return calls;
}

const statusCalls = installFakeGetExportVideoJob();
const { VideoExportControls } = await import("./VideoExportControls.tsx");

test("VideoExportControls: unmounting while a job is still 'pending' stops the poll loop -- no further getExportVideoJob calls are issued", async () => {
  statusCalls.length = 0;
  let resolveStart!: (v: { jobId: string }) => void;
  const start = () =>
    new Promise<{ jobId: string }>((resolve) => {
      resolveStart = resolve;
    });

  const { container, update, unmount } = await mount(createElement(VideoExportControls, { start, filenameStem: "clip" }));
  const button = container.querySelector("button")!;

  await update(() => clickButton(button));
  assert.ok(button.textContent?.includes("Exporting"), "expected the export to be in flight after clicking");

  await update(() => resolveStart({ jobId: "job-1" }));
  await waitFor(() => statusCalls.length === 1);

  // Unmount (e.g. the user navigated away) WHILE the job is still pending --
  // before this fix, the poll loop's recursive setTimeout chain had no way
  // to know that and would keep polling (and eventually try to update state
  // on the unmounted component) forever.
  await unmount();

  // The in-flight status check resolves as still-pending AFTER unmount.
  // Wait past pollUntilSettled's default 1s poll interval so a would-be
  // buggy version (which schedules its next check via `setTimeout(poll,
  // 1000)` regardless of mount state) has had a real chance to fire a
  // second call before this asserts it didn't.
  await update(() => statusCalls[0]!.resolve({ status: "pending" }));
  await wait(1300);

  assert.equal(
    statusCalls.length,
    1,
    "expected no further getExportVideoJob calls once the component unmounted mid-poll -- the loop should have stopped instead of scheduling another check",
  );
});

test("VideoExportControls: happy path -- a single export request completes and downloads normally", async () => {
  statusCalls.length = 0;
  const start = async () => ({ jobId: "job-2" });

  const { container, update } = await mount(createElement(VideoExportControls, { start, filenameStem: "clip" }));
  const button = container.querySelector("button")!;

  await update(() => clickButton(button));
  await waitFor(() => statusCalls.length === 1);

  await update(() =>
    statusCalls[0]!.resolve({
      status: "done",
      result: { data: btoa("video-bytes"), mimeType: "video/mp4" },
    }),
  );
  await waitFor(() => !button.textContent?.includes("Exporting"));

  assert.equal(button.textContent, "Export video");
  const errorSpan = Array.from(container.querySelectorAll("span")).find((s) => (s as HTMLElement).style.color === "var(--danger)");
  assert.equal(errorSpan, undefined, `expected no error message, found: ${errorSpan?.textContent}`);
});
