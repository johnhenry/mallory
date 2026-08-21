import { Symbolic, type Mesh } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CellGraph } from "../lib/cell-graph.ts";
import { useServerFn } from "@tanstack/react-start";
import { cellIds3D, TIME_CELL, type CellIds3D } from "../lib/cell-ids.ts";
import { renderSurfacePreviewFrame, startSurfaceExportJob } from "../lib/export-surface-video.ts";
import { ExportPreviewScrubber } from "./ExportPreviewScrubber.tsx";
import { VideoExportControls } from "./VideoExportControls.tsx";
import { collectFreeVars, defaultSliderRange } from "../lib/free-vars.ts";
import { preprocessImplicitMultiplication } from "../lib/implicit-mult.ts";
import { KeyframeSliderControl } from "./KeyframeSliderControl.tsx";
import { meshToGeometry, meshToMaterial } from "../lib/mesh-to-geometry.ts";
import { type Graph3DRowState } from "../lib/linked3d-state.ts";
import { appendRow, paletteColor, removeRow } from "../lib/multi-panel-rows.ts";
import { sampleSurface, type SurfaceDomain } from "../lib/sample-surface.ts";
import { timelineDuration, type Keyframe } from "../lib/timeline.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { TransportControls } from "./TransportControls.tsx";
import { useCell } from "../lib/use-cell.ts";
import { useTimelinePlayback } from "../lib/use-timeline-playback.ts";
import { getThemeColors, subscribeToThemeChange } from "../lib/theme-colors.ts";
import { buildAxesLabelGroup, buildSymmetricAxesHelper, setupCss2DOverlay } from "../lib/axes-3d-labels.ts";
import { PngExportButton } from "./PngExportButton.tsx";

const WIDTH = 600;
const HEIGHT = 600;
const RESOLUTION = 40;
const DOMAIN: SurfaceDomain = { min: -5, max: 5 };
const DEFAULT_ROW_SOURCE = "x^2-y^2";

export type { Graph3DRowState };

/**
 * Seeds one surface row's own cells (unlimited overlaid surfaces, #336 item
 * 7): its own z=f(x,y) expression, color and visibility, seeded free-var
 * param values, and derived free-var list/params/sampled-mesh/own-animation
 * duration cells -- the same per-row shape ComplexGraph3DPanel's
 * `seedComplexGraphRow`/OdeSystemPanel's `seedOdeSystemRow` already
 * established, applied to Graph3DCanvas's own z=f(x,y) shape. The mesh cell
 * falls back to the last successfully sampled mesh on a parse/eval error
 * (same reasoning as the pre-port single-surface mesh cell), and bakes this
 * row's own `color` into the sampled mesh's material via `sampleSurface`'s
 * own trailing `color` param (mirrors `sampleParametricSurface`'s identical
 * addition, issue #251), so several overlaid surfaces stay visually
 * distinguishable.
 */
