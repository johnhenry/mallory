import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import {
  cellIds3D,
  cellIdsComplex,
  cellIdsGeometry,
  cellIdsMultiRow,
  cellIdsNotebookBlock,
  cellIdsOde,
  cellIdsOdeSystem,
  cellIdsRegression,
  cellIdsStatistics,
  cellIdsSystem,
  notebookValueCellId,
} from "../lib/cell-ids.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";
import { useUndoHistory } from "../hooks/use-undo-history.ts";
import {
  DEFAULT_NOTEBOOK_STATE,
  decodeNotebookState,
  encodeNotebookState,
  type NotebookGraphBlockStateV1,
  type NotebookState,
} from "../lib/notebook-state.ts";
import { DEFAULT_COMPLEX_STATE, type ComplexState } from "../lib/complex-state.ts";
import { DEFAULT_GEOMETRY_STATE, type GeometryOp } from "../lib/geometry-state.ts";
import { DEFAULT_ODE_STATE, type OdeState } from "../lib/ode-state.ts";
import { DEFAULT_ODE_SYSTEM_STATE, type OdeSystemState } from "../lib/ode-system-state.ts";
import { DEFAULT_REGRESSION_STATE, type RegressionState } from "../lib/regression-state.ts";
import { DEFAULT_STATISTICS_STATE, type StatisticsState } from "../lib/statistics-state.ts";
import { DEFAULT_SYSTEM_STATE, type SystemState } from "../lib/system-state.ts";
import { notebookToLatex, notebookToMarkdown, type NotebookGraphImages } from "../lib/notebook-export.ts";
import { saveGraph } from "../lib/saved-graphs.ts";
import { getCurrentComplexState } from "./ComplexPanel.tsx";
import { getCurrentGeometryState } from "./GeometryPanel.tsx";
import { getCurrentOdeState } from "./OdePanel.tsx";
import { getCurrentOdeSystemState } from "./OdeSystemPanel.tsx";
import { getCurrentRegressionState } from "./RegressionPanel.tsx";
import { getCurrentStatisticsState } from "./StatisticsPanel.tsx";
import { getCurrentSystemState } from "./SystemSolverPanel.tsx";
import { type TensorOpType } from "../lib/tensor-block.ts";
import { NotebookComplexBlock } from "./NotebookComplexBlock.tsx";
import { NotebookGeometryBlock } from "./NotebookGeometryBlock.tsx";
import { NotebookTensorBlock } from "./NotebookTensorBlock.tsx";
import { NotebookGraph3DBlock } from "./NotebookGraph3DBlock.tsx";
import { NotebookGraphBlock } from "./NotebookGraphBlock.tsx";
import { NotebookOdeBlock } from "./NotebookOdeBlock.tsx";
import { NotebookOdeSystemBlock } from "./NotebookOdeSystemBlock.tsx";
import { NotebookRegressionBlock } from "./NotebookRegressionBlock.tsx";
import { NotebookStatisticsBlock } from "./NotebookStatisticsBlock.tsx";
import { NotebookSystemsBlock } from "./NotebookSystemsBlock.tsx";

const DEFAULT_SURFACE3D_EXPR = "sin(x)*cos(y)";

type Block =
  | { id: string; type: "text"; content: string }
  | { id: string; type: "graph"; initialSource: string }
  | { id: string; type: "value"; name: string; value: number }
  | { id: string; type: "surface3d"; initialExpr: string; initialParams: Record<string, number> }
  | { id: string; type: "ode"; initialState: OdeState }
  | { id: string; type: "ode-system"; initialState: OdeSystemState }
  | { id: string; type: "regression"; initialState: RegressionState }
  | { id: string; type: "statistics"; initialState: StatisticsState }
  | { id: string; type: "systems"; initialState: SystemState }
  | { id: string; type: "geometry"; initialOps: GeometryOp[] }
  | { id: string; type: "tensor"; source: string; op: TensorOpType; opArg: number }
  | { id: string; type: "complex"; initialState: ComplexState };

/**
 * Seeds a "graph" block's rows/viewport into `graph` (mirrors
 * GraphCanvasMulti's own `seedRow` loop), so by the time NotebookGraphBlock
 * mounts and checks `graph.hasValue(blockIds.expressionList)`, it's already
 * true and NotebookGraphBlock skips its own single-default-row seeding.
 */
