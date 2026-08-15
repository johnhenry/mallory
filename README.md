# mallory-graph

An interactive graphing calculator built on [mallory-math](https://github.com/johnhenry/mallory)
(the [`mallory-math`](https://www.npmjs.com/package/mallory-math) npm package): a reactive
`CellGraph` core drives sampling/differentiation/integration through `Symbolic`, rendered via
Canvas2D (curves, inequality shading, area-under-curve) and Three.js (3D surfaces). Also includes
a natural-language query layer, a linear system-of-equations solver, and MP4/GIF export.

## A note on "graph"

Three unrelated concepts share this name across the Mallory family — worth
knowing before it trips you up:

| Name | Meaning |
|---|---|
| **mallory-graph** (this app) | *plotting* — a graphing calculator |
| `Graph<T>` in [mallory-math](https://github.com/johnhenry/mallory) | *graph theory* — bfs/dfs/dijkstra/MST/topological sort |
| `CellGraph` (`src/lib/cell-graph.ts` here) | *reactive dependency graph* — this app's own reactive core |

If you're reading across the family and see "graph" in an import or a type
name, check which of the three it means before assuming.

## Development

```bash
npm install
npm run dev
```

See **[docs/COOKBOOK.md](docs/COOKBOOK.md)** for runnable examples of the
reusable pieces in `src/lib/` (`CellGraph`, the sampler layer, the graph-
theory/matrix/NL-query/interval-arithmetic bridges) -- every example there
is executed in CI (`src/lib/cookbook.test.ts`), so it can't silently drift
out of date with the code.

## Deployment

Deployed to Dokku at `mallory-graph.johnhenry.me` via Nixpacks. Push to `main`
to trigger a build; see `nixpacks.toml` and `Procfile`.

