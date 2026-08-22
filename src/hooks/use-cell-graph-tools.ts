import { CellGraph } from "@johnhenry/math";
import { useModelContextTool } from "./use-model-context-tool.ts";

/**
 * Registers a generic list/get/set triple of WebMCP tools against one panel's
 * CellGraph -- the app-agent-drivability pass (see the plan). Every
 * CellGraph-native panel already funnels its whole state through
 * `graph.get`/`graph.set`/`graph.list`, the same introspection AlgebraView
 * shows a human, so one shared hook gives an external AI agent full
 * read/write access with no panel-specific tool-writing.
 *
 * `set_cell` refuses to touch a `dependent` (computed via `graph.define`)
 * cell: `CellGraph.set()` unconditionally clears a cell's `compute` fn, so
 * a naive "just call set" tool would silently and permanently convert a
 * reactive cell into a static one the moment an agent guessed wrong about
 * which cell was the "input." Only `free`/`unknown`-role cells are settable;
 * the error message names the free cells `list_cells` reports, so a caller
 * can self-correct without a separate discovery round-trip.
 */
export function useCellGraphTools(prefix: string, graph: CellGraph): void {
  useModelContextTool({
    name: `${prefix}_list_cells`,
    description: `List every cell on the ${prefix} panel's reactive graph, with its role (free/dependent/unknown) and whether it currently holds a value. Mirrors what this panel's own Objects list shows a human.`,
    inputSchema: { type: "object", properties: {} } as const,
    handler: async () => graph.list(),
  });

  useModelContextTool({
    name: `${prefix}_get_cell`,
    description: `Read one cell's current value from the ${prefix} panel's reactive graph. Call ${prefix}_list_cells first to see available cell ids.`,
    inputSchema: {
      type: "object",
      properties: {
        cellId: { type: "string", description: "The cell id, as reported by list_cells." },
      },
      required: ["cellId"],
    } as const,
    handler: async (input: Record<string, unknown>) => {
      const cellId = String(input.cellId ?? "");
      return graph.get(cellId);
    },
  });

  useModelContextTool({
    name: `${prefix}_set_cell`,
    description: `Write a value into a *free* (non-computed) cell on the ${prefix} panel's reactive graph -- e.g. an expression source, a parameter, a domain bound. Rejects dependent (computed) cells, since writing to one would permanently convert it from reactive to static. Call ${prefix}_list_cells to see which cells have role "free".`,
    inputSchema: {
      type: "object",
      properties: {
        cellId: { type: "string", description: "The cell id, as reported by list_cells." },
        value: { description: "The new value (any JSON-serializable value matching what this cell normally holds)." },
      },
      required: ["cellId", "value"],
    } as const,
    handler: async (input: Record<string, unknown>) => {
      const cellId = String(input.cellId ?? "");
      const value = input.value;
      const role = graph.role(cellId);
      if (role === "dependent") {
        const settable = graph
          .list()
          .filter((c) => c.role !== "dependent")
          .map((c) => c.id);
        throw new Error(
          `"${cellId}" is a dependent (computed) cell and can't be set directly. Settable cells on this panel: ${settable.join(", ") || "(none yet)"}.`,
        );
      }
      graph.set(cellId, value);
      return { ok: true, cellId, role: graph.role(cellId) };
    },
  });
}