function seedGraphBlock(graph: CellGraph, blockId: string, block: NotebookGraphBlockStateV1): void {
  const blockIds = cellIdsNotebookBlock(blockId);
  graph.set(blockIds.viewport, block.viewport, { auxiliary: true });
  const rowIds = block.rows.map(() => crypto.randomUUID());
  rowIds.forEach((rowId, i) => {
    const row = block.rows[i] as NotebookGraphBlockStateV1["rows"][number];
    const ids = cellIdsMultiRow(rowId);
    graph.set(ids.expr, row.source);
    graph.set(ids.color, row.color);
    graph.set(ids.visible, row.visible);
    for (const [name, value] of Object.entries(row.params)) graph.set(ids.param(name), value);
  });
  graph.set(blockIds.expressionList, rowIds, { auxiliary: true });
}

/**
 * Converts a decoded/default NotebookState into this component's own
 * Block[] shape. For "value"/"graph" blocks this also seeds `graph` as a
 * side effect (their own mount-time init is guarded by `hasValue`, so
 * pre-seeding here is safe -- see seedGraphBlock's doc comment). The 6
 * newer block types do NOT get pre-seeded here: their underlying panel's
 * own lazy graph construction establishes `graph.define`d cells guarded by
 * `!graph.has(ids.expr)`, so pre-seeding would skip that setup entirely
 * (see e.g. NotebookOdeBlock's doc comment) -- each's wrapper component
 * seeds itself, in a `useEffect` that runs *after* its underlying panel has
 * already mounted. Fresh crypto.randomUUID() ids are assigned here -- block
 * ids aren't part of the serialized shape, only content/order is.
 */
function hydrateBlocks(graph: CellGraph, state: NotebookState): Block[] {
  return state.blocks.map((b) => {
    const id = crypto.randomUUID();
    if (b.type === "text") return { id, type: "text", content: b.content };
    if (b.type === "value") {
      graph.set(notebookValueCellId(b.name), b.value);
      return { id, type: "value", name: b.name, value: b.value };
    }
    if (b.type === "graph") {
      seedGraphBlock(graph, id, b);
      return { id, type: "graph", initialSource: b.rows[0]?.source ?? "x" };
    }
    if (b.type === "surface3d") return { id, type: "surface3d", initialExpr: b.expr, initialParams: b.params };
    if (b.type === "ode") return { id, type: "ode", initialState: b.state };
    if (b.type === "ode-system") return { id, type: "ode-system", initialState: b.state };
    if (b.type === "regression") return { id, type: "regression", initialState: b.state };
    if (b.type === "statistics") return { id, type: "statistics", initialState: b.state };
    if (b.type === "systems") return { id, type: "systems", initialState: b.state };
    if (b.type === "tensor") return { id, type: "tensor", source: b.source, op: b.op, opArg: b.opArg ?? 1 };
    if (b.type === "complex") return { id, type: "complex", initialState: b.state };
    return { id, type: "geometry", initialOps: b.state.ops };
  });
}

/** Builds the full serializable state of the notebook document -- shared by the URL-sync effect and the save-to-gallery handler. */
function getCurrentNotebookState(graph: CellGraph, blocks: Block[]): NotebookState {
  return {
    v: 1,
    blocks: blocks.map((block): NotebookState["blocks"][number] => {
      if (block.type === "text") return { type: "text", content: block.content };
      if (block.type === "value") return { type: "value", name: block.name, value: block.value };
      if (block.type === "graph") {
        const blockIds = cellIdsNotebookBlock(block.id);
        const rowIds = graph.hasValue(blockIds.expressionList) ? graph.get<string[]>(blockIds.expressionList) : [];
        const rows = rowIds.map((rowId) => {
          const ids = cellIdsMultiRow(rowId);
          const freeVars = graph.hasValue(ids.freeVars) ? graph.get<string[]>(ids.freeVars) : [];
          const params: Record<string, number> = {};
          for (const name of freeVars) params[name] = graph.get<number>(ids.param(name));
          return {
            source: graph.get<string>(ids.expr),
            color: graph.get<number>(ids.color),
            visible: graph.get<boolean>(ids.visible),
            params,
          };
        });
        const viewport = graph.hasValue(blockIds.viewport)
          ? graph.get<NotebookGraphBlockStateV1["viewport"]>(blockIds.viewport)
          : { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };
        return { type: "graph", rows, viewport };
      }
      if (block.type === "surface3d") {
        const ids = cellIds3D(block.id);
        const names = graph.hasValue(ids.freeVars) ? graph.get<string[]>(ids.freeVars) : [];
        const params: Record<string, number> = {};
        for (const name of names) params[name] = graph.get<number>(ids.param(name));
        return { type: "surface3d", expr: graph.get<string>(ids.expr), params };
      }
      if (block.type === "ode") return { type: "ode", state: getCurrentOdeState(graph, cellIdsOde(block.id)) };
      if (block.type === "ode-system") {
        return { type: "ode-system", state: getCurrentOdeSystemState(graph, cellIdsOdeSystem(block.id)) };
      }
      if (block.type === "regression") {
        return { type: "regression", state: getCurrentRegressionState(graph, cellIdsRegression(block.id)) };
      }
      if (block.type === "statistics") {
        return { type: "statistics", state: getCurrentStatisticsState(graph, cellIdsStatistics(block.id)) };
      }
      if (block.type === "systems") return { type: "systems", state: getCurrentSystemState(graph, cellIdsSystem(block.id)) };
      if (block.type === "tensor") return { type: "tensor", source: block.source, op: block.op, opArg: block.opArg };
      if (block.type === "complex") return { type: "complex", state: getCurrentComplexState(graph, cellIdsComplex(block.id)) };
      return { type: "geometry", state: getCurrentGeometryState(graph, cellIdsGeometry(block.id)) };
    }),
  };
}

