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

test("round-trips a difference curve-transform block with curveName2 set", () => {
  const state = {
    v: 1 as const,
    blocks: [{ type: "curve-transform" as const, curveName: "f", op: "difference" as const, curveName2: "g" }],
  };
  const fragment = encodeNotebookState(state);
  assert.deepEqual(decodeNotebookState(fragment), state);
});

test("decodeNotebookState accepts a pre-difference curve-transform block missing curveName2 entirely (an old encoded URL hash)", () => {
  const badFragment = encodeNotebookState as unknown as (s: unknown) => string;
  const decoded = decodeNotebookState(
    badFragment({ v: 1, blocks: [{ type: "curve-transform", curveName: "f", op: "derivative" }] }),
  );
  assert.notEqual(decoded, null);
});

test("decodeNotebookState rejects a curve-transform block with a wrongly-typed curveName2 when present", () => {
  const badFragment = encodeNotebookState as unknown as (s: unknown) => string;
  assert.equal(
    decodeNotebookState(badFragment({ v: 1, blocks: [{ type: "curve-transform", curveName: "f", op: "difference", curveName2: 4 }] })),
    null,
  );
});

test("round-trips a tensor block with sourceMode/curveName set (issue #35's tensor-from-curve remaining scope)", () => {
  const state = {
    v: 1 as const,
    blocks: [{ type: "tensor" as const, source: "", op: "none" as const, sourceMode: "curve" as const, curveName: "f" }],
  };
  const fragment = encodeNotebookState(state);
  assert.deepEqual(decodeNotebookState(fragment), state);
});

test("decodeNotebookState accepts a pre-tensor-from-curve tensor block missing sourceMode/curveName entirely (an old encoded URL hash)", () => {
  const badFragment = encodeNotebookState as unknown as (s: unknown) => string;
  const decoded = decodeNotebookState(badFragment({ v: 1, blocks: [{ type: "tensor", source: "1 2\n3 4", op: "none" }] }));
  assert.notEqual(decoded, null);
});

test("decodeNotebookState rejects a tensor block with a wrongly-typed or unrecognized sourceMode/curveName", () => {
  const badFragment = encodeNotebookState as unknown as (s: unknown) => string;
  assert.equal(
    decodeNotebookState(badFragment({ v: 1, blocks: [{ type: "tensor", source: "1", op: "none", sourceMode: "bogus" }] })),
    null,
  );
  assert.equal(
    decodeNotebookState(badFragment({ v: 1, blocks: [{ type: "tensor", source: "1", op: "none", curveName: 4 }] })),
    null,
  );
});

test("round-trips a tensor block with split mode fields set (issue #35's split-UI remaining scope)", () => {
  const state = {
    v: 1 as const,
    blocks: [
      {
        type: "tensor" as const,
        source: "1 2 3\n4 5 6\n7 8 9\n10 11 12",
        op: "none" as const,
        splitEnabled: true,
        splitAxis: 0 as const,
        splitSections: "2",
      },
    ],
  };
  const fragment = encodeNotebookState(state);
  assert.deepEqual(decodeNotebookState(fragment), state);
});

test("decodeNotebookState accepts a pre-split tensor block missing splitEnabled/splitAxis/splitSections entirely (an old encoded URL hash)", () => {
  const badFragment = encodeNotebookState as unknown as (s: unknown) => string;
  const decoded = decodeNotebookState(badFragment({ v: 1, blocks: [{ type: "tensor", source: "1 2\n3 4", op: "none" }] }));
  assert.notEqual(decoded, null);
});

test("decodeNotebookState rejects a tensor block with a wrongly-typed splitEnabled or an unrecognized splitAxis", () => {
  const badFragment = encodeNotebookState as unknown as (s: unknown) => string;
  assert.equal(
    decodeNotebookState(badFragment({ v: 1, blocks: [{ type: "tensor", source: "1", op: "none", splitEnabled: "yes" }] })),
    null,
  );
  assert.equal(
    decodeNotebookState(badFragment({ v: 1, blocks: [{ type: "tensor", source: "1", op: "none", splitAxis: 2 }] })),
    null,
  );
  assert.equal(
    decodeNotebookState(badFragment({ v: 1, blocks: [{ type: "tensor", source: "1", op: "none", splitSections: 4 }] })),
    null,
  );
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
