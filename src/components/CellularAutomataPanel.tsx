import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Rng } from "mallory-tensor-core";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";
import {
  DEFAULT_CA_STATE,
  decodeCaState,
  encodeCaState,
  type Boundary1D,
  type Boundary2D,
  type Boundary3D,
  type CaDimension,
  type CaState,
  type InitialCondition1D,
  type InitialCondition2D,
} from "../lib/ca-state.ts";
import { blankBits, decodeBits, pixelToCellIndex, setBit, type Cell as CaCell } from "../lib/ca/custom-grid.ts";
import { NAMED_ELEMENTARY_RULES, ruleTable, spacetimeElementary, toggleRuleBit, type Spacetime as Spacetime1D } from "../lib/ca/elementary.ts";
import {
  bsRuleToString,
  initialGrid,
  NAMED_LIFE_LIKE_RULES,
  parseBSRule,
  spacetimeLifeLike,
  toggleBirth,
  toggleSurvival,
  type LifeLikeRule,
  type Spacetime2D,
} from "../lib/ca/life-like.ts";
import {
  NAMED_TOTALISTIC_3D_RULES,
  parseTotalisticRule3D,
  randomGrid3D,
  spacetimeTotalistic3D,
  toggleBirth3D,
  toggleSurvival3D,
  totalisticRule3DToString,
  type Totalistic3DRule,
  type Spacetime3D,
} from "../lib/ca/totalistic-3d.ts";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsCellularAutomata, TIME_CELL, type CellIdsCellularAutomata } from "../lib/cell-ids.ts";
import { getThemeColors, subscribeToThemeChange } from "../lib/theme-colors.ts";
import { useCell } from "../lib/use-cell.ts";
import { useTimelinePlayback } from "../lib/use-timeline-playback.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { TransportControls } from "./TransportControls.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

// 1D: a full space-time image is width x generations cells; caps keep the
// canvas (and the eager spacetimeElementary computation itself, though
// that's cheap regardless -- see elementary.ts's own doc comment) bounded.
const MAX_1D_WIDTH = 300;
const MAX_1D_GENERATIONS = 300;
const CELL_SIZE_1D = 3;

// 2D: the animated canvas only ever draws ONE generation at a time, so its
// own cap is about keeping spacetimeLifeLike's eager up-front computation
// (every generation, not just the currently-displayed one) fast -- capped
// on the PRODUCT of the three axes, not each axis alone, since a
// wide-but-short run and a narrow-but-long run cost about the same.
const MAX_2D_WIDTH = 80;
const MAX_2D_HEIGHT = 80;
const MAX_2D_GENERATIONS = 200;
const MAX_2D_SPACETIME_CELLS = 300_000;
const CELL_SIZE_2D = 12;
const STEP_SECONDS = 0.2;

// The voxel view (issue #229's own "2D rule's history is naturally a 3D
// volume" framing) renders EVERY generation as a layer of boxes
// simultaneously -- unlike the animated 2D canvas, which only ever draws
// one generation, this can't reuse MAX_2D_SPACETIME_CELLS's own budget
// (300,000 individual THREE.Mesh boxes would stall the GPU); it needs a
// much smaller cap, the same "renders literally every counted cell as a
// mesh" reasoning issue #92's MAX_CUBE_CELLS/MAX_RELAX_CELLS caps used.
const MAX_VOXEL_CELLS = 6000;

// 3D: totalistic-3d.ts's own doc comment frames a 3D rule's history as a 4D
// hypervolume that can't be rendered all at once (unlike 2D's voxel-STACK
// view above) -- the panel instead scrubs through one Grid3D frame at a
// time, so the per-axis and per-frame caps below double as both the
// eager-computation budget (stepTotalistic3D is O(cells x 26 neighbors),
// pricier per cell than 2D's 8-neighbor life-like step) AND the single-frame
// voxel-mesh render budget (one THREE.Mesh per alive cell, same
// "individual mesh, not instanced" approach as CubeGridView/
// VoxelSpacetimeView above) -- kept an order of magnitude below
// MAX_VOXEL_CELLS since a 3D grid's cell count grows cubically with width.
const MAX_3D_WIDTH = 20;
const MAX_3D_HEIGHT = 20;
const MAX_3D_DEPTH = 20;
const MAX_3D_GENERATIONS = 60;
const MAX_3D_GRID_CELLS = 4000;

function seedState(graph: CellGraph, ids: CellIdsCellularAutomata, state: CaState): void {
  graph.set(ids.dimension, state.dimension);
  graph.set(ids.ruleNumber, state.ruleNumber);
  graph.set(ids.width1d, state.width1d);
  graph.set(ids.generations1d, state.generations1d);
  graph.set(ids.boundary1d, state.boundary1d);
  graph.set(ids.initial1d, state.initial1d);
  graph.set(ids.seed1d, state.seed1d);
  graph.set(ids.customGrid1d, state.customGrid1d);
  graph.set(ids.bsRule, state.bsRule);
  graph.set(ids.width2d, state.width2d);
  graph.set(ids.height2d, state.height2d);
  graph.set(ids.generations2d, state.generations2d);
  graph.set(ids.boundary2d, state.boundary2d);
  graph.set(ids.initial2d, state.initial2d);
  graph.set(ids.seed2d, state.seed2d);
  graph.set(ids.density2d, state.density2d);
  graph.set(ids.customGrid2d, state.customGrid2d);
  graph.set(ids.showVoxelView, state.showVoxelView);
  graph.set(ids.rule3d, state.rule3d);
  graph.set(ids.width3d, state.width3d);
  graph.set(ids.height3d, state.height3d);
  graph.set(ids.depth3d, state.depth3d);
  graph.set(ids.generations3d, state.generations3d);
  graph.set(ids.boundary3d, state.boundary3d);
  graph.set(ids.seed3d, state.seed3d);
  graph.set(ids.density3d, state.density3d);
}

