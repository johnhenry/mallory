/**
 * The matrix <-> directed-graph duality (issue #297, from "The Single Most
 * Undervalued Fact of Linear Algebra"): every nonnegative square matrix IS
 * a weighted directed graph -- row i is node i's outgoing edges, column i
 * its incoming edges, a zero entry means "no edge." Strongly connected
 * components (mallory-math's `Graph.stronglyConnectedComponents`, Tarjan)
 * plus a topological order of their condensation give the FROBENIUS NORMAL
 * FORM: relabeling nodes so component-source-to-sink order matches row/
 * column order makes the matrix upper block-triangular, with an
 * irreducible square block per component along the diagonal and the
 * below-diagonal region entirely zero (no edges from a later component
 * back to an earlier one -- if there were, they'd still be mutually
 * reachable, i.e. the same component).
 *
 * "Relabeling nodes" IS a similarity transform by a permutation matrix
 * (`P^T A P`) -- but computing the permuted matrix doesn't need an actual
 * matrix multiply: reordering both the rows and columns by the same
 * permutation is just `permuted[i][j] = A[order[i]][order[j]]`, a pure
 * reindex. `P` itself is still returned (built directly from `order`, not
 * derived FROM the reindex) so callers can display or further compose it.
 */
import { Graph } from "mallory-math";
import type { Mat } from "./matrix-ops.ts";

export interface FrobeniusBlock {
  /** This block's strongly connected component, as ORIGINAL matrix indices (not permuted positions). */
  component: number[];
  /** The block's row/column range in `permuted` (inclusive start, exclusive end) -- the diagonal square block for this component. */
  start: number;
  end: number;
}

export interface FrobeniusResult {
  /** `order[i]` = the original matrix index now at permuted position `i`. */
  order: number[];
  /** The permutation matrix such that `P^T @ matrix @ P === permuted` (verified in this module's own test file via a direct matrix-multiply cross-check). */
  P: Mat;
  /** `matrix` reindexed by `order` on both axes -- upper block-triangular with `blocks` along the diagonal. */
  permuted: Mat;
  /** One entry per strongly connected component, in the same source-to-sink order as `permuted`'s diagonal blocks. */
  blocks: FrobeniusBlock[];
  /** True when the whole matrix is one strongly connected component (the graph is strongly connected) -- an irreducible matrix has no nontrivial Frobenius form to show. */
  irreducible: boolean;
}

/**
 * Computes the Frobenius normal form of a nonnegative square matrix: the
 * permutation `P` (and resulting `permuted = P^T @ matrix @ P`) that makes
 * it upper block-triangular with irreducible diagonal blocks, via the
 * matrix's own directed-graph structure. Diagonal entries become self-loop
 * edges (irrelevant to connectivity between distinct nodes, so they never
 * affect which component a node lands in). Throws if `matrix` isn't
 * square.
 */
export function frobeniusNormalForm(matrix: Mat): FrobeniusResult {
  const n = matrix.length;
  for (const row of matrix) {
    if (row.length !== n) throw new Error(`frobeniusNormalForm requires a square matrix (got a ${n}-row matrix with a ${row.length}-entry row).`);
  }

  const graph = new Graph<number>(true);
  for (let i = 0; i < n; i++) graph.addVertex(i);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matrix[i]![j] !== 0) graph.addEdge(i, j, matrix[i]![j]!);
    }
  }

  const sccs = graph.stronglyConnectedComponents();
  const componentOf = new Map<number, number>();
  sccs.forEach((component, componentIndex) => {
    for (const v of component) componentOf.set(v, componentIndex);
  });

  // Condensation: one node per component, an edge compA -> compB whenever
  // some vertex in compA has an edge to some vertex in compB (compA !==
  // compB) -- "skeletonize," per the video's own framing, treating each
  // component as a black box.
  const condensation = new Graph<number>(true);
  for (let c = 0; c < sccs.length; c++) condensation.addVertex(c);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matrix[i]![j] === 0) continue;
      const ci = componentOf.get(i)!;
      const cj = componentOf.get(j)!;
      if (ci !== cj) condensation.addEdge(ci, cj, 1);
    }
  }

  // The condensation is always a DAG (a cycle of components would mean
  // they're mutually reachable, i.e. one component, not several) --
  // topologicalSort() is total-order source-first, matching the video's
  // "a must rank lower than b when a path a->b exists" rule.
  const componentOrder = condensation.topologicalSort();
  if (!componentOrder) throw new Error("frobeniusNormalForm: condensation graph unexpectedly has a cycle -- this indicates a bug in strongly-connected-component grouping, not a valid input.");

  // Within a component, original-index order is an arbitrary but
  // deterministic tiebreak (any order within a diagonal block is valid --
  // the block stays square and irreducible either way).
  const order: number[] = [];
  const blocks: FrobeniusBlock[] = [];
  for (const c of componentOrder) {
    const component = [...sccs[c]!].sort((a, b) => a - b);
    const start = order.length;
    order.push(...component);
    blocks.push({ component, start, end: order.length });
  }

  const permuted: Mat = order.map((oi) => order.map((oj) => matrix[oi]![oj]!));

  // P^T @ matrix @ P === permuted requires column i's single 1 to sit at
  // ROW order[i] (not row i, column order[i] -- that construction instead
  // satisfies P @ matrix @ P^T === permuted, the opposite convention; see
  // this module's own test file for a direct multiply cross-check).
  const P: Mat = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) P[order[i]!]![i] = 1;

  return { order, P, permuted, blocks, irreducible: sccs.length === 1 };
}

/**
 * The other half of the duality (issue #297 item 5, `GraphTheoryPanel`'s
 * adjacency heatmap already does graph -> matrix): renders a square matrix
 * as its own directed graph, matching the video's exact convention --
 * row i's nonzero entries are node i's outgoing edges (a diagonal entry is
 * a LOOP edge back to the same node, not a special case to skip), and a
 * zero entry means no edge at all (never a real zero-weight edge -- the
 * video is explicit about this: "edges of zero weight are omitted").
 * Nodes are labeled by matrix index ("0", "1", ...) since a plain matrix
 * has no vertex names of its own. Returns `null` for a non-square matrix
 * (a directed-graph reading needs one row and one column per node --
 * there's no such reading for a rectangular matrix).
 */
export function matrixToGraph(matrix: Mat): Graph<string> | null {
  const n = matrix.length;
  for (const row of matrix) {
    if (row.length !== n) return null;
  }
  const graph = new Graph<string>(true);
  for (let i = 0; i < n; i++) graph.addVertex(String(i));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const weight = matrix[i]![j]!;
      if (weight !== 0) graph.addEdge(String(i), String(j), weight);
    }
  }
  return graph;
}
