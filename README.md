# mallory

An interactive graphing calculator built on [mallory-math](https://github.com/johnhenry/math)
(the [`@johnhenry/math`](https://www.npmjs.com/package/@johnhenry/math) npm package): a reactive
`CellGraph` core drives sampling/differentiation/integration through `Symbolic`, rendered via
Canvas2D (curves, inequality shading, area-under-curve) and Three.js (3D surfaces). Also includes
a natural-language query layer, a linear system-of-equations solver, and MP4/GIF export.

## A note on "graph"

Two unrelated concepts still share this name, now that the app itself is
just "mallory" rather than "mallory-graph" — worth knowing before it trips
you up:

| Name | Meaning |
|---|---|
| `Graph<T>` in [mallory-math](https://github.com/johnhenry/math) | *graph theory* — bfs/dfs/dijkstra/MST/topological sort |
| `CellGraph` (imported from `@johnhenry/math`, promoted from this app's own `src/lib/cell-graph.ts`) | *reactive dependency graph* — mallory's reactive core |

If you're reading across the family and see "graph" in an import or a type
name, check which of the two it means before assuming.

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

Deployed to Dokku at `mallory.johnhenry.me` via Nixpacks. Push to `main`
to trigger a build; see `nixpacks.toml` and `Procfile`.