export function seedGraph3DRow(graph: CellGraph, rowId: string, row: Graph3DRowState): void {
  const ids = cellIds3D(rowId);
  graph.set(ids.expr, row.source);
  graph.set(ids.color, row.color);
  graph.set(ids.visible, row.visible);
  for (const [name, value] of Object.entries(row.params)) graph.set(ids.param(name), value);

  // Kept pure -- no `graph.set()` here. This cell is read via `get()` from
  // inside React's `getSnapshot` during render (through `params`'s own
  // compute), and a write triggered synchronously from there trips React's
  // "Cannot update a component while rendering a different component"
  // guard, which silently drops the resulting update. Newly-discovered free
  // variables get their slider cell seeded by a `useEffect` in Graph3DRow
  // instead.
  graph.define(ids.freeVars, () => {
    let names: string[] = [];
    try {
      const expr = Symbolic.parse(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
      names = collectFreeVars(expr, "x").filter((name) => name !== "y");
    } catch {
      // Leave `names` empty on a mid-typing parse error; sliders just don't update.
    }
    return names;
  });

  graph.define(ids.params, () => {
    const names = graph.get<string[]>(ids.freeVars);
    const params: Record<string, number> = {};
    for (const name of names) params[name] = graph.get<number>(ids.param(name));
    return params;
  });

  let lastGoodMesh: Mesh[] | null = null;
  graph.define(ids.mesh, () => {
    try {
      const params = graph.get<Record<string, number>>(ids.params);
      const color = graph.get<number>(ids.color);
      lastGoodMesh = sampleSurface(graph.get<string>(ids.expr), DOMAIN, DOMAIN, RESOLUTION, params, color);
    } catch {
      if (!lastGoodMesh) throw new Error(`Initial expression "${row.source}" failed to parse`);
    }
    return lastGoodMesh;
  });

  graph.define(
    ids.timelineDuration,
    () => {
      const names = graph.get<string[]>(ids.freeVars);
      return timelineDuration(names.map((name) => graph.get<Keyframe[] | undefined>(ids.track(name))));
    },
    { auxiliary: true },
  );
}

function seedGraph3DRowDefault(graph: CellGraph, rowId: string, index: number): void {
  seedGraph3DRow(graph, rowId, { source: DEFAULT_ROW_SOURCE, params: {}, color: paletteColor(index), visible: true });
}

/**
 * Full re-seed of the container: clears any existing rows (deleting their
 * fixed cells plus every discovered free-var's own param/track cells, the
 * same "dynamic cells aren't covered by removeRow itself" cleanup
 * GraphCanvasMulti's own removeRow/NotebookPanel's disposeBlockCells
 * already do for this exact expr-with-free-vars shape) then seeds fresh
 * rows from `rows` -- same "delete then replay" shape OdeSystemPanel's own
 * `seedOdeSystemState` uses, needed because a linked/notebook host's
 * hydrate effect runs AFTER `useGraph3DGraph` has already constructed one
 * default row.
 */
export function seedGraph3DRows(graph: CellGraph, containerIds: CellIds3D, rows: Graph3DRowState[]): void {
  const existing = graph.has(containerIds.list) ? graph.get<string[]>(containerIds.list) : [];
  for (const rowId of existing) {
    const ids = cellIds3D(rowId);
    const names = graph.hasValue(ids.freeVars) ? graph.get<string[]>(ids.freeVars) : [];
    for (const name of names) {
      graph.delete(ids.param(name));
      graph.delete(ids.track(name));
    }
    removeRow(graph, containerIds.list, rowId, ids);
  }
  const rowIds = rows.map(() => crypto.randomUUID());
  graph.set(containerIds.list, rowIds, { auxiliary: true });
  rowIds.forEach((id, i) => seedGraph3DRow(graph, id, rows[i] as Graph3DRowState));
}

/** Builds the full serializable row list of a 3D panel -- shared by Linked3DView's own URL-sync/save handler. */
export function getCurrentGraph3DRows(graph: CellGraph, containerIds: CellIds3D): Graph3DRowState[] {
  return graph.get<string[]>(containerIds.list).map((rowId) => {
    const ids = cellIds3D(rowId);
    const names = graph.hasValue(ids.freeVars) ? graph.get<string[]>(ids.freeVars) : [];
    const params: Record<string, number> = {};
    for (const name of names) params[name] = graph.get<number>(ids.param(name));
    return {
      source: graph.get<string>(ids.expr),
      params,
      color: graph.get<number>(ids.color),
      visible: graph.get<boolean>(ids.visible),
    };
  });
}

/**
 * The first row (unlimited overlaid surfaces, mirroring OdeSystemPanel's own
 * `getPrimaryRow`): the cross-section highlight and video/preview export
 * below are scoped to this row only. N overlaid cross-section highlights
 * would be unreadable line-on-line noise on top of N overlaid surfaces, and
 * a rendered/exported clip has to pick ONE surface's animation to orbit
 * around -- both are properties of one specific surface, not something to
 * merge across rows. Every row still gets its own rendered mesh in its own
 * color. Exported for NotebookPanel.tsx's own "surface3d" block, which
 * keeps its persisted shape flat (one expr/params, not a row list, see that
 * block's own doc comment) by reading/writing only this primary row.
 */
export function getPrimaryRow3D(graph: CellGraph, containerIds: CellIds3D): { rowId: string; ids: CellIds3D } | null {
  const rowId = graph.get<string[]>(containerIds.list)[0];
  return rowId === undefined ? null : { rowId, ids: cellIds3D(rowId) };
}

/**
 * Sets up one 3D pane's reactive container cells, mirroring GraphCanvas's
 * `useExpressionGraph` but for an unlimited-rows z=f(x,y) pane: an ordered
 * row-id list (each row its own full expr -> free-var list -> per-variable
 * slider -> params -> derived sampled-mesh pipeline, see `seedGraph3DRow`)
 * plus a container-level `combinedTimelineDuration` -- Math.max across every
 * row's own `timelineDuration`, guarded the same `Number.isFinite` way
 * Linked3DView's own `COMBINED_DURATION_CELL` already guards its two-pane
 * max (mallory-graph#10's hydration-warning fix), just generalized from 2
 * fixed panes to N rows -- for the one shared transport widget below to
 * scrub the full length of whichever row's animation is longest.
 */
function useGraph3DGraph(cellId: string, defaultSource: string, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    const containerIds = cellIds3D(cellId);

    if (!graph.has(TIME_CELL)) graph.set(TIME_CELL, 0, { auxiliary: true });

    if (!graph.has(containerIds.list)) {
      seedGraph3DRows(graph, containerIds, [{ source: defaultSource, params: {}, color: paletteColor(0), visible: true }]);

      graph.define(
        containerIds.combinedTimelineDuration,
        () => {
          const durations = graph.get<string[]>(containerIds.list).map((rowId) => graph.get<number>(cellIds3D(rowId).timelineDuration));
          return durations.reduce((max, d) => Math.max(max, Number.isFinite(d) ? d : 0), 0);
        },
        { auxiliary: true },
      );
    }

    ref.current = graph;
  }
  return ref.current;
}