function getCurrentState(graph: CellGraph, ids: CellIdsCellularAutomata): CaState {
  return {
    v: 1,
    dimension: graph.get<CaDimension>(ids.dimension),
    ruleNumber: graph.get<number>(ids.ruleNumber),
    width1d: graph.get<number>(ids.width1d),
    generations1d: graph.get<number>(ids.generations1d),
    boundary1d: graph.get<Boundary1D>(ids.boundary1d),
    initial1d: graph.get<InitialCondition1D>(ids.initial1d),
    seed1d: graph.get<number>(ids.seed1d),
    customGrid1d: graph.get<string>(ids.customGrid1d),
    bsRule: graph.get<string>(ids.bsRule),
    width2d: graph.get<number>(ids.width2d),
    height2d: graph.get<number>(ids.height2d),
    generations2d: graph.get<number>(ids.generations2d),
    boundary2d: graph.get<Boundary2D>(ids.boundary2d),
    initial2d: graph.get<InitialCondition2D>(ids.initial2d),
    seed2d: graph.get<number>(ids.seed2d),
    density2d: graph.get<number>(ids.density2d),
    customGrid2d: graph.get<string>(ids.customGrid2d),
    showVoxelView: graph.get<boolean>(ids.showVoxelView),
    rule3d: graph.get<string>(ids.rule3d),
    width3d: graph.get<number>(ids.width3d),
    height3d: graph.get<number>(ids.height3d),
    depth3d: graph.get<number>(ids.depth3d),
    generations3d: graph.get<number>(ids.generations3d),
    boundary3d: graph.get<Boundary3D>(ids.boundary3d),
    seed3d: graph.get<number>(ids.seed3d),
    density3d: graph.get<number>(ids.density3d),
  };
}

function useCaGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsCellularAutomata(cellId);
    const decoded = typeof window !== "undefined" ? decodeCaState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_CA_STATE);
    if (!graph.has(TIME_CELL)) graph.set(TIME_CELL, 0, { auxiliary: true });

    // Both spacetime results are `define`d (pure, synchronous, cached until
    // an input changes) rather than the Wang tile lab's async-generator +
    // free-cell pattern -- CA evolution has no combinatorial search, just a
    // fixed amount of work per cell per generation, so there's nothing to
    // stream or pause (see cellIdsCellularAutomata's own doc comment).
    graph.define(ids.spacetime1dResult, (): Result<Spacetime1D> => {
      try {
        const width = graph.get<number>(ids.width1d);
        const generations = graph.get<number>(ids.generations1d);
        if (width < 1 || width > MAX_1D_WIDTH) throw new Error(`Width must be between 1 and ${MAX_1D_WIDTH}.`);
        if (generations < 1 || generations > MAX_1D_GENERATIONS) throw new Error(`Generations must be between 1 and ${MAX_1D_GENERATIONS}.`);
        const initial = graph.get<InitialCondition1D>(ids.initial1d);
        const rng = initial === "random" ? new Rng(graph.get<number>(ids.seed1d)) : undefined;
        const customBits = initial === "custom" ? graph.get<string>(ids.customGrid1d) : undefined;
        const value = spacetimeElementary(
          graph.get<number>(ids.ruleNumber),
          width,
          generations,
          initial,
          graph.get<Boundary1D>(ids.boundary1d),
          rng,
          customBits,
        );
        return { ok: true, value };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.spacetime2dResult, (): Result<Spacetime2D> => {
      try {
        const width = graph.get<number>(ids.width2d);
        const height = graph.get<number>(ids.height2d);
        const generations = graph.get<number>(ids.generations2d);
        if (width < 1 || width > MAX_2D_WIDTH) throw new Error(`Width must be between 1 and ${MAX_2D_WIDTH}.`);
        if (height < 1 || height > MAX_2D_HEIGHT) throw new Error(`Height must be between 1 and ${MAX_2D_HEIGHT}.`);
        if (generations < 1 || generations > MAX_2D_GENERATIONS) throw new Error(`Generations must be between 1 and ${MAX_2D_GENERATIONS}.`);
        if (width * height * generations > MAX_2D_SPACETIME_CELLS) {
          throw new Error(`width x height x generations (${width * height * generations}) exceeds the ${MAX_2D_SPACETIME_CELLS} cap -- shrink one of them.`);
        }
        const rule = parseBSRule(graph.get<string>(ids.bsRule));
        const initialKind = graph.get<InitialCondition2D>(ids.initial2d);
        const rng = initialKind === "random" ? new Rng(graph.get<number>(ids.seed2d)) : undefined;
        const customBits = initialKind === "custom" ? graph.get<string>(ids.customGrid2d) : undefined;
        const initial = initialGrid(width, height, initialKind, rng, graph.get<number>(ids.density2d), customBits);
        const value = spacetimeLifeLike(initial, rule, generations, graph.get<Boundary2D>(ids.boundary2d));
        return { ok: true, value };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.spacetime3dResult, (): Result<Spacetime3D> => {
      try {
        const width = graph.get<number>(ids.width3d);
        const height = graph.get<number>(ids.height3d);
        const depth = graph.get<number>(ids.depth3d);
        const generations = graph.get<number>(ids.generations3d);
        if (width < 1 || width > MAX_3D_WIDTH) throw new Error(`Width must be between 1 and ${MAX_3D_WIDTH}.`);
        if (height < 1 || height > MAX_3D_HEIGHT) throw new Error(`Height must be between 1 and ${MAX_3D_HEIGHT}.`);
        if (depth < 1 || depth > MAX_3D_DEPTH) throw new Error(`Depth must be between 1 and ${MAX_3D_DEPTH}.`);
        if (generations < 1 || generations > MAX_3D_GENERATIONS) throw new Error(`Generations must be between 1 and ${MAX_3D_GENERATIONS}.`);
        if (width * height * depth > MAX_3D_GRID_CELLS) {
          throw new Error(`width x height x depth (${width * height * depth}) exceeds the ${MAX_3D_GRID_CELLS} cap -- shrink one of them.`);
        }
        const rule = parseTotalisticRule3D(graph.get<string>(ids.rule3d));
        const initial = randomGrid3D(width, height, depth, new Rng(graph.get<number>(ids.seed3d)), graph.get<number>(ids.density3d));
        const value = spacetimeTotalistic3D(initial, rule, generations, graph.get<Boundary3D>(ids.boundary3d));
        return { ok: true, value };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

const VOXEL_VIEW_SIZE = 400;
const VOXEL_CELL_GEOMETRY = new THREE.BoxGeometry(0.9, 0.9, 0.9);

/** hue sweeps across the generation range so the voxel stack reads as a time gradient (earliest generations one hue, latest another), not one flat color. */
function generationColor(generation: number, totalGenerations: number): THREE.Color {
  const hue = totalGenerations <= 1 ? 0 : (generation / (totalGenerations - 1)) * 260;
  return new THREE.Color(`hsl(${hue}, 65%, 55%)`);
}

/**
 * Renders a 2D CA's full space-time history as a stack of voxel layers (one
 * Z-layer per generation, alive cells only) in an orbit-controllable Three.js
 * scene -- same Scene/Camera/Renderer/OrbitControls/lighting/Group setup as
 * the Wang tile lab's own `CubeGridView` (issue #92 M4), swapping "one box
 * per placed tile" for "one box per alive cell, colored by generation".
 */
function VoxelSpacetimeView({ spacetime }: { spacetime: Spacetime2D | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Populated by the mount-once effect below -- lets `renderThreeAtScale`
  // (issue #278) build a temporary offscreen renderer around this view's
  // existing scene/camera without touching the live on-screen renderer.
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getThemeColors().surface);
    const unsubscribeTheme = subscribeToThemeChange(() => {
      scene.background = new THREE.Color(getThemeColors().surface);
    });

    const camera = new THREE.PerspectiveCamera(50, VOXEL_VIEW_SIZE / VOXEL_VIEW_SIZE, 0.1, 1000);
    camera.position.set(8, 8, 8);
    sceneRef.current = scene;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(VOXEL_VIEW_SIZE, VOXEL_VIEW_SIZE, false);
    container.appendChild(renderer.domElement);
    rendererCanvasRef.current = renderer.domElement;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 7);
    scene.add(directional);
    scene.add(new THREE.AxesHelper(3));

    const group = new THREE.Group();
    groupRef.current = group;
    scene.add(group);

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
      groupRef.current = null;
      rendererCanvasRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh) (child.material as THREE.Material).dispose();
    }
    if (!spacetime) return;
    const generations = spacetime.length;
    const height = spacetime[0]?.length ?? 0;
    const width = spacetime[0]?.[0]?.length ?? 0;
    for (let g = 0; g < generations; g++) {
      const color = generationColor(g, generations);
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          if (spacetime[g]![row]![col] !== 1) continue;
          const material = new THREE.MeshStandardMaterial({ color });
          const mesh = new THREE.Mesh(VOXEL_CELL_GEOMETRY, material);
          mesh.position.set((col - (width - 1) / 2) * 1.1, (g - (generations - 1) / 2) * 1.1, (row - (height - 1) / 2) * 1.1);
          group.add(mesh);
        }
      }
    }
  }, [spacetime]);

  return (
    <div>
      <div ref={containerRef} style={{ position: "relative", maxWidth: VOXEL_VIEW_SIZE, border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => rendererCanvasRef.current}
          label="ca-voxel-spacetime"
          renderThreeAtScale={(canvas, width, height) => {
            if (!sceneRef.current || !cameraRef.current) return;
            const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
            renderer.setSize(width, height, false);
            renderer.render(sceneRef.current, cameraRef.current);
            renderer.dispose();
          }}
          baseWidth={VOXEL_VIEW_SIZE}
          baseHeight={VOXEL_VIEW_SIZE}
        />
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag to orbit, scroll to zoom. Y axis is time (generation); color sweeps from early (red) to late (violet) generations.</p>
    </div>
  );
}

const VOXEL_3D_VIEW_SIZE = 400;
const VOXEL_3D_CELL_GEOMETRY = new THREE.BoxGeometry(0.9, 0.9, 0.9);

/** hue sweeps across the Z axis so the single-frame voxel scene reads with depth (near layers one hue, far layers another) even before orbiting. */
export function layerColor3D(z: number, depth: number): THREE.Color {
  const hue = depth <= 1 ? 0 : (z / (depth - 1)) * 260;
  return new THREE.Color(`hsl(${hue}, 65%, 55%)`);
}

/**
 * Renders ONE frame of a 3D totalistic CA's spacetime as a voxel scene (one
 * `THREE.Mesh` per alive cell, colored by Z layer) -- same Scene/Camera/
 * Renderer/OrbitControls/lighting/Group setup as `VoxelSpacetimeView` and
 * the Wang tile lab's `CubeGridView` above. Unlike `VoxelSpacetimeView`
 * (which renders a 2D rule's ENTIRE history as one static stack),
 * `totalistic-3d.ts`'s own doc comment frames a 3D rule's history as a 4D
 * hypervolume that can't be rendered all at once -- so this component takes
 * a single `Grid3D` frame, and the panel scrubs `frame` across generations
 * via the shared timeline controls instead.
 */
function Voxel3DFrameView({ frame }: { frame: Spacetime3D[number] | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Populated by the mount-once effect below -- lets `renderThreeAtScale`
  // (issue #278) build a temporary offscreen renderer around this view's
  // existing scene/camera without touching the live on-screen renderer.
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getThemeColors().surface);
    const unsubscribeTheme = subscribeToThemeChange(() => {
      scene.background = new THREE.Color(getThemeColors().surface);
    });

    const camera = new THREE.PerspectiveCamera(50, VOXEL_3D_VIEW_SIZE / VOXEL_3D_VIEW_SIZE, 0.1, 1000);
    camera.position.set(8, 8, 8);
    sceneRef.current = scene;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(VOXEL_3D_VIEW_SIZE, VOXEL_3D_VIEW_SIZE, false);
    container.appendChild(renderer.domElement);
    rendererCanvasRef.current = renderer.domElement;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 7);
    scene.add(directional);
    scene.add(new THREE.AxesHelper(3));

    const group = new THREE.Group();
    groupRef.current = group;
    scene.add(group);

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
      groupRef.current = null;
      rendererCanvasRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh) (child.material as THREE.Material).dispose();
    }
    if (!frame) return;
    const depth = frame.length;
    const height = frame[0]?.length ?? 0;
    const width = frame[0]?.[0]?.length ?? 0;
    for (let z = 0; z < depth; z++) {
      const color = layerColor3D(z, depth);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (frame[z]![y]![x] !== 1) continue;
          const material = new THREE.MeshStandardMaterial({ color });
          const mesh = new THREE.Mesh(VOXEL_3D_CELL_GEOMETRY, material);
          mesh.position.set((x - (width - 1) / 2) * 1.1, (y - (height - 1) / 2) * 1.1, (z - (depth - 1) / 2) * 1.1);
          group.add(mesh);
        }
      }
    }
  }, [frame]);

  return (
    <div>
      <div ref={containerRef} style={{ position: "relative", maxWidth: VOXEL_3D_VIEW_SIZE, border: "1px solid var(--border)" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => rendererCanvasRef.current}
          label="ca-totalistic-3d"
          renderThreeAtScale={(canvas, width, height) => {
            if (!sceneRef.current || !cameraRef.current) return;
            const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
            renderer.setSize(width, height, false);
            renderer.render(sceneRef.current, cameraRef.current);
            renderer.dispose();
          }}
          baseWidth={VOXEL_3D_VIEW_SIZE}
          baseHeight={VOXEL_3D_VIEW_SIZE}
        />
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag to orbit, scroll to zoom. Color sweeps across the Z axis (near to far); use the transport controls below to scrub through generations.</p>
    </div>
  );
}

