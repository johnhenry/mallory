/**
 * Curated gallery entries (issue #39's "Cookbook gallery seeds" item), so
 * the gallery isn't empty for a new visitor and each entry doubles as an
 * integration smoke test of its panel -- mapping mallory-math's own
 * COOKBOOK content onto pre-built saved-graph documents, the way the
 * ticket originally framed it.
 *
 * Checked in as a plain TS module (not a JSON file under `data/`, which is
 * entirely gitignored as runtime state -- see saved-graphs.ts's own doc
 * comment) so these ship with the repo and get real type-checking against
 * each kind's own state shape.
 *
 * Every entry reuses each panel's own already-vetted `DEFAULT_*_STATE`
 * (already what a first-time visitor to that standalone panel sees, so
 * it's provably valid and meaningful, not placeholder junk) except the
 * geometry seed, hand-built as a small real construction (three points +
 * three connecting lines) since `DEFAULT_GEOMETRY_STATE` is an empty
 * op log. Every entry's `state` was verified via a round trip through its
 * own `encode*State`/`decode*State` pair before being copied in here.
 *
 * Loaded read-only alongside the SQLite-backed store (see
 * `getGalleryDb`'s callers in this file) -- these ids are fixed and never
 * written to the `saved_graphs` table, so they can't be duplicated across
 * restarts and a delete attempt on one is a guaranteed no-op (there's
 * nothing in the table to delete).
 */
import type { SavedGraphKind, SavedGraphState } from "./saved-graphs.ts";

export interface GallerySeed {
  id: string;
  title: string;
  kind: SavedGraphKind;
  createdAt: number;
  state: SavedGraphState;
}

export const GALLERY_SEEDS: GallerySeed[] = [
  {
    id: "seed-multi-1",
    title: "sin(x) and cos(x)",
    kind: "multi",
    createdAt: 1700000000000,
    state: {
      v: 1,
      rows: [
        { source: "sin(x)", color: 0x2563eb, visible: true, params: {} },
        { source: "cos(x)", color: 0xdc2626, visible: true, params: {} },
      ],
      viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
      annotations: [],
      mode: "float",
    },
  },
  {
    id: "seed-complex-1",
    title: "z^2 + 1 domain coloring",
    kind: "complex",
    createdAt: 1700000001000,
    state: {
      v: 2,
      exprText: "z^2 + 1",
      probeRe: "1",
      probeIm: "1",
      showRootsOfUnity: true,
      rootsN: "5",
      showConformalGrid: false,
      conformalGridType: "rectangular",
      conformalGridSpacing: "0.5",
    },
  },
  {
    id: "seed-geometry-1",
    title: "A constructed triangle",
    kind: "geometry",
    createdAt: 1700000002000,
    state: {
      v: 1,
      ops: [
        { tool: "point", id: "seed-p1", x: -3, y: -2 },
        { tool: "point", id: "seed-p2", x: 3, y: -2 },
        { tool: "point", id: "seed-p3", x: 0, y: 3 },
        { tool: "line", id: "seed-l1", a: "seed-p1", b: "seed-p2" },
        { tool: "line", id: "seed-l2", a: "seed-p2", b: "seed-p3" },
        { tool: "line", id: "seed-l3", a: "seed-p3", b: "seed-p1" },
      ],
    },
  },
  {
    id: "seed-surface3d-1",
    title: "z = sin(x)*cos(y)",
    kind: "surface-3d",
    createdAt: 1700000003000,
    state: {
      v: 1,
      pane2d: { source: "sin(x)", params: {}, structureModulus: null },
      pane3d: { source: "sin(x)*cos(y)", params: {} },
      crossSectionY: 0,
    },
  },
  {
    id: "seed-ode-1",
    title: "dy/dx = x - y",
    kind: "ode",
    createdAt: 1700000004000,
    state: {
      v: 1,
      expr: "x - y",
      x0: "0",
      y0: "1",
      xMin: "-5",
      xMax: "5",
      yMin: "-5",
      yMax: "5",
    },
  },
  {
    id: "seed-ode-system-1",
    title: "Lotka-Volterra predator-prey",
    kind: "ode-system",
    createdAt: 1700000005000,
    state: {
      v: 1,
      exprX: "x*(1-y)",
      exprY: "y*(x-1)",
      t0: "0",
      x0: "2",
      y0: "1",
      tMin: "0",
      tMax: "15",
      xMin: "0",
      xMax: "3",
      yMin: "0",
      yMax: "3",
    },
  },
  {
    id: "seed-regression-1",
    title: "Exponential growth fit",
    kind: "regression",
    createdAt: 1700000006000,
    state: {
      v: 1,
      rows: [
        { x: "1", y: "2.1" },
        { x: "2", y: "3.9" },
        { x: "3", y: "6.2" },
        { x: "4", y: "7.8" },
        { x: "5", y: "10.1" },
      ],
      fitType: "linear",
      modelExpr: "a*exp(b*x)",
      paramGuesses: { a: "1", b: "0.1" },
    },
  },
  {
    id: "seed-statistics-1",
    title: "Descriptive statistics of a sample",
    kind: "statistics",
    createdAt: 1700000007000,
    state: {
      v: 1,
      data: "2, 4, 4, 4, 5, 5, 7, 9",
      distType: "normal",
      distMean: "0",
      distSd: "1",
      distN: "10",
      distP: "0.5",
      distLambda: "4",
      distDf: "5",
      queryLower: "-1",
      queryUpper: "1",
    },
  },
  {
    id: "seed-systems-1",
    title: "A 2x2 linear system",
    kind: "systems",
    createdAt: 1700000008000,
    state: {
      v: 1,
      equations: ["2*x + 3*y = 12", "x - y = 1"],
      variables: "x,y",
    },
  },
  {
    id: "seed-notebook-1",
    title: "Notebook walkthrough",
    kind: "notebook",
    createdAt: 1700000009000,
    state: {
      v: 1,
      blocks: [
        {
          type: "text",
          content:
            'A reactive notebook: mix free-form notes with live graph cells and named value cells. Every graph cell below shares one CellGraph, so a graph cell\'s expression can reference an earlier value cell by name -- e.g. a value block named "k" makes "k" available to any graph cell below it, sourced live instead of getting its own independent slider. Referencing another graph cell\'s entire curve (not just a named scalar) is a later extension.',
        },
        {
          type: "graph",
          rows: [{ source: "sin(x)", color: 0x2563eb, visible: true, params: {} }],
          viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
        },
      ],
    },
  },
];
