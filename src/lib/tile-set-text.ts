import type { Direction, Tile, TileSet } from "./tiles/tile-model.ts";

/**
 * Lightweight line-based text format for a Wang tile set -- one tile per
 * line, `id N E S W` (space-separated id then the four edge labels in
 * clockwise-from-north order), matching the family's existing convention of
 * a small custom text grammar per panel (e.g. GraphTheoryPanel's edge-list
 * text) rather than a JSON blob, so it stays hand-editable in a textarea.
 * Blank lines and lines starting with `#` are ignored.
 *
 * A trailing `*` directly on the id (`A* N E S W`) marks the tile
 * orientation-locked (issue #414, `Tile.locked` -- see tile-model.ts's own
 * doc comment): `expandTileSetSymmetry` leaves it at its single literal
 * orientation even when the chosen symmetry group would otherwise expand
 * it. The `*` is stripped from the parsed `id` (so `"A*"` and `"A"` can't
 * silently collide as distinct ids) and re-added by `tileSetToText` for any
 * `locked` tile, so a locked tile round-trips through the editor unchanged.
 */
const DIRECTIONS: Direction[] = ["N", "E", "S", "W"];

export function parseTileSetText(text: string): TileSet {
  const tiles: Tile[] = [];
  const seenIds = new Set<string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Line ${i + 1}: expected "id N E S W" (5 fields), got ${parts.length}: "${line}"`);
    }
    const [rawId, n, e, s, w] = parts as [string, string, string, string, string];
    const locked = rawId.endsWith("*");
    const id = locked ? rawId.slice(0, -1) : rawId;
    if (id === "") throw new Error(`Line ${i + 1}: tile id can't be empty (just "*")`);
    if (seenIds.has(id)) throw new Error(`Line ${i + 1}: duplicate tile id "${id}"`);
    seenIds.add(id);
    tiles.push(locked ? { id, edges: { N: n, E: e, S: s, W: w }, locked: true } : { id, edges: { N: n, E: e, S: s, W: w } });
  }
  if (tiles.length === 0) throw new Error("No tiles defined -- add at least one line: id N E S W");
  return { tiles };
}

export function tileSetToText(tileSet: TileSet): string {
  return tileSet.tiles.map((t) => [t.locked ? `${t.id}*` : t.id, ...DIRECTIONS.map((d) => t.edges[d])].join(" ")).join("\n");
}

/**
 * A small default demo set: two tiles that alternate horizontally (A.E
 * matches B.W and vice versa) but are wildcard-compatible vertically (N=S=x
 * for both), so the default view shows real edge-matching behavior on
 * load and -- since the grid's default width is even -- also happens to
 * satisfy torus periodicity, letting the "torus" solver variant succeed
 * out of the box too.
 */
export const DEFAULT_TILES_TEXT = "A x 1 x 2\nB x 2 x 1";