// The custom initial-state editor (issue #260 item 1) paints a bigger cell
// than the spacetime renders' own CELL_SIZE_1D/CELL_SIZE_2D (3px/12px) --
// those are sized for DISPLAYING up to MAX_1D_WIDTH/MAX_2D_WIDTH cells at
// once, not for being clicked precisely.
const EDITOR_CELL_SIZE = 14;

/**
 * Paintable black/white grid editor backing a custom initial condition
 * (issue #260 item 1): a flat '0'/'1' bitstring (row-major, `width` x
 * `height`, see custom-grid.ts) that `customGrid1d`/`customGrid2d` in
 * CaState store directly. Reused for both the 1D editor (`height=1`, a
 * single paintable strip) and the 2D editor (a full grid) -- rendered via
 * canvas rather than one DOM node per cell for the same reason the
 * spacetime views above do (up to MAX_2D_WIDTH x MAX_2D_HEIGHT = 6400 cells
 * is a lot of buttons to click-and-drag over).
 */
function CustomGridEditor({ bits, width, height, onChange }: { bits: string; width: number; height: number; onChange: (bits: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintingRef = useRef(false);
  const paintValueRef = useRef<CaCell>(1);
  const lastIndexRef = useRef<number | null>(null);
  const canvasWidth = Math.max(1, width) * EDITOR_CELL_SIZE;
  const canvasHeight = Math.max(1, height) * EDITOR_CELL_SIZE;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const theme = getThemeColors();
    const cells = decodeBits(bits, width * height);
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = theme.ink;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (cells[row * width + col] === 1) ctx.fillRect(col * EDITOR_CELL_SIZE, row * EDITOR_CELL_SIZE, EDITOR_CELL_SIZE, EDITOR_CELL_SIZE);
      }
    }
  }, [bits, width, height, canvasWidth, canvasHeight]);

  function indexAt(clientX: number, clientY: number): number | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return pixelToCellIndex(clientX - rect.left, clientY - rect.top, EDITOR_CELL_SIZE, width, height);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const index = indexAt(e.clientX, e.clientY);
    if (index === null) return;
    const current = decodeBits(bits, width * height)[index] ?? 0;
    const value: CaCell = current === 1 ? 0 : 1;
    paintValueRef.current = value;
    paintingRef.current = true;
    lastIndexRef.current = index;
    onChange(setBit(bits, width * height, index, value));
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!paintingRef.current) return;
    const index = indexAt(e.clientX, e.clientY);
    if (index === null || index === lastIndexRef.current) return;
    lastIndexRef.current = index;
    onChange(setBit(bits, width * height, index, paintValueRef.current));
  }

  function stopPainting() {
    paintingRef.current = false;
    lastIndexRef.current = null;
  }

  return (
    <div style={{ overflowX: "auto", maxWidth: "100%" }}>
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        style={{ border: "1px solid var(--border, #ccc)", cursor: "pointer", touchAction: "none", display: "block" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPainting}
        onPointerLeave={stopPainting}
      />
    </div>
  );
}

const RULE_PICKER_CELL_SIZE = 18;
// Standard Wolfram display order: the neighborhood read as a 3-bit number
// from most to least significant (111 down to 000), matching every
// published elementary-CA rule diagram (e.g. Wolfram|Alpha's own "Rule
// 30" page).
const NEIGHBORHOOD_DISPLAY_ORDER = [7, 6, 5, 4, 3, 2, 1, 0] as const;

/**
 * Visual rule picker for 1D elementary rules (issue #260 item 2): one
 * diagram per possible 3-cell neighborhood -- a row of 3 squares (left,
 * center, right) with a 4th square below showing the resulting next-state
 * cell, exactly the "row of 3 + 1 below" diagram the issue itself
 * describes. Clicking the bottom square flips that neighborhood's outcome
 * via elementary.ts's own `toggleRuleBit`; this component is otherwise just
 * an interactive rendering of `ruleTable(ruleNumber)`.
 */
