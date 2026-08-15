import { Symbolic, type Mesh } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CellGraph } from "../lib/cell-graph.ts";
import { useServerFn } from "@tanstack/react-start";
import { cellIds3D, TIME_CELL } from "../lib/cell-ids.ts";
import { renderSurfacePreviewFrame, startSurfaceExportJob } from "../lib/export-surface-video.ts";
import { ExportPreviewScrubber } from "./ExportPreviewScrubber.tsx";
import { VideoExportControls } from "./VideoExportControls.tsx";
import { collectFreeVars, defaultSliderRange } from "../lib/free-vars.ts";
import { preprocessImplicitMultiplication } from "../lib/implicit-mult.ts";
import { KeyframeSliderControl } from "./KeyframeSliderControl.tsx";
import { meshToGeometry, meshToMaterial } from "../lib/mesh-to-geometry.ts";
import { sampleSurface, type SurfaceDomain } from "../lib/sample-surface.ts";
import { timelineDuration, type Keyframe } from "../lib/timeline.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { TransportControls } from "./TransportControls.tsx";
import { useCell } from "../lib/use-cell.ts";
import { useTimelinePlayback } from "../lib/use-timeline-playback.ts";
import { getThemeColors, subscribeToThemeChange } from "../lib/theme-colors.ts";
import { PngExportButton } from "./PngExportButton.tsx";

const WIDTH = 600;
const HEIGHT = 600;
const RESOLUTION = 40;
const DOMAIN: SurfaceDomain = { min: -5, max: 5 };

/**
 * Sets up one 3D pane's reactive cells on `graph`, mirroring GraphCanvas's
 * `useExpressionGraph` but for z=f(x,y): source expr -> free-var list (both
 * `x` and `y` are axis variables here, unlike the 2D pane's single `x`) ->
 * per-variable slider cells -> params snapshot -> derived sampled-mesh cell.
 * The mesh cell falls back to the last successfully sampled mesh on a
 * parse/eval error, same reasoning as the 2D path cell.
 */
function useExpressionGraph3D(cellId: string, source: string, externalGraph?: CellGraph): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = externalGraph ?? new CellGraph();
    const ids = cellIds3D(cellId);

    if (!graph.has(TIME_CELL)) graph.set(TIME_CELL, 0, { auxiliary: true });

    if (!graph.has(ids.expr)) {
      graph.set(ids.expr, source);

      // Kept pure -- no `graph.set()` here. This cell is read via `get()`
      // from inside React's `getSnapshot` during render (through `params`'s
      // own compute), and a write triggered synchronously from there trips
      // React's "Cannot update a component while rendering a different
      // component" guard, which silently drops the resulting update.
      // Newly-discovered free variables get their slider cell seeded by a
      // `useEffect` in Graph3DCanvas instead.
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
          lastGoodMesh = sampleSurface(graph.get<string>(ids.expr), DOMAIN, DOMAIN, RESOLUTION, params);
        } catch {
          if (!lastGoodMesh) throw new Error(`Initial expression "${source}" failed to parse`);
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

    ref.current = graph;
  }
  return ref.current;
}

