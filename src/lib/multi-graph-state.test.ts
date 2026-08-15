import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MULTI_GRAPH_STATE, decodeMultiGraphState, encodeMultiGraphState } from "./multi-graph-state.ts";

test("round-trips the default multi-graph state through encode/decode", () => {
  const fragment = encodeMultiGraphState(DEFAULT_MULTI_GRAPH_STATE);
  assert.deepEqual(decodeMultiGraphState(fragment), DEFAULT_MULTI_GRAPH_STATE);
});

test("round-trips per-row params and unicode expression sources", () => {
  const state = {
    v: 1 as const,
    rows: [{ source: "a*sin(θ) + π", color: 0x16a34a, visible: false, params: { a: 2.5 } }],
    viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
  };
  const fragment = encodeMultiGraphState(state);
  assert.deepEqual(decodeMultiGraphState(fragment), state);
});

test("encoded fragment is URL-fragment-safe (no +, /, or = padding)", () => {
  const fragment = encodeMultiGraphState(DEFAULT_MULTI_GRAPH_STATE);
  assert.ok(!/[+/=]/.test(fragment), `fragment contains unsafe characters: ${fragment}`);
});

test("decodeMultiGraphState returns null for garbage input rather than throwing", () => {
  assert.equal(decodeMultiGraphState("not-valid-base64url-json!!!"), null);
  assert.equal(decodeMultiGraphState(""), null);
});

test("decodeMultiGraphState rejects a well-formed but wrong-shape payload", () => {
  const badFragment = encodeMultiGraphState as unknown as (s: unknown) => string;
  const fragment = badFragment({ v: 1, rows: "not-an-array", viewport: {} });
  assert.equal(decodeMultiGraphState(fragment), null);
});

test("round-trips annotations", () => {
  const state = {
    v: 1 as const,
    rows: [{ source: "x", color: 0x2563eb, visible: true, params: {} }],
    viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
    annotations: [{ id: "a1", x: 1.5, y: 2.25, label: "Peak" }],
  };
  const fragment = encodeMultiGraphState(state);
  assert.deepEqual(decodeMultiGraphState(fragment), state);
});

test("decodes a fragment with no annotations field at all (encoded before annotations existed) without throwing", () => {
  const legacyFragment = (encodeMultiGraphState as unknown as (s: unknown) => string)({
    v: 1,
    rows: [{ source: "x", color: 0x2563eb, visible: true, params: {} }],
    viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
  });
  const decoded = decodeMultiGraphState(legacyFragment);
  assert.ok(decoded);
  assert.equal(decoded.annotations, undefined);
});

test("round-trips exact mode", () => {
  const state = {
    v: 1 as const,
    rows: [{ source: "x", color: 0x2563eb, visible: true, params: {} }],
    viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
    mode: "exact" as const,
  };
  const fragment = encodeMultiGraphState(state);
  assert.deepEqual(decodeMultiGraphState(fragment), state);
});

test("decodes a fragment with no mode field at all (encoded before exact-mode existed) without throwing", () => {
  const legacyFragment = (encodeMultiGraphState as unknown as (s: unknown) => string)({
    v: 1,
    rows: [{ source: "x", color: 0x2563eb, visible: true, params: {} }],
    viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
  });
  const decoded = decodeMultiGraphState(legacyFragment);
  assert.ok(decoded);
  assert.equal(decoded.mode, undefined);
});

test("rejects an invalid mode value", () => {
  const badFragment = (encodeMultiGraphState as unknown as (s: unknown) => string)({
    v: 1,
    rows: [],
    viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
    mode: "imaginary",
  });
  assert.equal(decodeMultiGraphState(badFragment), null);
});

test("rejects a malformed annotation entry", () => {
  const badFragment = (encodeMultiGraphState as unknown as (s: unknown) => string)({
    v: 1,
    rows: [],
    viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
    annotations: [{ id: "a1", x: "not-a-number", y: 2, label: "bad" }],
  });
  assert.equal(decodeMultiGraphState(badFragment), null);
});
