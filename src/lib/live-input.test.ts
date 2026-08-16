import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMediaDevices } from "./live-input.ts";

test("hasMediaDevices: false under plain Node (no navigator/getUserMedia at all)", () => {
  assert.equal(hasMediaDevices(), false);
});