export interface Graph3DCanvasProps {
  /** Namespaces this pane's cells on `graph`. */
  cellId?: string;
  /** Initial expression source for this pane, when it isn't already present on `graph`. */
  defaultSource?: string;
  /** Share an existing CellGraph (e.g. a linked 2D+3D view) instead of creating a private one. */
  graph?: CellGraph;
  /** When set, highlights the surface's y=crossSectionY cross-section as a red line (Linked3DView's cross-pane link). */
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

export function Graph3DCanvas({
  cellId = "pane-3d",
  defaultSource = "x^2-y^2",
  graph: externalGraph,
  crossSectionY,
  showTransport = true,
}: Graph3DCanvasProps = {}) {
  const ids = cellIds3D(cellId);
  const graph = useExpressionGraph3D(cellId, defaultSource, externalGraph);
  // Namespaced by cellId (not a flat "surface3d") so two Graph3DCanvas panes
  // sharing one CellGraph -- e.g. a future second notebook-embedded surface
  // block -- don't collide on tool names, same fix as GraphCanvas's.
  useCellGraphTools(`surface3d_${cellId}`, graph);
  const mesh = useCell<Mesh[] | null>(graph, ids.mesh);
  const freeVars = useCell<string[]>(graph, ids.freeVars);
  const exprValue = useCell<string>(graph, ids.expr);
  const time = useCell<number>(graph, TIME_CELL);
  const duration = useCell<number>(graph, ids.timelineDuration);
  const [source, setSource] = useState(defaultSource);
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

  /** The export payload, shared by the full render job and the scrub preview so they can't drift apart. */
  function buildSurfaceExportInput(): { source: string; params: Record<string, number>; tracks: Record<string, Keyframe[] | undefined>; xDomain: SurfaceDomain; yDomain: SurfaceDomain; duration: number } {
    const names = graph.get<string[]>(ids.freeVars);
    const tracks: Record<string, Keyframe[] | undefined> = {};
    for (const name of names) tracks[name] = graph.get<Keyframe[] | undefined>(ids.track(name));
    return {
      source: exprValue,
      params: graph.hasValue(ids.params) ? graph.get<Record<string, number>>(ids.params) : {},
      tracks,
      xDomain: DOMAIN,
      yDomain: DOMAIN,
      duration: exportDuration,
    };
  }

  // Same reasoning as GraphCanvas: keeps the input box in sync with `ids.expr`
  // regardless of what wrote it (chat, URL hydration, a linked sibling pane).
  useEffect(() => {
    setSource(exprValue);
  }, [exprValue]);

  // Seeds a slider cell for each newly-discovered free variable, deferred
  // to an effect for the same reason as GraphCanvas -- see the comment on
  // `ids.freeVars`'s compute above.
  useEffect(() => {
    for (const name of freeVars) {
      const id = ids.param(name);
      if (!graph.hasValue(id)) graph.set(id, defaultSliderRange(name).default);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, freeVars]);

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
    scene.add(new THREE.AxesHelper(DOMAIN.max));

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
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribeTheme();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      surfaceGroupRef.current = null;
      highlightGroupRef.current = null;
      rendererCanvasRef.current = null;
    };
  }, []);

  // Rebuild the surface's geometry/material whenever the sampled mesh
  // changes, disposing the previous frame's GPU resources first.
  useEffect(() => {
    const group = surfaceGroupRef.current;
    if (!group || !mesh) return;
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
      }
    }
    for (const surfaceMesh of mesh) {
      group.add(new THREE.Mesh(meshToGeometry(surfaceMesh), meshToMaterial(surfaceMesh)));
    }
  }, [mesh]);

  // Highlights the y=crossSectionY cross-section as a red line directly on
  // the surface -- Linked3DView's cross-pane link, letting the shape traced
  // here be compared by eye against a sibling 2D pane's curve. Resampled
  // independently from the expression (not read off the mesh's own
  // triangulation) since the mesh's grid resolution rarely lands exactly on
  // an arbitrary y value. `mesh` is used only as this effect's reactivity
  // trigger (it already depends on expr/params changing); the actual sample
  // reads `ids.expr`/`ids.params` fresh each time.
  useEffect(() => {
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
    try {
      const compiled = Symbolic.compile(preprocessImplicitMultiplication(graph.get<string>(ids.expr)));
      const params = graph.get<Record<string, number>>(ids.params);
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
      // A mid-typing parse error -- the surface mesh's own error handling
      // already surfaces the message; the highlight just disappears until it's valid again.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, mesh, crossSectionY]);

  return (
    <div>
      <label>
        z ={" "}
        <input
          value={source}
          onChange={(e) => {
            const value = e.target.value;
            setSource(value);
            graph.set(ids.expr, value);
          }}
          style={{ font: "inherit", width: "20ch" }}
        />
      </label>
      {freeVars.length > 0 && (
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "0.5rem 0" }}>
          {freeVars.map((name) => (
            <KeyframeSliderControl key={name} graph={graph} ids={ids} name={name} />
          ))}
        </div>
      )}
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
      <div ref={containerRef} style={{ maxWidth: WIDTH, border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => rendererCanvasRef.current} label="surface-3d" />
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag to orbit, scroll to zoom.</p>
      {/* Server-side ecmanim export: a full camera orbit around the current
          surface (johnhenry/mallory-graph#3, pass 2) -- the live Three.js
          canvas above stays the interactive view; this renders a shareable
          clip of the same z = f(x, y). */}
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