/** Triggers a browser download of `content` as a plain-text file -- same Blob+anchor pattern GraphCanvas's own video export uses, minus the base64 decode step since this is already a text string. */
function downloadTextFile(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * v1 reactive notebook surface: an ordered, editable list of blocks (text,
 * graph, or a named value), built directly on CellGraph -- the biggest
 * single item from the research roadmap, scoped down deliberately.
 *
 * All graph and value blocks share ONE `CellGraph` (constructed once here,
 * passed down to each `NotebookGraphBlock`), which is what makes
 * cross-cell references possible: a value block's cell is keyed by its
 * user-given `name` (see `notebookValueCellId`), so any graph block's free
 * variable matching that name resolves to it live (see ExpressionRow's
 * `ids.params` compute) instead of getting an independent local slider.
 * Referencing another block's entire curve/function (not just a named
 * scalar) stays out of v1 scope.
 *
 * Hydrates from the URL hash (notebook-state.ts) when present, mirroring
 * GraphCanvasMulti's own useMultiGraph mechanism exactly -- including its
 * same latent SSR/hydration tradeoff: the `typeof window !== "undefined"`
 * guard means a fresh server render always sees no hash (so server and a
 * *hash-less* client load agree), but a page loaded directly with a
 * pre-existing hash will decode differently between server and client,
 * same as GraphCanvasMulti already does today. Not a new risk introduced
 * here, just the same accepted tradeoff applied consistently.
 *
 * "Fork this view" and "Save to gallery" mirror GraphCanvasMulti's
 * `forkView`/`handleSave` exactly. Block add/remove/reorder/text-edit is
 * plain React state (not something `graph.subscribeAll` observes the way
 * row add/remove already does via EXPRESSION_LIST_CELL in GraphCanvasMulti),
 * so the URL-sync effect re-runs on every `blocks` change too, not just
 * every graph mutation.
 */
