import assert from "node:assert/strict";
import { test } from "node:test";
import { pollUntilSettled } from "./poll-job.ts";

test("pollUntilSettled: resolves immediately when the first status check is already settled", async () => {
  let calls = 0;
  const result = await pollUntilSettled(
    async () => {
      calls++;
      return { status: "done", value: 42 };
    },
    () => false,
    5,
  );
  assert.deepEqual(result, { status: "done", value: 42 });
  assert.equal(calls, 1);
});

test("pollUntilSettled: keeps polling on 'pending' until a non-pending status comes back", async () => {
  let calls = 0;
  const result = await pollUntilSettled(
    async () => {
      calls++;
      return calls < 3 ? { status: "pending" as const } : { status: "done" as const, value: "finished" };
    },
    () => false,
    1,
  );
  assert.equal(calls, 3);
  assert.deepEqual(result, { status: "done", value: "finished" });
});

test("pollUntilSettled: stops and returns null once isCancelled() flips true, without issuing a further status check", async () => {
  let cancelled = false;
  let calls = 0;
  const promise = pollUntilSettled(
    async () => {
      calls++;
      if (calls === 1) cancelled = true; // simulate the caller (e.g. an unmounted component) cancelling right after the first check
      return { status: "pending" as const };
    },
    () => cancelled,
    1,
  );
  const result = await promise;
  assert.equal(result, null);
  assert.equal(calls, 1, `expected polling to stop after cancellation instead of issuing more checks, got ${calls} calls`);
});

test("pollUntilSettled: never calls checkStatus at all if already cancelled up front", async () => {
  let calls = 0;
  const result = await pollUntilSettled(
    async () => {
      calls++;
      return { status: "done" as const };
    },
    () => true,
    1,
  );
  assert.equal(result, null);
  assert.equal(calls, 0);
});