export interface Graph3DCanvasProps {
  /** Namespaces this pane's cells on `graph`. */
  cellId?: string;
  /** Initial expression source for this pane's first row, when it isn't already present on `graph`. */
  defaultSource?: string;
  /** Share an existing CellGraph (e.g. a linked 2D+3D view) instead of creating a private one. */
  graph?: CellGraph;
  /** When set, highlights the PRIMARY (first) row's y=crossSectionY cross-section as a red line (Linked3DView's cross-pane link). See `getPrimaryRow3D`'s own doc comment for the primary-row scoping. */
  crossSectionY?: number;
  /**
   * Hide the play/pause/loop/speed transport -- for a secondary pane in a
   * linked view where a sibling's transport already drives the shared
   * TIME_CELL (see GraphCanvas's identically-named prop). Defaults to true
   * (standalone use, e.g. this component with no linked 2D sibling, has no
   * other way to play back an animated free variable -- mallory-graph#8).
   */
  showTransport?: boolean;
}

/** One surface row's controls: z=f(x,y) expression, its own free-var keyframe sliders, color/visibility. */
function Graph3DRow({ graph, rowId, onRemove }: { graph: CellGraph; rowId: string; onRemove?: () => void }) {
  const ids = cellIds3D(rowId);
  const source = useCell<string>(graph, ids.expr);
  const freeVars = useCell<string[]>(graph, ids.freeVars);
  const color = useCell<number>(graph, ids.color);
  const visible = useCell<boolean>(graph, ids.visible);

  // Seeds a slider cell for each newly-discovered free variable, deferred
  // to an effect for the same reason as GraphCanvas -- see `ids.freeVars`'s
  // compute above. Also deletes param/track cells for names that left the
  // set (issue #309, same mid-typing leak GraphCanvas had).
  const prevFreeVarsRef = useRef<string[]>([]);
  useEffect(() => {
    for (const name of freeVars) {
      const id = ids.param(name);
      if (!graph.hasValue(id)) graph.set(id, defaultSliderRange(name).default);
    }
    for (const name of prevFreeVarsRef.current) {
      if (!freeVars.includes(name)) {
        graph.delete(ids.param(name));
        graph.delete(ids.track(name));
      }
    }
    prevFreeVarsRef.current = freeVars;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, freeVars]);

  return (
    <div style={{ margin: "0.35rem 0", padding: "0.35rem", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <input type="checkbox" checked={visible} onChange={(e) => graph.set(ids.visible, e.target.checked)} title="Show/hide this surface" />
        <input
          type="color"
          value={`#${color.toString(16).padStart(6, "0")}`}
          onChange={(e) => graph.set(ids.color, Number.parseInt(e.target.value.slice(1), 16))}
        />
        <label>
          z = <input value={source} onChange={(e) => graph.set(ids.expr, e.target.value)} style={{ font: "inherit", width: "20ch" }} />
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} title="Remove this surface">
            ✕
          </button>
        )}
      </div>
      {freeVars.length > 0 && (
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "0.5rem 0" }}>
          {freeVars.map((name) => (
            <KeyframeSliderControl key={name} graph={graph} ids={ids} name={name} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Unlimited overlaid z=f(x,y) surfaces (#336 item 7, porting v1's single
 * surface), sharing one Three.js scene/camera/lighting/axes/OrbitControls
 * and one shared x/y sampling `DOMAIN` -- every surface now gets its own
 * color/visibility and its own free-var keyframe sliders, the same
 * "shared view, unlimited rows" shape ComplexGraph3DPanel/
 * ParametricSurfacePanel already established for their own 3D panels. The
 * cross-section highlight and video/preview export stay scoped to the first
 * row only -- see `getPrimaryRow3D`'s own doc comment for why.
 *
 * Embedded two different ways, both of which must keep working: standalone
 * inside Linked3DView (paired with a 2D `GraphCanvas`, `showTransport`
 * false, its own transport driving the shared `TIME_CELL`), and inside a
 * notebook's "surface3d" block (`NotebookGraph3DBlock.tsx`), whose own
 * persisted state stays a flat single expr/params (not a row list) by
 * design -- see that block's own doc comment for the primary-row-only
 * scoping this keeps to.
 */
export function Graph3DCanvas({
  cellId = "pane-3d",
  defaultSource = DEFAULT_ROW_SOURCE,
  graph: externalGraph,
  crossSectionY,
  showTransport = true,
}: Graph3DCanvasProps = {}) {
  const containerIds = cellIds3D(cellId);
  const graph = useGraph3DGraph(cellId, defaultSource, externalGraph);
  // Namespaced by cellId (not a flat "surface3d") so two Graph3DCanvas panes
  // sharing one CellGraph -- e.g. a future second notebook-embedded surface
  // block -- don't collide on tool names, same fix as GraphCanvas's.
  useCellGraphTools(`surface3d_${cellId}`, graph);
  const rowIds = useCell<string[]>(graph, containerIds.list);
  const time = useCell<number>(graph, TIME_CELL);
  const duration = useCell<number>(graph, containerIds.combinedTimelineDuration);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  useTimelinePlayback(graph, playing, loop, speed, duration, setPlaying);
  const startSurfaceExportJobFn = useServerFn(startSurfaceExportJob);
  const renderSurfacePreviewFrameFn = useServerFn(renderSurfacePreviewFrame);
  // Lifted out of VideoExportControls (as a controlled prop) so the preview
  // scrubber below can size its range to the same clip length the Export
  // button will actually render -- see VideoExportControls's own doc
  // comment on this prop (mallory-graph#9).
  const [exportDuration, setExportDuration] = useState(4);
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceGroupRef = useRef<THREE.Group | null>(null);
  const highlightGroupRef = useRef<THREE.Group | null>(null);
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Populated by the mount-once effect below -- lets `renderThreeAtScale`
  // (issue #278) build a temporary offscreen renderer around this panel's
  // existing scene/camera without touching the live on-screen renderer.
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  function addSurface() {
    const { id, index } = appendRow(graph, containerIds.list);
    seedGraph3DRowDefault(graph, id, index);
  }

  function removeSurface(rowId: string) {
    const ids = cellIds3D(rowId);
    const names = graph.hasValue(ids.freeVars) ? graph.get<string[]>(ids.freeVars) : [];
    for (const name of names) {
      graph.delete(ids.param(name));
      graph.delete(ids.track(name));
    }
    removeRow(graph, containerIds.list, rowId, ids);
  }

  /** The export payload, shared by the full render job and the scrub preview so they can't drift apart. Scoped to the PRIMARY row only -- see `getPrimaryRow3D`'s own doc comment. */
  function buildSurfaceExportInput(): { source: string; params: Record<string, number>; tracks: Record<string, Keyframe[] | undefined>; xDomain: SurfaceDomain; yDomain: SurfaceDomain; duration: number } {
    const primary = getPrimaryRow3D(graph, containerIds);
    if (!primary) return { source: "", params: {}, tracks: {}, xDomain: DOMAIN, yDomain: DOMAIN, duration: exportDuration };
    const ids = primary.ids;
    const names = graph.get<string[]>(ids.freeVars);
    const tracks: Record<string, Keyframe[] | undefined> = {};
    for (const name of names) tracks[name] = graph.get<Keyframe[] | undefined>(ids.track(name));
    return {
      source: graph.get<string>(ids.expr),
      params: graph.hasValue(ids.params) ? graph.get<Record<string, number>>(ids.params) : {},
      tracks,
      xDomain: DOMAIN,
      yDomain: DOMAIN,
      duration: exportDuration,
    };
  }

  // Mount-once: renderer, camera, lights, orbit controls, and the render
  // loop. OrbitControls' damping needs a continuous rAF loop even when the
  // mesh itself isn't changing, so this is a separate effect from the
  // mesh-rebuild one below rather than tearing the whole scene down on every
  // keystroke.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getThemeColors().surface);
    // THREE.Color's constructor accepts a "#rrggbb" string directly (its
    // internal `setStyle`), so no int-conversion step is needed here --
    // but `scene.background` is plain runtime state set once, not CSS, so
    // (unlike a DOM element styled with var(--surface)) it needs an
    // explicit re-set on every theme flip, light OR dark-mode toggle AND
    // OS-level "auto" changes alike -- see subscribeToThemeChange's doc.
    const unsubscribeTheme = subscribeToThemeChange(() => {
      scene.background = new THREE.Color(getThemeColors().surface);
    });

    const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 1000);
    camera.position.set(8, 8, 8);
    sceneRef.current = scene;
    cameraRef.current = camera;

    // `preserveDrawingBuffer: true` -- without it, WebGL is free to clear the
    // drawing buffer immediately after compositing each frame, so a
    // `canvas.toBlob()` PNG export (issue #45) called from a later task/
    // click handler can race the next rAF's clear and read back blank. The
    // GPU-memory-retention cost is a second copy of the framebuffer kept
    // around between frames -- negligible at this canvas's fixed WIDTHxHEIGHT.
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    // `updateStyle=false` -- leaves the canvas's own CSS untouched so the
    // global `canvas { max-width: 100%; height: auto }` mobile rule can
    // scale it down; the drawing buffer stays a fixed WIDTH x HEIGHT
    // regardless, matching PerspectiveCamera's aspect ratio.
    renderer.setSize(WIDTH, HEIGHT, false);
    container.appendChild(renderer.domElement);
    rendererCanvasRef.current = renderer.domElement;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 7);
    scene.add(directional);
    scene.add(buildSymmetricAxesHelper(DOMAIN.max));
    scene.add(buildAxesLabelGroup(DOMAIN.max));
    const labelOverlay = setupCss2DOverlay(container, WIDTH, HEIGHT);

    const group = new THREE.Group();
    surfaceGroupRef.current = group;
    scene.add(group);

    const highlightGroup = new THREE.Group();
    highlightGroupRef.current = highlightGroup;
    scene.add(highlightGroup);

    let raf = 0;
    function tick() {
      controls.update();
      renderer.render(scene, camera);
      labelOverlay.renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribeTheme();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      labelOverlay.dispose();
      surfaceGroupRef.current = null;
      highlightGroupRef.current = null;
      rendererCanvasRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  // Rebuilds every visible row's mesh into the shared group whenever the
  // row list changes, or any individual row's own mesh/color/visibility
  // does -- graph.subscribeAll rather than a single `useCell` on one row's
  // mesh, the same reasoning OdeSystemPanel/ComplexGraph3DPanel's own
  // rebuild effects document (an arbitrary, changing set of rows can't be
  // covered by a fixed set of per-row hooks). Disposes the previous frame's
  // GPU resources first, same as the pre-port single-surface version.
  useEffect(() => {
    function rebuild() {
      const group = surfaceGroupRef.current;
      if (!group) return;
      for (const child of [...group.children]) {
        group.remove(child);
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
        }
      }
      for (const rowId of graph.get<string[]>(containerIds.list)) {
        const ids = cellIds3D(rowId);
        try {
          if (!graph.get<boolean>(ids.visible)) continue;
          const mesh = graph.get<Mesh[] | null>(ids.mesh);
          if (!mesh) continue;
          for (const surfaceMesh of mesh) {
            group.add(new THREE.Mesh(meshToGeometry(surfaceMesh), meshToMaterial(surfaceMesh)));
          }
        } catch {
          // A row whose cells haven't registered yet, or whose mesh
          // compute never succeeded (initial expression failed to parse)
          // -- skip it this pass.
        }
      }
    }
    rebuild();
    return graph.subscribeAll(rebuild);
  }, [graph, containerIds]);

  // Highlights the PRIMARY row's y=crossSectionY cross-section as a red
  // line directly on its surface -- Linked3DView's cross-pane link, letting
  // the shape traced here be compared by eye against a sibling 2D pane's
  // curve. See `getPrimaryRow3D`'s own doc comment for why this doesn't
  // extend to every row. Resampled independently from the expression (not
  // read off the mesh's own triangulation) since the mesh's grid resolution
  // rarely lands exactly on an arbitrary y value.
  useEffect(() => {
    function updateHighlight() {
      const group = highlightGroupRef.current;
      if (!group) return;
      for (const child of [...group.children]) {
        group.remove(child);
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
        }
      }
      if (crossSectionY === undefined) return;
      const primary = getPrimaryRow3D(graph, containerIds);
      if (!primary) return;
      try {
        const compiled = Symbolic.compile(preprocessImplicitMultiplication(graph.get<string>(primary.ids.expr)));
        const params = graph.get<Record<string, number>>(primary.ids.params);
        const SAMPLES = 80;
        const points: THREE.Vector3[] = [];
        for (let i = 0; i < SAMPLES; i++) {
          const x = DOMAIN.min + (i / (SAMPLES - 1)) * (DOMAIN.max - DOMAIN.min);
          const z = compiled({ ...params, x, y: crossSectionY });
          // Same axis mapping as meshToGeometry: mallory's z (height) -> Three's y, mallory's y -> Three's z.
          if (Number.isFinite(z)) points.push(new THREE.Vector3(x, z, crossSectionY));
        }
        if (points.length > 1) {
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xdc2626, linewidth: 2 })));
        }
      } catch {
        // A mid-typing parse error on the primary row's expression -- its
        // own mesh error handling already surfaces the message; the
        // highlight just disappears until it's valid again.
      }
    }
    updateHighlight();
    return graph.subscribeAll(updateHighlight);
  }, [graph, containerIds, crossSectionY]);

  return (
    <div>
      {rowIds.map((rowId) => (
        <Graph3DRow key={rowId} graph={graph} rowId={rowId} onRemove={rowIds.length > 1 ? () => removeSurface(rowId) : undefined} />
      ))}
      <button type="button" onClick={addSurface} style={{ margin: "0.35rem 0" }}>
        + Add surface
      </button>
      {showTransport && (
        <TransportControls
          graph={graph}
          time={time}
          duration={duration}
          playing={playing}
          setPlaying={setPlaying}
          loop={loop}
          setLoop={setLoop}
          speed={speed}
          setSpeed={setSpeed}
        />
      )}
      <div ref={containerRef} style={{ position: "relative", maxWidth: WIDTH, border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => rendererCanvasRef.current}
          label="surface-3d"
          renderThreeAtScale={(canvas, width, height) => {
            if (!sceneRef.current || !cameraRef.current) return;
            const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
            renderer.setSize(width, height, false);
            renderer.render(sceneRef.current, cameraRef.current);
            renderer.dispose();
          }}
          baseWidth={WIDTH}
          baseHeight={HEIGHT}
        />
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag to orbit, scroll to zoom.</p>
      {rowIds.length > 1 && (
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0" }}>
          The cross-section highlight (if any) and the video/preview export below reflect only the first surface's expression.
        </p>
      )}
      {/* Server-side ecmanim export: a full camera orbit around the current
          surface (johnhenry/mallory-graph#3, pass 2) -- the live Three.js
          canvas above stays the interactive view; this renders a shareable
          clip of the primary row's z = f(x, y). */}
      <VideoExportControls
        filenameStem="mallory-graph-surface"
        duration={exportDuration}
        onDurationChange={setExportDuration}
        start={(format) =>
          startSurfaceExportJobFn({
            data: { ...buildSurfaceExportInput(), format },
          })
        }
      />
      {/* Scrub preview (mallory-graph#9): shares buildSurfaceExportInput with
          the Export button above, so it can never drift from the real
          render -- mirrors GraphCanvas's 2D preview slider. */}
      <ExportPreviewScrubber
        maxTime={exportDuration}
        fetchFrame={async (time) => {
          const frame = await renderSurfacePreviewFrameFn({ data: { ...buildSurfaceExportInput(), format: "mp4", time } });
          return frame;
        }}
      />
    </div>
  );
}
