import type { CubeTile, CubeTileSet } from "./tiles/cube-tile-model.ts";

/**
 * Line-based text format for a cube Wang tile set -- `id N S E W U D` (id
 * then the six face labels in that fixed order), mirroring hex-tile-set-
 * text.ts's/tri-tile-set-text.ts's own format exactly (same blank-line/
 * `#`-comment handling, same duplicate-id check).
 */
export function parseCubeTileSetText(text: string): CubeTileSet {
  const tiles: CubeTile[] = [];
  const seenIds = new Set<string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 7) {
      throw new Error(`Line ${i + 1}: expected "id N S E W U D" (7 fields), got ${parts.length}: "${line}"`);
    }
    const [id, N, S, E, W, U, D] = parts as [string, string, string, string, string, string, string];
    if (seenIds.has(id)) throw new Error(`Line ${i + 1}: duplicate tile id "${id}"`);
    seenIds.add(id);
    tiles.push({ id, faces: { N, S, E, W, U, D } });
  }
  if (tiles.length === 0) throw new Error("No tiles defined -- add at least one line: id N S E W U D");
  return { tiles };
}

export function cubeTileSetToText(tileSet: CubeTileSet): string {
  return tileSet.tiles.map((t) => [t.id, t.faces.N, t.faces.S, t.faces.E, t.faces.W, t.faces.U, t.faces.D].join(" ")).join("\n");
}

/**
 * Two tiles compatible N<->S (A.N="1" matches B.S="1", B.N="2" matches
 * A.S="2") but wildcard-compatible on every other face, same demo shape as
 * the hex/tri lattices' own defaults.
 */
export const DEFAULT_CUBE_TILES_TEXT = "A 1 2 x x x x\nB 2 1 x x x x";
