import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";

/** The exact legacy encoder every codec privately carried before #320 step 2 -- kept here (only) to prove old shared URLs still decode. */
function legacyEncode(state: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

test("round-trips a representative state object", () => {
  const state = { v: 3, cells: [{ id: "f", source: "sin(k*x)", params: { k: 2.5 }, structureModulus: null }], viewport: { xMin: -10, xMax: 10, yMin: -2, yMax: 2 }, mode: "float" };
  assert.deepEqual(decodeStateFragment(encodeStateFragment(state)), state);
});

test("round-trips non-ASCII text (UTF-8 through deflate + base64url)", () => {
  const state = { title: "θ ≈ π/2 — naïve café ✓" };
  assert.deepEqual(decodeStateFragment(encodeStateFragment(state)), state);
});

test("compressed fragments carry the z: version marker and stay URL-fragment-safe", () => {
  const fragment = encodeStateFragment({ a: 1 });
  assert.ok(fragment.startsWith("z:"));
  assert.match(fragment.slice(2), /^[A-Za-z0-9_-]*$/, "payload must be pure base64url");
});

test("legacy (uncompressed) fragments still decode -- every URL ever shared keeps working", () => {
  const state = { v: 1, rows: [{ exprText: "x^2", visible: true }] };
  assert.deepEqual(decodeStateFragment(legacyEncode(state)), state);
});

test("legacy fragments can never collide with the marker (base64url has no colon)", () => {
  assert.ok(!legacyEncode({ z: "z:z:z" }).includes(":"));
});

test("compression genuinely shrinks a realistic repetitive state (vs the legacy encoding of the same state)", () => {
  const state = {
    v: 2,
    rows: Array.from({ length: 12 }, (_, i) => ({ exprText: `sin(${i + 1}*x) + cos(${i + 1}*x)`, visible: true, color: 2563 + i, fromN: "1", toN: "50", plotCount: "40" })),
  };
  const compressed = encodeStateFragment(state).length;
  const legacy = legacyEncode(state).length;
  assert.ok(compressed < legacy / 2, `expected at least 2x shrink, got ${legacy} -> ${compressed}`);
});

test("garbage throws (mirroring JSON.parse) so codec call sites' existing try/catch validation keeps working", () => {
  assert.throws(() => decodeStateFragment("z:!!!not-base64!!!"));
  assert.throws(() => decodeStateFragment("definitely not a fragment at all"));
});