export function NotebookPanel() {
  const graphRef = useRef<CellGraph | null>(null);
  if (!graphRef.current) graphRef.current = new CellGraph();
  const graph = graphRef.current;
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [blocks, setBlocks] = useState<Block[]>(() => {
    const decoded = typeof window !== "undefined" ? decodeNotebookState(window.location.hash.slice(1)) : null;
    return hydrateBlocks(graph, decoded ?? DEFAULT_NOTEBOOK_STATE);
  });

  // Issue #43's "per-panel adoption": the multi-expression panel proved the
  // shape (PR #97), this is the second adopter. `extraTrigger: blocks`
  // (see use-undo-history.ts's own doc comment) covers the structural half
  // (add/remove/reorder/text-edit) that lives in React state, not
  // CellGraph cells; `graph.subscribeAll` alone (as GraphCanvasMulti uses
  // unmodified) covers in-block edits (an expression, a value block's
  // number, a slider drag).
  //
  // KNOWN LIMITATION, deliberately deferred rather than attempted here:
  // `hydrateBlocks` (used as the restore function) always mints fresh
  // `crypto.randomUUID()` block/row ids, the same "no id-based join" choice
  // `captureGraphBlockImages` above makes -- so an undo/redo does NOT
  // delete the PREVIOUS block set's own CellGraph cells the way
  // GraphCanvasMulti's `restoreMultiGraphState` explicitly walks `oldIds`
  // to clean up. For "graph"/"value" blocks the leaked cells are small and
  // bounded per undo step. For geometry blocks specifically, full cleanup
  // isn't even mechanically possible from here: `cellIdsGeometry`'s own
  // per-object (point/line/circle/...) ids are `crypto.randomUUID()`s
  // discoverable only by reading that block's OWN `objectList` cell first,
  // not derivable from the block id alone. A real fix needs a shared
  // "dispose everything this block's cellIdsX namespace owns, including
  // any of its own dynamic child ids" helper across all 8 block-type
  // wrappers -- meaningfully larger than this pass; long editing sessions
  // with heavy undo/redo use will accumulate orphaned cells in memory
  // until reload, same class of accepted tradeoff #97's own status note
  // already documents for the snapshot-vs-op-log design choice.
  const history = useUndoHistory(
    graph,
    () => getCurrentNotebookState(graph, blocks),
    (state) => setBlocks(hydrateBlocks(graph, state)),
    250,
    blocks,
  );

  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const saveGraphFn = useServerFn(saveGraph);

  useCellGraphTools("notebook", graph);

  function forkView() {
    window.open(window.location.href, "_blank");
  }

  async function handleSave() {
    const title = window.prompt("Title for this saved notebook:", "Untitled");
    if (title === null) return;
    setSaveStatus("Saving…");
    try {
      await saveGraphFn({ data: { title, kind: "notebook", state: getCurrentNotebookState(graph, blocks) } });
      setSaveStatus(`Saved as "${title || "Untitled"}" — see the gallery to reopen it.`);
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Scoped by data-block-type="graph" (set on each block's wrapper below)
  // rather than a plain unscoped canvas query -- several other block types
  // (surface3d, ode, ...) also render a <canvas>, so an unscoped query
  // would pick up the wrong element the moment a document mixes graph
  // blocks with any of those. Correlated by POSITION among graph blocks
  // (not by matching `block.id` against the DOM's data-block-id) since
  // block ids aren't guaranteed stable identifiers to join against here --
  // the nth graph-type entry in `blocks` and the nth `[data-block-type="graph"]
  // canvas in document order both come from rendering the same list in the
  // same order, so pairing by position is robust regardless.
  function captureGraphBlockImages(): NotebookGraphImages {
    const images: NotebookGraphImages = new Map();
    const canvases = containerRef.current?.querySelectorAll<HTMLCanvasElement>('[data-block-type="graph"] canvas');
    let canvasIndex = 0;
    blocks.forEach((block, i) => {
      if (block.type !== "graph") return;
      const canvas = canvases?.[canvasIndex];
      canvasIndex++;
      if (canvas) images.set(i, canvas.toDataURL("image/png"));
    });
    return images;
  }

  function handleExportMarkdown() {
    const md = notebookToMarkdown(getCurrentNotebookState(graph, blocks), captureGraphBlockImages());
    downloadTextFile(md, "mallory-graph-notebook.md");
  }

  function handleExportLatex() {
    const tex = notebookToLatex(getCurrentNotebookState(graph, blocks));
    downloadTextFile(tex, "mallory-graph-notebook.tex");
  }

  // Mirrors GraphCanvasMulti's own writeUrl/subscribeAll pattern, plus a
  // second trigger on `blocks` itself (see this component's doc comment for
  // why: block add/remove/reorder/text-edit is plain React state, not a
  // graph mutation `subscribeAll` would ever see).
  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeNotebookState(getCurrentNotebookState(graph, blocks))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, blocks]);

  function addTextBlock() {
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), type: "text", content: "" }]);
  }

  function addGraphBlock() {
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), type: "graph", initialSource: "x" }]);
  }

  function addSurface3DBlock() {
    setBlocks((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type: "surface3d", initialExpr: DEFAULT_SURFACE3D_EXPR, initialParams: {} },
    ]);
  }

  function addOdeBlock() {
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), type: "ode", initialState: DEFAULT_ODE_STATE }]);
  }

  function addOdeSystemBlock() {
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), type: "ode-system", initialState: DEFAULT_ODE_SYSTEM_STATE }]);
  }

  function addRegressionBlock() {
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), type: "regression", initialState: DEFAULT_REGRESSION_STATE }]);
  }

  function addStatisticsBlock() {
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), type: "statistics", initialState: DEFAULT_STATISTICS_STATE }]);
  }

  function addSystemsBlock() {
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), type: "systems", initialState: DEFAULT_SYSTEM_STATE }]);
  }

  function addGeometryBlock() {
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), type: "geometry", initialOps: DEFAULT_GEOMETRY_STATE.ops }]);
  }

  function addTensorBlock() {
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), type: "tensor", source: "1 2 3\n4 5 6\n7 8 9", op: "none", opArg: 1 }]);
  }

  function addComplexBlock() {
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), type: "complex", initialState: DEFAULT_COMPLEX_STATE }]);
  }

  function updateTensorSource(id: string, source: string) {
    setBlocks((prev) => prev.map((b) => (b.id === id && b.type === "tensor" ? { ...b, source } : b)));
  }

  function updateTensorOp(id: string, op: TensorOpType) {
    setBlocks((prev) => prev.map((b) => (b.id === id && b.type === "tensor" ? { ...b, op } : b)));
  }

  function updateTensorOpArg(id: string, opArg: number) {
    setBlocks((prev) => prev.map((b) => (b.id === id && b.type === "tensor" ? { ...b, opArg } : b)));
  }

  // Single-letter names only: implicit-mult.ts's tokenizer splits any
  // unrecognized multi-letter run into single-char variables multiplied
  // together (see its own doc comment), so a default name like "k1" would
  // parse as "k*1" -- two separate tokens, not one referenceable
  // identifier -- silently defeating the whole point of naming a value.
  // "x"/"y" are reserved (axis variable / dependent variable).
  const VALUE_NAME_POOL = "kmnabcdfghpqrstuvwz".split("");

  function addValueBlock() {
    const index = blocks.filter((b) => b.type === "value").length;
    const name = VALUE_NAME_POOL[index % VALUE_NAME_POOL.length] as string;
    graph.set(notebookValueCellId(name), 1);
    setBlocks((prev) => [...prev, { id: crypto.randomUUID(), type: "value", name, value: 1 }]);
  }

  // Removing a block also deletes its cells from the shared CellGraph --
  // same correctness reasoning as updateValueName's rename cleanup below: a
  // graph block still referencing a removed value block's name must fall
  // back to its own local slider (CellGraph.delete notifies former
  // dependents), not silently keep reading an orphaned cell forever. The
  // deletes happen outside the setBlocks updater (which stays pure), before
  // it, so any reentrant redraw a delete triggers still sees the block's
  // remaining cells; a graph block's expressionList/viewport are deleted
  // last since its still-mounted redraw reads them unguarded.
  function removeBlock(id: string) {
    const removed = blocks.find((b) => b.id === id);
    if (removed?.type === "value") {
      const nameStillUsedElsewhere = blocks.some((b) => b.id !== id && b.type === "value" && b.name === removed.name);
      if (!nameStillUsedElsewhere) graph.delete(notebookValueCellId(removed.name));
    } else if (removed?.type === "graph") {
      const blockIds = cellIdsNotebookBlock(id);
      if (graph.hasValue(blockIds.expressionList)) {
        for (const rowId of graph.get<string[]>(blockIds.expressionList)) {
          const ids = cellIdsMultiRow(rowId);
          // Read the row's free-var names before deleting anything, to
          // enumerate its per-name param cells (ids.param is a function,
          // not a fixed id, so they can't come from Object.values below).
          const freeVars = graph.hasValue(ids.freeVars) ? graph.get<string[]>(ids.freeVars) : [];
          for (const name of freeVars) graph.delete(ids.param(name));
          for (const cellId of Object.values(ids)) {
            if (typeof cellId === "string") graph.delete(cellId);
          }
        }
      }
      graph.delete(blockIds.expressionList);
      graph.delete(blockIds.viewport);
    } else if (removed?.type === "surface3d") {
      const ids = cellIds3D(id);
      const names = graph.hasValue(ids.freeVars) ? graph.get<string[]>(ids.freeVars) : [];
      for (const name of names) {
        graph.delete(ids.param(name));
        graph.delete(ids.track(name));
      }
      for (const cellId of Object.values(ids)) {
        if (typeof cellId === "string") graph.delete(cellId);
      }
    } else if (removed?.type === "ode") {
      for (const cellId of Object.values(cellIdsOde(id))) graph.delete(cellId);
    } else if (removed?.type === "ode-system") {
      for (const cellId of Object.values(cellIdsOdeSystem(id))) graph.delete(cellId);
    } else if (removed?.type === "regression") {
      for (const cellId of Object.values(cellIdsRegression(id))) graph.delete(cellId);
    } else if (removed?.type === "statistics") {
      for (const cellId of Object.values(cellIdsStatistics(id))) graph.delete(cellId);
    } else if (removed?.type === "systems") {
      for (const cellId of Object.values(cellIdsSystem(id))) graph.delete(cellId);
    } else if (removed?.type === "geometry") {
      // Only the object-list/ops-log cells are namespaced by this block's
      // id; every individual object cell (point/line/circle/...) is left as
      // a harmless orphan, matching this codebase's existing tolerance for
      // orphaned cells on removal (see cellIdsGeometry's own doc comment).
      const listIds = cellIdsGeometry(id);
      graph.delete(listIds.objectList);
      graph.delete(listIds.opsLog);
    } else if (removed?.type === "complex") {
      const ids = cellIdsComplex(id);
      const names = graph.hasValue(ids.freeVars) ? graph.get<string[]>(ids.freeVars) : [];
      for (const name of names) graph.delete(ids.param(name));
      for (const cellId of Object.values(ids)) {
        if (typeof cellId === "string") graph.delete(cellId);
      }
    }
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  /** Swaps a block with its immediate neighbor in the given direction -- a no-op at either end of the list. */
  function moveBlock(id: string, direction: -1 | 1) {
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      const j = i + direction;
      if (i === -1 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j] as Block, next[i] as Block];
      return next;
    });
  }

  function updateText(id: string, content: string) {
    setBlocks((prev) => prev.map((b) => (b.id === id && b.type === "text" ? { ...b, content } : b)));
  }

  // Renaming writes the value under the NEW name's cell, then removes the
  // OLD name's cell -- unless another still-active value block shares that
  // old name (a pre-existing ambiguity this component doesn't otherwise
  // prevent: two value blocks with the same name both write into the same
  // cell), in which case deleting it would silently break that other
  // block's live value out from under it, so it's left alone in that case.
  function updateValueName(id: string, name: string) {
    setBlocks((prev) => {
      const renamed = prev.find((b) => b.id === id && b.type === "value");
      if (!renamed || renamed.type !== "value") return prev;
      const oldName = renamed.name;
      const oldNameStillUsedElsewhere = prev.some((b) => b.id !== id && b.type === "value" && b.name === oldName);
      graph.set(notebookValueCellId(name), renamed.value);
      if (oldName !== name && !oldNameStillUsedElsewhere) graph.delete(notebookValueCellId(oldName));
      return prev.map((b) => (b.id === id && b.type === "value" ? { ...b, name } : b));
    });
  }

  function updateValueNumber(id: string, value: number) {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== id || b.type !== "value") return b;
        graph.set(notebookValueCellId(b.name), value);
        return { ...b, value };
      }),
    );
  }

  useModelContextTool({
    name: "notebook_list_blocks",
    description: "List every block in the notebook, in order, with its id, type, and type-specific content.",
    inputSchema: { type: "object", properties: {} },
    handler: () => blocks,
  });

  useModelContextTool({
    name: "notebook_add_text_block",
    description: "Append a text block to the end of the notebook.",
    inputSchema: {
      type: "object",
      properties: { content: { type: "string", description: "Initial text content (default empty)." } },
    },
    handler: (input: Record<string, unknown>) => {
      const id = crypto.randomUUID();
      const content = typeof input.content === "string" ? input.content : "";
      setBlocks((prev) => [...prev, { id, type: "text", content }]);
      return { id };
    },
  });

  useModelContextTool({
    name: "notebook_add_graph_block",
    description: "Append a graph block (a mini multi-expression grapher) to the end of the notebook.",
    inputSchema: {
      type: "object",
      properties: { source: { type: "string", description: 'Initial expression, e.g. "x" or "k*sin(x)" (default "x").' } },
    },
    handler: (input: Record<string, unknown>) => {
      const id = crypto.randomUUID();
      const initialSource = typeof input.source === "string" && input.source.trim() ? input.source : "x";
      setBlocks((prev) => [...prev, { id, type: "graph", initialSource }]);
      return { id };
    },
  });

  useModelContextTool({
    name: "notebook_add_surface3d_block",
    description: "Append a 3D-surface block (z = f(x, y)) to the end of the notebook.",
    inputSchema: {
      type: "object",
      properties: { expr: { type: "string", description: `Initial z(x,y) expression (default "${DEFAULT_SURFACE3D_EXPR}").` } },
    },
    handler: (input: Record<string, unknown>) => {
      const id = crypto.randomUUID();
      const initialExpr = typeof input.expr === "string" && input.expr.trim() ? input.expr : DEFAULT_SURFACE3D_EXPR;
      setBlocks((prev) => [...prev, { id, type: "surface3d", initialExpr, initialParams: {} }]);
      return { id };
    },
  });

  useModelContextTool({
    name: "notebook_add_ode_block",
    description: "Append a single-ODE block (dy/dx = f(x,y), plotted against its slope field) to the end of the notebook.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const id = crypto.randomUUID();
      setBlocks((prev) => [...prev, { id, type: "ode", initialState: DEFAULT_ODE_STATE }]);
      return { id };
    },
  });

  useModelContextTool({
    name: "notebook_add_ode_system_block",
    description: "Append a coupled-ODE-system block (a phase portrait) to the end of the notebook.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const id = crypto.randomUUID();
      setBlocks((prev) => [...prev, { id, type: "ode-system", initialState: DEFAULT_ODE_SYSTEM_STATE }]);
      return { id };
    },
  });

  useModelContextTool({
    name: "notebook_add_regression_block",
    description: "Append a regression block (linear or nonlinear curve fit over a spreadsheet-style row list) to the end of the notebook.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const id = crypto.randomUUID();
      setBlocks((prev) => [...prev, { id, type: "regression", initialState: DEFAULT_REGRESSION_STATE }]);
      return { id };
    },
  });

  useModelContextTool({
    name: "notebook_add_statistics_block",
    description: "Append a statistics block (descriptive stats + a distribution probability calculator) to the end of the notebook.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const id = crypto.randomUUID();
      setBlocks((prev) => [...prev, { id, type: "statistics", initialState: DEFAULT_STATISTICS_STATE }]);
      return { id };
    },
  });

  useModelContextTool({
    name: "notebook_add_systems_block",
    description: "Append a system-of-equations solver block to the end of the notebook.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const id = crypto.randomUUID();
      setBlocks((prev) => [...prev, { id, type: "systems", initialState: DEFAULT_SYSTEM_STATE }]);
      return { id };
    },
  });

  useModelContextTool({
    name: "notebook_add_geometry_block",
    description: "Append a geometry-construction block (points, lines, circles, transforms) to the end of the notebook.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const id = crypto.randomUUID();
      setBlocks((prev) => [...prev, { id, type: "geometry", initialOps: DEFAULT_GEOMETRY_STATE.ops }]);
      return { id };
    },
  });

  useModelContextTool({
    name: "notebook_add_complex_block",
    description: "Append a complex-plane block (domain coloring of f(z), a probe point, roots-of-unity/conformal-grid overlays) to the end of the notebook.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const id = crypto.randomUUID();
      setBlocks((prev) => [...prev, { id, type: "complex", initialState: DEFAULT_COMPLEX_STATE }]);
      return { id };
    },
  });

  useModelContextTool({
    name: "notebook_add_value_block",
    description: 'Append a named value block, referenceable by name (e.g. "k") from any graph block\'s expressions in this notebook. Name must be a single lowercase letter other than x/y (this app\'s expression parser splits any longer name into single-letter variables multiplied together).',
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "A single lowercase letter, not x or y." },
        value: { type: "number", description: "Initial value (default 1)." },
      },
      required: ["name"],
    },
    handler: (input: Record<string, unknown>) => {
      const name = String(input.name ?? "");
      if (!/^[a-z]$/.test(name) || name === "x" || name === "y") {
        throw new Error('name must be a single lowercase letter, not "x" or "y".');
      }
      const value = input.value === undefined ? 1 : Number(input.value);
      graph.set(notebookValueCellId(name), value);
      const id = crypto.randomUUID();
      setBlocks((prev) => [...prev, { id, type: "value", name, value }]);
      return { id, name, value };
    },
  });

  useModelContextTool({
    name: "notebook_add_tensor_block",
    description:
      "Append a tensor block (a small literal 2D grid, one row per line, rendered as a heat-colored table with an optional tensor op applied) to the end of the notebook.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: 'Grid text, one row per line, numbers separated by spaces/commas (default a 3x3 example).' },
        op: {
          type: "string",
          enum: ["none", "abs", "neg", "exp", "sqrt", "clip01", "transpose", "fliplr", "flipud", "roll", "pad", "repeat"],
          description: 'Display op applied to the grid (default "none"). "pad"/"repeat" read opArg.',
        },
        opArg: {
          type: "number",
          description: 'Only read by "pad" (border width, default 1) and "repeat" (row-repeat count, default 1); ignored by every other op.',
        },
      },
    },
    handler: (input: Record<string, unknown>) => {
      const id = crypto.randomUUID();
      const source = typeof input.source === "string" && input.source.trim() ? input.source : "1 2 3\n4 5 6\n7 8 9";
      const op = (typeof input.op === "string" ? input.op : "none") as TensorOpType;
      const opArg = typeof input.opArg === "number" ? input.opArg : 1;
      setBlocks((prev) => [...prev, { id, type: "tensor", source, op, opArg }]);
      return { id };
    },
  });

  useModelContextTool({
    name: "notebook_remove_block",
    description: "Remove a block by id (as reported by notebook_list_blocks).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    handler: (input: Record<string, unknown>) => {
      const id = String(input.id ?? "");
      if (!blocks.some((b) => b.id === id)) throw new Error(`No block with id "${id}".`);
      removeBlock(id);
      return { ok: true };
    },
  });

  return (
    <div ref={containerRef}>
      {blocks.map((block, i) => (
        <div
          key={block.id}
          data-block-id={block.id}
          data-block-type={block.type}
          style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", margin: "0.75rem 0" }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <button
              type="button"
              onClick={() => moveBlock(block.id, -1)}
              disabled={i === 0}
              title="Move up"
              aria-label="Move block up"
              style={{ lineHeight: 1, padding: "0.15rem 0.4rem" }}
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() => moveBlock(block.id, 1)}
              disabled={i === blocks.length - 1}
              title="Move down"
              aria-label="Move block down"
              style={{ lineHeight: 1, padding: "0.15rem 0.4rem" }}
            >
              ▼
            </button>
          </div>
          <div style={{ flex: 1 }}>
            {block.type === "text" ? (
              <textarea
                value={block.content}
                onChange={(e) => updateText(block.id, e.target.value)}
                rows={3}
                style={{ width: "100%", font: "inherit", padding: "0.5rem", boxSizing: "border-box" }}
              />
            ) : block.type === "value" ? (
              <label style={{ fontSize: "0.9rem" }}>
                value{" "}
                <input
                  value={block.name}
                  onChange={(e) => updateValueName(block.id, e.target.value)}
                  style={{ font: "inherit", width: "8ch" }}
                />{" "}
                ={" "}
                <input
                  type="number"
                  value={block.value}
                  onChange={(e) => updateValueNumber(block.id, Number(e.target.value))}
                  style={{ font: "inherit", width: "10ch" }}
                />
              </label>
            ) : block.type === "graph" ? (
              <NotebookGraphBlock graph={graph} blockId={block.id} initialSource={block.initialSource} />
            ) : block.type === "surface3d" ? (
              <NotebookGraph3DBlock graph={graph} blockId={block.id} initialExpr={block.initialExpr} initialParams={block.initialParams} />
            ) : block.type === "ode" ? (
              <NotebookOdeBlock graph={graph} blockId={block.id} initialState={block.initialState} />
            ) : block.type === "ode-system" ? (
              <NotebookOdeSystemBlock graph={graph} blockId={block.id} initialState={block.initialState} />
            ) : block.type === "regression" ? (
              <NotebookRegressionBlock graph={graph} blockId={block.id} initialState={block.initialState} />
            ) : block.type === "statistics" ? (
              <NotebookStatisticsBlock graph={graph} blockId={block.id} initialState={block.initialState} />
            ) : block.type === "systems" ? (
              <NotebookSystemsBlock graph={graph} blockId={block.id} initialState={block.initialState} />
            ) : block.type === "tensor" ? (
              <NotebookTensorBlock
                source={block.source}
                op={block.op}
                opArg={block.opArg}
                onSourceChange={(source) => updateTensorSource(block.id, source)}
                onOpChange={(op) => updateTensorOp(block.id, op)}
                onOpArgChange={(opArg) => updateTensorOpArg(block.id, opArg)}
              />
            ) : block.type === "complex" ? (
              <NotebookComplexBlock graph={graph} blockId={block.id} initialState={block.initialState} />
            ) : (
              <NotebookGeometryBlock graph={graph} blockId={block.id} initialOps={block.initialOps} />
            )}
          </div>
          <button type="button" onClick={() => removeBlock(block.id)} title="Remove this block">
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.5rem 0" }}>
        <button type="button" onClick={addTextBlock}>
          + Text block
        </button>
        <button type="button" onClick={addGraphBlock}>
          + Graph block
        </button>
        <button type="button" onClick={addSurface3DBlock}>
          + 3D surface block
        </button>
        <button type="button" onClick={addOdeBlock}>
          + ODE block
        </button>
        <button type="button" onClick={addOdeSystemBlock}>
          + ODE system block
        </button>
        <button type="button" onClick={addRegressionBlock}>
          + Regression block
        </button>
        <button type="button" onClick={addStatisticsBlock}>
          + Statistics block
        </button>
        <button type="button" onClick={addSystemsBlock}>
          + Systems block
        </button>
        <button type="button" onClick={addGeometryBlock}>
          + Geometry block
        </button>
        <button type="button" onClick={addTensorBlock}>
          + Tensor block
        </button>
        <button type="button" onClick={addComplexBlock}>
          + Complex block
        </button>
        <button type="button" onClick={addValueBlock}>
          + Value block
        </button>
        <button type="button" onClick={forkView} title="Open this exact document in a new tab to explore an alternate path">
          Fork this view
        </button>
        <button type="button" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z / Cmd+Z)">
          ↩ Undo
        </button>
        <button type="button" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z / Cmd+Y)">
          ↪ Redo
        </button>
        <button type="button" onClick={handleSave}>
          Save to gallery
        </button>
        <button type="button" onClick={handleExportMarkdown} title="Export this document as a self-contained Markdown file with embedded graph images">
          Export .md
        </button>
        <button type="button" onClick={handleExportLatex} title="Export this document as a LaTeX fragment (equations typeset, no raster images)">
          Export .tex
        </button>
      </div>
      {saveStatus && <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{saveStatus}</p>}
    </div>
  );
}
