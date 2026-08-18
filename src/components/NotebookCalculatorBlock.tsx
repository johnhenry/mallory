import { CalculatorPanel } from "./CalculatorPanel.tsx";

/**
 * A calculator notebook block (issue #255's audit finding: no notebook
 * block existed for the standalone `/calculator` REPL panel). Unlike every
 * other `NotebookXBlock` wrapper, this needs no CellGraph seeding effect --
 * `CalculatorPanel` owns no CellGraph cells at all (see its own doc
 * comment), so there's no `cellIdsX(blockId)`-namespaced state to seed on
 * mount. The only thing this wrapper does is thread `blockId` through as
 * `CalculatorPanel`'s `instanceId`, which scopes its `localStorage` key and
 * WebMCP tool names so multiple calculator blocks (or a block alongside the
 * standalone page) don't collide -- see `CalculatorPanel`'s own doc comment
 * for why that scoping was a prerequisite, not optional.
 *
 * Deliberately NOT part of `NotebookState`'s serialized document (no
 * `NotebookCalculatorBlockStateV1`, no fields in `notebook-state.ts` beyond
 * the bare `{ type: "calculator" }` marker): a calculator block's history
 * lives in its own `localStorage` entry, same as the standalone page,
 * matching `CalculatorPanel`'s own design choice that "a scratch
 * calculation isn't the kind of thing worth a shareable link." Undo/redo
 * and Fork-this-view therefore don't reach into a calculator block's
 * scratch history, same as they already don't reach into the standalone
 * page's -- consistent, not a new gap.
 */
export function NotebookCalculatorBlock({ blockId }: { blockId: string }) {
  return <CalculatorPanel instanceId={blockId} />;
}
