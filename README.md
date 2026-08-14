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

## Deployment

Deployed to Dokku at `mallory-graph.johnhenry.me` via Nixpacks. Push to `main`
to trigger a build; see `nixpacks.toml` and `Procfile`.

## ⚠️ Patched dependency: `@tanstack/start-plugin-core`

This project carries a `patch-package` patch
(`patches/@tanstack+start-plugin-core+*.patch`) for a genuine upstream bug in
TanStack Start's build pipeline, applied automatically via the `postinstall`
script.

**Bug:** `vite build` crashes with

```
[tanstack-start-core::server-fn:client] Could not load tanstack-start-import-protection:mock-edge:<base64>: ENOENT: no such file or directory
```

whenever a `createServerFn` handler's dependency chain contains something
import-protection needs to mock out for the client bundle. Root cause: the
server-fn compiler's internal `resolveId` calls `cleanId(r.id)` before handing
the id to `this.load()`, which strips the `\0` prefix that marks the id as
one of import-protection's own virtual modules — so Rollup's `load` hook
filter (which matches on that `\0` prefix) never claims it, and the build
falls through to the filesystem loader and throws ENOENT. This reproduces
across the *entire* version range that ships import-protection (1.165.0
through at least 1.168.27), with zero custom code involved (a bare
`createServerFn` doc example triggers it) — it is not specific to mallory-math
or anything in this app. Pinning to a version *before* import-protection
(e.g. 1.145.4) does not help either — that range hits a different, older,
equally-blocking bug instead ([#4022](https://github.com/TanStack/router/issues/4022)).

The patch fixes the `resolveId` callback to skip `cleanId` specifically for
import-protection's own virtual ids, so the mock module resolves and loads
correctly — this does **not** disable or weaken import-protection, it just
lets the existing safety mechanism actually complete instead of crashing.

**Upstream issue:** [TanStack/router#7725](https://github.com/TanStack/router/issues/7725)

**TODO:** once that issue is fixed upstream, bump `@tanstack/react-start` /
`@tanstack/start-plugin-core` past the fixed version, delete the patch file
under `patches/`, and remove this note.