function RulePicker1D({ ruleNumber, onChange }: { ruleNumber: number; onChange: (ruleNumber: number) => void }) {
  const table = ruleTable(ruleNumber);
  const theme = getThemeColors();
  const cellStyle = (alive: boolean): CSSProperties => ({
    width: RULE_PICKER_CELL_SIZE,
    height: RULE_PICKER_CELL_SIZE,
    background: alive ? theme.ink : theme.surface,
    border: "1px solid var(--border, #999)",
    boxSizing: "border-box" as const,
  });
  return (
    <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
      {NEIGHBORHOOD_DISPLAY_ORDER.map((i) => {
        const left = (i >> 2) & 1;
        const center = (i >> 1) & 1;
        const right = i & 1;
        const outcome = table[i]!;
        return (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ display: "flex" }}>
              <div style={cellStyle(left === 1)} />
              <div style={cellStyle(center === 1)} />
              <div style={cellStyle(right === 1)} />
            </div>
            <button
              type="button"
              onClick={() => onChange(toggleRuleBit(ruleNumber, i))}
              aria-label={`Neighborhood ${left}${center}${right} maps to ${outcome === 1 ? "alive" : "dead"} -- click to toggle`}
              title={`${left}${center}${right} -> ${outcome}`}
              style={{ ...cellStyle(outcome === 1), width: RULE_PICKER_CELL_SIZE * 3, cursor: "pointer", padding: 0, marginTop: 2 }}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Visual rule picker for totalistic B/S rules by neighbor count (issue #260
 * item 2/3): the practical equivalent of the issue's own "3x3 plane + 10th
 * square below" idea for 2D life-like rules -- 2^9 = 512 distinct
 * neighborhoods makes a literal one-diagram-per-neighborhood enumeration
 * intractable the way 1D's 8-entry `RulePicker1D` is (and 2^26 for 3D is
 * far worse), so this shows checkboxes for each possible NEIGHBOR COUNT
 * instead -- exactly what B/S notation itself already encodes, just made
 * clickable. Reused as-is for 2D (`maxCount=8`) and 3D (`maxCount=26`,
 * item 3's minimal 3D extension).
 */
function BirthSurvivalPicker({
  birth,
  survival,
  maxCount,
  onToggleBirth,
  onToggleSurvival,
}: {
  birth: ReadonlySet<number>;
  survival: ReadonlySet<number>;
  maxCount: number;
  onToggleBirth: (count: number) => void;
  onToggleSurvival: (count: number) => void;
}) {
  const counts = Array.from({ length: maxCount + 1 }, (_, i) => i);
  const row = (label: string, active: ReadonlySet<number>, onToggle: (count: number) => void) => (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem", margin: "0.15rem 0" }}>
      <span style={{ width: "4.5rem", flex: "0 0 auto" }}>{label}:</span>
      {counts.map((count) => (
        <label key={count} style={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: "0.7rem" }}>
          {count}
          <input type="checkbox" checked={active.has(count)} onChange={() => onToggle(count)} />
        </label>
      ))}
    </div>
  );
  return (
    <div style={{ margin: "0.5rem 0" }}>
      {row("Birth", birth, onToggleBirth)}
      {row("Survival", survival, onToggleSurvival)}
    </div>
  );
}

/** An n-D cellular automata lab (issue #229): 1D elementary rules rendered as a full space-time image, 2D life-like rules animated + rendered as a voxel spacetime stack, 3D totalistic rules animated as a scrubbable voxel scene. */
export function CellularAutomataPanel({ cellId = "ca-1" }: { cellId?: string } = {}) {
  const graph = useCaGraph(cellId);
  useCellGraphTools(`cellular_automata_${cellId}`, graph);
  const ids = cellIdsCellularAutomata(cellId);

  const dimension = useCell<CaDimension>(graph, ids.dimension);
  const ruleNumber = useCell<number>(graph, ids.ruleNumber);
  const width1d = useCell<number>(graph, ids.width1d);
  const generations1d = useCell<number>(graph, ids.generations1d);
  const boundary1d = useCell<Boundary1D>(graph, ids.boundary1d);
  const initial1d = useCell<InitialCondition1D>(graph, ids.initial1d);
  const seed1d = useCell<number>(graph, ids.seed1d);
  const customGrid1d = useCell<string>(graph, ids.customGrid1d);
  const spacetime1dResult = useCell<Result<Spacetime1D>>(graph, ids.spacetime1dResult);

  const bsRule = useCell<string>(graph, ids.bsRule);
  const width2d = useCell<number>(graph, ids.width2d);
  const height2d = useCell<number>(graph, ids.height2d);
  const generations2d = useCell<number>(graph, ids.generations2d);
  const boundary2d = useCell<Boundary2D>(graph, ids.boundary2d);
  const initial2d = useCell<InitialCondition2D>(graph, ids.initial2d);
  const seed2d = useCell<number>(graph, ids.seed2d);
  const density2d = useCell<number>(graph, ids.density2d);
  const customGrid2d = useCell<string>(graph, ids.customGrid2d);
  const showVoxelView = useCell<boolean>(graph, ids.showVoxelView);
  const spacetime2dResult = useCell<Result<Spacetime2D>>(graph, ids.spacetime2dResult);

  const rule3d = useCell<string>(graph, ids.rule3d);
  const width3d = useCell<number>(graph, ids.width3d);
  const height3d = useCell<number>(graph, ids.height3d);
  const depth3d = useCell<number>(graph, ids.depth3d);
  const generations3d = useCell<number>(graph, ids.generations3d);
  const boundary3d = useCell<Boundary3D>(graph, ids.boundary3d);
  const seed3d = useCell<number>(graph, ids.seed3d);
  const density3d = useCell<number>(graph, ids.density3d);
  const spacetime3dResult = useCell<Result<Spacetime3D>>(graph, ids.spacetime3dResult);

  const time = useCell<number>(graph, TIME_CELL);
  const [bsRuleInput, setBsRuleInput] = useState(bsRule);
  useEffect(() => setBsRuleInput(bsRule), [bsRule]);
  const [rule3dInput, setRule3dInput] = useState(rule3d);
  useEffect(() => setRule3dInput(rule3d), [rule3d]);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const duration =
    dimension === "2d"
      ? spacetime2dResult.ok
        ? spacetime2dResult.value.length * STEP_SECONDS
        : 0
      : dimension === "3d"
        ? spacetime3dResult.ok
          ? spacetime3dResult.value.length * STEP_SECONDS
          : 0
        : 0;
  useTimelinePlayback(graph, playing, loop, speed, duration, setPlaying);

  // A changed 2D/3D run restarts the animation from the beginning.
  useEffect(() => {
    graph.set(TIME_CELL, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spacetime2dResult]);
  useEffect(() => {
    graph.set(TIME_CELL, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spacetime3dResult]);

  useModelContextTool({
    name: `cellular_automata_${cellId}_get_state`,
    description: "Read the panel's current dimension, rule, and grid/generation parameters, plus whether the current computation succeeded (and its error message if not).",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const spacetime2d = graph.get<Result<Spacetime2D>>(ids.spacetime2dResult);
      const spacetime3d = graph.get<Result<Spacetime3D>>(ids.spacetime3dResult);
      return {
        dimension: graph.get<CaDimension>(ids.dimension),
        ruleNumber: graph.get<number>(ids.ruleNumber),
        bsRule: graph.get<string>(ids.bsRule),
        rule3d: graph.get<string>(ids.rule3d),
        spacetime1d: graph.get<Result<Spacetime1D>>(ids.spacetime1dResult),
        spacetime2d: spacetime2d.ok ? { ok: true, generations: spacetime2d.value.length } : spacetime2d,
        spacetime3d: spacetime3d.ok ? { ok: true, generations: spacetime3d.value.length } : spacetime3d,
      };
    },
  });

  useModelContextTool({
    name: `cellular_automata_${cellId}_set_rule`,
    description:
      'Set the active rule -- ruleNumber (0-255) for the 1D dimension, bsRule (e.g. "B3/S23") for the 2D dimension, or rule3d (e.g. "B6/S5,6,7") for the 3D dimension. Only the field matching the panel\'s current dimension has any effect.',
    inputSchema: {
      type: "object",
      properties: {
        ruleNumber: { type: "number", description: "1D elementary rule number, 0-255." },
        bsRule: { type: "string", description: '2D life-like rule in B/S notation, e.g. "B3/S23".' },
        rule3d: { type: "string", description: '3D totalistic rule in comma-separated B/S notation, e.g. "B6/S5,6,7".' },
      },
    },
    handler: async (input) => {
      if (typeof input.ruleNumber === "number") graph.set(ids.ruleNumber, input.ruleNumber);
      if (typeof input.bsRule === "string") graph.set(ids.bsRule, input.bsRule);
      if (typeof input.rule3d === "string") graph.set(ids.rule3d, input.rule3d);
      return {
        dimension: graph.get<CaDimension>(ids.dimension),
        ruleNumber: graph.get<number>(ids.ruleNumber),
        bsRule: graph.get<string>(ids.bsRule),
        rule3d: graph.get<string>(ids.rule3d),
      };
    },
  });

  // subscribeMany (not subscribeAll, issue #242 -- follow-up to #235) --
  // getCurrentState only reads the fixed cell list below, never TIME_CELL,
  // so a subscribeAll here used to re-run writeUrl on every RAF tick of the
  // generation-scrubbing transport during playback even though the URL
  // never encodes playback position at all.
  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeCaState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeMany(
      [
        ids.dimension,
        ids.ruleNumber,
        ids.width1d,
        ids.generations1d,
        ids.boundary1d,
        ids.initial1d,
        ids.seed1d,
        ids.customGrid1d,
        ids.bsRule,
        ids.width2d,
        ids.height2d,
        ids.generations2d,
        ids.boundary2d,
        ids.initial2d,
        ids.seed2d,
        ids.density2d,
        ids.customGrid2d,
        ids.showVoxelView,
        ids.rule3d,
        ids.width3d,
        ids.height3d,
        ids.depth3d,
        ids.generations3d,
        ids.boundary3d,
        ids.seed3d,
        ids.density3d,
      ],
      writeUrl,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  function updateBsRule(value: string) {
    setBsRuleInput(value);
    graph.set(ids.bsRule, value);
  }

  function updateRule3d(value: string) {
    setRule3dInput(value);
    graph.set(ids.rule3d, value);
  }

  const canvas1dRef = useRef<HTMLCanvasElement | null>(null);
  const canvas1dWidth = Math.max(1, width1d) * CELL_SIZE_1D;
  const canvas1dHeight = Math.max(1, generations1d) * CELL_SIZE_1D;

  useEffect(() => {
    const ctx = canvas1dRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas1dWidth, canvas1dHeight);
    if (!spacetime1dResult.ok) return;
    ctx.fillStyle = getThemeColors().ink;
    for (let g = 0; g < spacetime1dResult.value.length; g++) {
      const row = spacetime1dResult.value[g]!;
      for (let x = 0; x < row.length; x++) {
        if (row[x] === 1) ctx.fillRect(x * CELL_SIZE_1D, g * CELL_SIZE_1D, CELL_SIZE_1D, CELL_SIZE_1D);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas1dWidth, canvas1dHeight, spacetime1dResult]);

  const currentGeneration =
    spacetime2dResult.ok && spacetime2dResult.value.length > 0
      ? Math.min(spacetime2dResult.value.length - 1, Math.floor(time / STEP_SECONDS))
      : -1;

  const canvas2dRef = useRef<HTMLCanvasElement | null>(null);
  const canvas2dWidth = Math.max(1, width2d) * CELL_SIZE_2D;
  const canvas2dHeight = Math.max(1, height2d) * CELL_SIZE_2D;

  useEffect(() => {
    const ctx = canvas2dRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas2dWidth, canvas2dHeight);
    if (!spacetime2dResult.ok || currentGeneration < 0) return;
    const grid = spacetime2dResult.value[currentGeneration]!;
    ctx.fillStyle = getThemeColors().ink;
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row]!.length; col++) {
        if (grid[row]![col] === 1) ctx.fillRect(col * CELL_SIZE_2D, row * CELL_SIZE_2D, CELL_SIZE_2D, CELL_SIZE_2D);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas2dWidth, canvas2dHeight, spacetime2dResult, currentGeneration]);

  const voxelBudget = width2d * height2d * generations2d;

  // Parsed only for the visual rule pickers below -- the actual generation
  // logic re-parses bsRule/rule3d itself inside the graph.define blocks
  // above. Wrapped in try/catch (rather than letting parseBSRule's own
  // Error surface here) because bsRuleInput/rule3dInput can be a
  // mid-edit-and-momentarily-invalid string while the user is typing in the
  // raw B/S text field right next to the picker.
  let life2dRule: LifeLikeRule | null = null;
  try {
    life2dRule = parseBSRule(bsRule);
  } catch {
    life2dRule = null;
  }
  function toggleBirth2d(count: number) {
    if (life2dRule) updateBsRule(bsRuleToString(toggleBirth(life2dRule, count)));
  }
  function toggleSurvival2d(count: number) {
    if (life2dRule) updateBsRule(bsRuleToString(toggleSurvival(life2dRule, count)));
  }

  const currentGeneration3d =
    spacetime3dResult.ok && spacetime3dResult.value.length > 0
      ? Math.min(spacetime3dResult.value.length - 1, Math.floor(time / STEP_SECONDS))
      : -1;
  const voxelBudget3d = width3d * height3d * depth3d;

  // Same try/catch reasoning as life2dRule above, for the 3D visual rule
  // picker (issue #260 item 3).
  let rule3dParsed: Totalistic3DRule | null = null;
  try {
    rule3dParsed = parseTotalisticRule3D(rule3d);
  } catch {
    rule3dParsed = null;
  }
  function toggleBirth3d(count: number) {
    if (rule3dParsed) updateRule3d(totalisticRule3DToString(toggleBirth3D(rule3dParsed, count)));
  }
  function toggleSurvival3d(count: number) {
    if (rule3dParsed) updateRule3d(totalisticRule3DToString(toggleSurvival3D(rule3dParsed, count)));
  }

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          dimension:{" "}
          <select value={dimension} onChange={(e) => graph.set(ids.dimension, e.target.value as CaDimension)}>
            <option value="1d">1D (elementary)</option>
            <option value="2d">2D (life-like)</option>
            <option value="3d">3D (totalistic)</option>
          </select>
        </label>
      </div>

      {dimension === "1d" && (
        <>
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              rule:{" "}
              <select
                value={NAMED_ELEMENTARY_RULES.some((r) => r.ruleNumber === ruleNumber) ? String(ruleNumber) : "custom"}
                onChange={(e) => {
                  if (e.target.value !== "custom") graph.set(ids.ruleNumber, Number(e.target.value));
                }}
              >
                {NAMED_ELEMENTARY_RULES.map((r) => (
                  <option key={r.ruleNumber} value={r.ruleNumber}>
                    {r.name}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </label>
            <label>
              rule #:{" "}
              <input
                type="number"
                min={0}
                max={255}
                value={ruleNumber}
                onChange={(e) => graph.set(ids.ruleNumber, Math.max(0, Math.min(255, Number(e.target.value))))}
                style={{ font: "inherit", width: "5ch" }}
              />
              <input
                type="range"
                aria-label="rule # slider"
                min={0}
                max={255}
                value={ruleNumber}
                onChange={(e) => graph.set(ids.ruleNumber, Number(e.target.value))}
                style={{ verticalAlign: "middle", marginLeft: "0.4rem" }}
              />
            </label>
            <label>
              width: <input type="number" min={1} max={MAX_1D_WIDTH} value={width1d} onChange={(e) => graph.set(ids.width1d, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "6ch" }} />
            </label>
            <label>
              generations: <input type="number" min={1} max={MAX_1D_GENERATIONS} value={generations1d} onChange={(e) => graph.set(ids.generations1d, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "6ch" }} />
            </label>
            <label>
              boundary:{" "}
              <select value={boundary1d} onChange={(e) => graph.set(ids.boundary1d, e.target.value as Boundary1D)}>
                <option value="zero">Fixed (0 off-grid)</option>
                <option value="wrap">Wrap (periodic)</option>
              </select>
            </label>
            <label>
              initial:{" "}
              <select value={initial1d} onChange={(e) => graph.set(ids.initial1d, e.target.value as InitialCondition1D)}>
                <option value="single-cell">Single cell</option>
                <option value="random">Random</option>
                <option value="custom">Custom (paint it)</option>
              </select>
            </label>
            {initial1d === "random" && (
              <label>
                seed: <input type="number" value={seed1d} onChange={(e) => graph.set(ids.seed1d, Number(e.target.value))} style={{ font: "inherit", width: "6ch" }} />
              </label>
            )}
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{NAMED_ELEMENTARY_RULES.find((r) => r.ruleNumber === ruleNumber)?.description ?? "Custom rule."}</p>

          {initial1d === "custom" && (
            <div style={{ margin: "0.5rem 0" }}>
              <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.25rem" }}>Click or drag to paint the starting row (black = alive). Width follows the "width" field above.</p>
              <CustomGridEditor bits={customGrid1d} width={width1d} height={1} onChange={(bits) => graph.set(ids.customGrid1d, bits)} />
              <button type="button" onClick={() => graph.set(ids.customGrid1d, blankBits(width1d))} style={{ marginTop: "0.35rem" }}>
                Clear
              </button>
            </div>
          )}

          <details style={{ margin: "0.5rem 0" }}>
            <summary style={{ cursor: "pointer" }}>Visual rule picker</summary>
            <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.35rem 0" }}>
              Every possible 3-cell neighborhood (left, center, right); click the square below a neighborhood to toggle what it becomes next.
            </p>
            <RulePicker1D ruleNumber={ruleNumber} onChange={(n) => graph.set(ids.ruleNumber, n)} />
          </details>

          {!spacetime1dResult.ok && <p style={{ color: "crimson" }}>{spacetime1dResult.message}</p>}
          <canvas ref={canvas1dRef} width={canvas1dWidth} height={canvas1dHeight} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => canvas1dRef.current} label="ca-elementary" />
          </div>
        </>
      )}

      {dimension === "2d" && (
        <>
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              rule:{" "}
              <select
                value={NAMED_LIFE_LIKE_RULES.some((r) => r.rule === bsRule) ? bsRule : "custom"}
                onChange={(e) => {
                  if (e.target.value !== "custom") updateBsRule(e.target.value);
                }}
              >
                {NAMED_LIFE_LIKE_RULES.map((r) => (
                  <option key={r.rule} value={r.rule}>
                    {r.name} ({r.rule})
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </label>
            <label>
              B/S: <input value={bsRuleInput} onChange={(e) => updateBsRule(e.target.value)} style={{ font: "inherit", fontFamily: "monospace", width: "10ch" }} />
            </label>
            <label>
              width: <input type="number" min={1} max={MAX_2D_WIDTH} value={width2d} onChange={(e) => graph.set(ids.width2d, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "6ch" }} />
            </label>
            <label>
              height: <input type="number" min={1} max={MAX_2D_HEIGHT} value={height2d} onChange={(e) => graph.set(ids.height2d, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "6ch" }} />
            </label>
            <label>
              generations: <input type="number" min={1} max={MAX_2D_GENERATIONS} value={generations2d} onChange={(e) => graph.set(ids.generations2d, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "6ch" }} />
            </label>
            <label>
              boundary:{" "}
              <select value={boundary2d} onChange={(e) => graph.set(ids.boundary2d, e.target.value as Boundary2D)}>
                <option value="dead">Fixed (dead off-grid)</option>
                <option value="wrap">Wrap (torus)</option>
              </select>
            </label>
            <label>
              initial:{" "}
              <select value={initial2d} onChange={(e) => graph.set(ids.initial2d, e.target.value as InitialCondition2D)}>
                <option value="random">Random</option>
                <option value="custom">Custom (paint it)</option>
              </select>
            </label>
            {initial2d === "random" && (
              <>
                <label>
                  seed: <input type="number" value={seed2d} onChange={(e) => graph.set(ids.seed2d, Number(e.target.value))} style={{ font: "inherit", width: "6ch" }} />
                </label>
                <label>
                  density: <input type="number" min={0} max={1} step={0.05} value={density2d} onChange={(e) => graph.set(ids.density2d, Number(e.target.value))} style={{ font: "inherit", width: "6ch" }} />
                  <input
                    type="range"
                    aria-label="density slider"
                    min={0}
                    max={1}
                    step={0.05}
                    value={density2d}
                    onChange={(e) => graph.set(ids.density2d, Number(e.target.value))}
                    style={{ verticalAlign: "middle", marginLeft: "0.4rem" }}
                  />
                </label>
              </>
            )}
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{NAMED_LIFE_LIKE_RULES.find((r) => r.rule === bsRule)?.description ?? "Custom rule."}</p>

          {initial2d === "custom" && (
            <div style={{ margin: "0.5rem 0" }}>
              <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.25rem" }}>
                Click or drag to paint the starting grid (black = alive). Size follows the "width"/"height" fields above.
              </p>
              <CustomGridEditor bits={customGrid2d} width={width2d} height={height2d} onChange={(bits) => graph.set(ids.customGrid2d, bits)} />
              <button type="button" onClick={() => graph.set(ids.customGrid2d, blankBits(width2d * height2d))} style={{ marginTop: "0.35rem" }}>
                Clear
              </button>
            </div>
          )}

          <details style={{ margin: "0.5rem 0" }}>
            <summary style={{ cursor: "pointer" }}>Visual rule picker</summary>
            <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.35rem 0" }}>
              Birth/survival by live-neighbor count (the "3x3 plane" idea made tractable: 2^9 neighborhoods is too many to enumerate individually, so this is what B/S notation already collapses them to).
            </p>
            {life2dRule ? (
              <BirthSurvivalPicker birth={life2dRule.birth} survival={life2dRule.survival} maxCount={8} onToggleBirth={toggleBirth2d} onToggleSurvival={toggleSurvival2d} />
            ) : (
              <p style={{ color: "crimson", fontSize: "0.8rem" }}>Fix the B/S rule text above to use the visual picker.</p>
            )}
          </details>

          {!spacetime2dResult.ok && <p style={{ color: "crimson" }}>{spacetime2dResult.message}</p>}

          <canvas ref={canvas2dRef} width={canvas2dWidth} height={canvas2dHeight} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => canvas2dRef.current} label="ca-life-like" />
          </div>
          {spacetime2dResult.ok && (
            <>
              <TransportControls graph={graph} time={time} duration={duration} playing={playing} setPlaying={setPlaying} loop={loop} setLoop={setLoop} speed={speed} setSpeed={setSpeed} />
              <p style={{ fontSize: "0.85rem", color: "var(--muted)" }} aria-live="polite">
                Generation {currentGeneration} of {spacetime2dResult.value.length - 1}
              </p>
            </>
          )}

          <div style={{ margin: "0.75rem 0", paddingTop: "0.5rem", borderTop: "1px solid var(--border, #ccc)" }}>
            <label>
              <input
                type="checkbox"
                checked={showVoxelView}
                disabled={voxelBudget > MAX_VOXEL_CELLS}
                onChange={(e) => graph.set(ids.showVoxelView, e.target.checked)}
              />{" "}
              3D voxel spacetime stack (every generation at once)
            </label>
            {voxelBudget > MAX_VOXEL_CELLS && (
              <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                width x height x generations ({voxelBudget}) exceeds the {MAX_VOXEL_CELLS} cap for the voxel view -- shrink one of them to enable it.
              </p>
            )}
            {showVoxelView && voxelBudget <= MAX_VOXEL_CELLS && <VoxelSpacetimeView spacetime={spacetime2dResult.ok ? spacetime2dResult.value : null} />}
          </div>
        </>
      )}

      {dimension === "3d" && (
        <>
          <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              rule:{" "}
              <select
                value={NAMED_TOTALISTIC_3D_RULES.some((r) => r.rule === rule3d) ? rule3d : "custom"}
                onChange={(e) => {
                  if (e.target.value !== "custom") updateRule3d(e.target.value);
                }}
              >
                {NAMED_TOTALISTIC_3D_RULES.map((r) => (
                  <option key={r.rule} value={r.rule}>
                    {r.name} ({r.rule})
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </label>
            <label>
              B/S:{" "}
              <input
                value={rule3dInput}
                onChange={(e) => updateRule3d(e.target.value)}
                style={{ font: "inherit", fontFamily: "monospace", width: "14ch" }}
              />
            </label>
            <label>
              width: <input type="number" min={1} max={MAX_3D_WIDTH} value={width3d} onChange={(e) => graph.set(ids.width3d, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "6ch" }} />
            </label>
            <label>
              height: <input type="number" min={1} max={MAX_3D_HEIGHT} value={height3d} onChange={(e) => graph.set(ids.height3d, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "6ch" }} />
            </label>
            <label>
              depth: <input type="number" min={1} max={MAX_3D_DEPTH} value={depth3d} onChange={(e) => graph.set(ids.depth3d, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "6ch" }} />
            </label>
            <label>
              generations: <input type="number" min={1} max={MAX_3D_GENERATIONS} value={generations3d} onChange={(e) => graph.set(ids.generations3d, Math.max(1, Number(e.target.value)))} style={{ font: "inherit", width: "6ch" }} />
            </label>
            <label>
              boundary:{" "}
              <select value={boundary3d} onChange={(e) => graph.set(ids.boundary3d, e.target.value as Boundary3D)}>
                <option value="dead">Fixed (dead off-grid)</option>
                <option value="wrap">Wrap (torus)</option>
              </select>
            </label>
            <label>
              seed: <input type="number" value={seed3d} onChange={(e) => graph.set(ids.seed3d, Number(e.target.value))} style={{ font: "inherit", width: "6ch" }} />
            </label>
            <label>
              density: <input type="number" min={0} max={1} step={0.05} value={density3d} onChange={(e) => graph.set(ids.density3d, Number(e.target.value))} style={{ font: "inherit", width: "6ch" }} />
              <input
                type="range"
                aria-label="density slider"
                min={0}
                max={1}
                step={0.05}
                value={density3d}
                onChange={(e) => graph.set(ids.density3d, Number(e.target.value))}
                style={{ verticalAlign: "middle", marginLeft: "0.4rem" }}
              />
            </label>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{NAMED_TOTALISTIC_3D_RULES.find((r) => r.rule === rule3d)?.description ?? "Custom rule."}</p>

          <details style={{ margin: "0.5rem 0" }}>
            <summary style={{ cursor: "pointer" }}>Visual rule picker</summary>
            <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.35rem 0" }}>
              Birth/survival by live-neighbor count, extended to 3D's 0-26 range (issue #260 item 3 -- a minimal push past 2D, reusing the same checkbox-grid idea rather than a literal 3x3x3-cube-plus-27th-cell diagram).
            </p>
            {rule3dParsed ? (
              <BirthSurvivalPicker birth={rule3dParsed.birth} survival={rule3dParsed.survival} maxCount={26} onToggleBirth={toggleBirth3d} onToggleSurvival={toggleSurvival3d} />
            ) : (
              <p style={{ color: "crimson", fontSize: "0.8rem" }}>Fix the B/S rule text above to use the visual picker.</p>
            )}
          </details>
          <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
            The custom initial-state editor (above, for 1D/2D) isn't available for 3D yet -- painting a 3D volume needs its own UI (e.g. per-layer slices) and is deferred as future work; the grid is always randomly seeded here.
          </p>

          {voxelBudget3d > MAX_3D_GRID_CELLS && (
            <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              width x height x depth ({voxelBudget3d}) exceeds the {MAX_3D_GRID_CELLS} cap -- shrink one of them.
            </p>
          )}
          {!spacetime3dResult.ok && <p style={{ color: "crimson" }}>{spacetime3dResult.message}</p>}

          {spacetime3dResult.ok && (
            <>
              <Voxel3DFrameView frame={currentGeneration3d >= 0 ? spacetime3dResult.value[currentGeneration3d]! : null} />
              <TransportControls graph={graph} time={time} duration={duration} playing={playing} setPlaying={setPlaying} loop={loop} setLoop={setLoop} speed={speed} setSpeed={setSpeed} />
              <p style={{ fontSize: "0.85rem", color: "var(--muted)" }} aria-live="polite">
                Generation {currentGeneration3d} of {spacetime3dResult.value.length - 1}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
