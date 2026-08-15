import assert from "node:assert/strict";
import { test } from "node:test";
import { notebookToLatex, notebookToMarkdown } from "./notebook-export.ts";
import type { NotebookState } from "./notebook-state.ts";

const MIXED_STATE: NotebookState = {
  v: 1,
  blocks: [
    { type: "text", content: "Some notes." },
    { type: "value", name: "k", value: 3 },
    {
      type: "graph",
      rows: [{ source: "sin(x)", color: 0x2563eb, visible: true, params: {} }],
      viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
    },
    { type: "tensor", source: "[[1,2],[3,4]]", op: "transpose" },
  ],
};

test("notebookToMarkdown: text passes through verbatim", () => {
  const md = notebookToMarkdown({ v: 1, blocks: [{ type: "text", content: "Some notes." }] }, new Map());
  assert.equal(md, "Some notes.");
});

test("notebookToMarkdown: a value block becomes inline math", () => {
  const md = notebookToMarkdown({ v: 1, blocks: [{ type: "value", name: "k", value: 3 }] }, new Map());
  assert.equal(md, "$k = 3$");
});

test("notebookToMarkdown: a graph block without a captured image falls back to a row list", () => {
  const state: NotebookState = {
    v: 1,
    blocks: [
      {
        type: "graph",
        rows: [{ source: "sin(x)", color: 0x2563eb, visible: true, params: {} }],
        viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
      },
    ],
  };
  const md = notebookToMarkdown(state, new Map());
  assert.equal(md, "- $y = sin(x)$");
});

test("notebookToMarkdown: a graph block with a captured image embeds it plus the row list", () => {
  const state: NotebookState = {
    v: 1,
    blocks: [
      {
        type: "graph",
        rows: [{ source: "sin(x)", color: 0x2563eb, visible: true, params: {} }],
        viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
      },
    ],
  };
  const md = notebookToMarkdown(state, new Map([[0, "data:image/png;base64,AAAA"]]));
  assert.equal(md, "![graph block 0](data:image/png;base64,AAAA)\n\n- $y = sin(x)$");
});

test("notebookToMarkdown: an unsupported block type renders an explicit placeholder, not a silent drop", () => {
  const state: NotebookState = { v: 1, blocks: [{ type: "tensor", source: "[[1,2]]", op: "transpose" }] };
  const md = notebookToMarkdown(state, new Map());
  assert.equal(md, "_[tensor block omitted -- not yet supported by notebook export]_");
});

test("notebookToMarkdown: mixed document joins blocks with a blank line", () => {
  const md = notebookToMarkdown(MIXED_STATE, new Map());
  assert.equal(md, "Some notes.\n\n$k = 3$\n\n- $y = sin(x)$\n\n_[tensor block omitted -- not yet supported by notebook export]_");
});

test("notebookToLatex: text passes through verbatim", () => {
  const tex = notebookToLatex({ v: 1, blocks: [{ type: "text", content: "Some notes." }] });
  assert.equal(tex, "Some notes.");
});

test("notebookToLatex: a value block becomes display math", () => {
  const tex = notebookToLatex({ v: 1, blocks: [{ type: "value", name: "k", value: 3 }] });
  assert.equal(tex, "\\[ k = 3 \\]");
});

test("notebookToLatex: a graph block renders each row's expression as display math, hand-verified against exprToLatex's own sin() rendering", () => {
  const state: NotebookState = {
    v: 1,
    blocks: [
      {
        type: "graph",
        rows: [{ source: "sin(x)", color: 0x2563eb, visible: true, params: {} }],
        viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
      },
    ],
  };
  const tex = notebookToLatex(state);
  assert.equal(tex, "\\[ y = \\sin(x) \\]");
});

test("notebookToLatex: a mid-typing unparseable expression falls back to the raw source rather than throwing", () => {
  const state: NotebookState = {
    v: 1,
    blocks: [
      {
        type: "graph",
        rows: [{ source: "sin(", color: 0x2563eb, visible: true, params: {} }],
        viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
      },
    ],
  };
  const tex = notebookToLatex(state);
  assert.equal(tex, "\\[ y = sin( \\]");
});

test("notebookToLatex: an unsupported block type renders an explicit comment placeholder", () => {
  const state: NotebookState = { v: 1, blocks: [{ type: "tensor", source: "[[1,2]]", op: "transpose" }] };
  const tex = notebookToLatex(state);
  assert.equal(tex, "% [tensor block omitted -- not yet supported by notebook export]");
});
