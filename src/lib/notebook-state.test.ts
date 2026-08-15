import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_NOTEBOOK_STATE, decodeNotebookState, encodeNotebookState } from "./notebook-state.ts";

test("round-trips the default notebook state through encode/decode", () => {
  const fragment = encodeNotebookState(DEFAULT_NOTEBOOK_STATE);
  assert.deepEqual(decodeNotebookState(fragment), DEFAULT_NOTEBOOK_STATE);
});

test("round-trips a mixed text/graph/value block document with unicode and per-row params", () => {
  const state = {
    v: 1 as const,
    blocks: [
      { type: "text" as const, content: "notes with θ and π" },
      { type: "value" as const, name: "k", value: 3 },
      {
        type: "graph" as const,
        rows: [{ source: "k*sin(x)", color: 0xdc2626, visible: true, params: {} }],
        viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
      },
    ],
  };
  const fragment = encodeNotebookState(state);
  assert.deepEqual(decodeNotebookState(fragment), state);
});

test("round-trips a named graph row and a curve-transform block (issue #35 item 2)", () => {
  const state = {
    v: 1 as const,
    blocks: [
      {
        type: "graph" as const,
        rows: [{ source: "sin(x)", color: 0x2563eb, visible: true, params: {}, name: "f" }],
        viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
      },
      { type: "curve-transform" as const, curveName: "f", op: "derivative" as const },
    ],
  };
  const fragment = encodeNotebookState(state);
  assert.deepEqual(decodeNotebookState(fragment), state);
});

test("encoded fragment is URL-fragment-safe (no +, /, or = padding)", () => {
  const fragment = encodeNotebookState(DEFAULT_NOTEBOOK_STATE);
  assert.ok(!/[+/=]/.test(fragment), `fragment contains unsafe characters: ${fragment}`);
});

test("decodeNotebookState returns null for garbage input rather than throwing", () => {
  assert.equal(decodeNotebookState("not-valid-base64url-json!!!"), null);
  assert.equal(decodeNotebookState(""), null);
});

test("decodeNotebookState rejects a well-formed but wrong-shape payload", () => {
  const badFragment = encodeNotebookState as unknown as (s: unknown) => string;
  assert.equal(decodeNotebookState(badFragment({ v: 1, blocks: "not-an-array" })), null);
  assert.equal(decodeNotebookState(badFragment({ v: 1, blocks: [{ type: "bogus" }] })), null);
  assert.equal(decodeNotebookState(badFragment({ v: 1, blocks: [{ type: "value", name: "k" }] })), null);
  assert.equal(
    decodeNotebookState(badFragment({ v: 1, blocks: [{ type: "graph", rows: "nope", viewport: {} }] })),
    null,
  );
  assert.equal(
    decodeNotebookState(badFragment({ v: 1, blocks: [{ type: "curve-transform", curveName: "f", op: "nonsense" }] })),
    null,
  );
});
