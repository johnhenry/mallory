/**
 * Polls `checkStatus` on an interval until it resolves to a non-"pending"
 * status, or `isCancelled()` says to stop -- extracted from
 * VideoExportControls's own inline `poll()` closure (issue #237) so the
 * recursive-setTimeout job-poll loop has a real, testable stop condition
 * instead of running forever once nobody cares about the result anymore
 * (e.g. the component that started it has unmounted). `isCancelled` is
 * checked both before issuing a status request and after it resolves, so a
 * cancellation that lands mid-request still stops the chain before the next
 * `setTimeout` gets scheduled.
 *
 * Returns `null` if cancelled before the job ever settles. Deliberately not
 * generalized to GraphCanvas's own bespoke, differently-scoped poll loop
 * (mallory#3's own "keeps its bespoke inline version" precedent) --
 * this is scoped to the one call site issue #237 named.
 */
export async function pollUntilSettled<T extends { status: string }>(
  checkStatus: () => Promise<T>,
  isCancelled: () => boolean,
  intervalMs = 1000,
): Promise<T | null> {
  while (!isCancelled()) {
    const status = await checkStatus();
    if (isCancelled()) return null;
    if (status.status !== "pending") return status;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}
