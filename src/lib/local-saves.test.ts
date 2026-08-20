import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLocalSaves } from "./local-saves.ts";

const good = { id: "a", title: "Sine", kind: "multi", createdAt: 100, state: { v: 1 } };
const newer = { id: "b", title: "Circle", kind: "geometry", createdAt: 200, state: { v: 2 } };

test("parses a valid store, newest first (matching the shared gallery's ordering)", () => {
  const parsed = parseLocalSaves(JSON.stringify([good, newer]));
  assert.deepEqual(parsed.map((r) => r.id), ["b", "a"]);
});

test("a missing store reads as empty", () => {
  assert.deepEqual(parseLocalSaves(null), []);
});

test("corrupted JSON reads as empty, never throws -- a broken store must not take the gallery page down", () => {
  assert.deepEqual(parseLocalSaves("{not json"), []);
  assert.deepEqual(parseLocalSaves('"a string, not an array"'), []);
});

test("a malformed entry loses itself, not the whole store", () => {
  const parsed = parseLocalSaves(JSON.stringify([good, { id: 42, nope: true }, null, newer]));
  assert.deepEqual(parsed.map((r) => r.id), ["b", "a"]);
});
