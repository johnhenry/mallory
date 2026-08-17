import { useEffect, useRef, useState } from "react";
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
  type CaDimension,
  type CaState,
  type InitialCondition1D,
} from "../lib/ca-state.ts";
import { NAMED_ELEMENTARY_RULES, spacetimeElementary, type Spacetime as Spacetime1D } from "../lib/ca/elementary.ts";
import { NAMED_LIFE_LIKE_RULES, parseBSRule, randomGrid, spacetimeLifeLike, type Spacetime2D } from "../lib/ca/life-like.ts";
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

function seedState(graph: CellGraph, ids: CellIdsCellularAutomata, state: CaState): void {
  graph.set(ids.dimension, state.dimension);
  graph.set(ids.ruleNumber, state.ruleNumber);
  graph.set(ids.width1d, state.width1d);
  graph.set(ids.generations1d, state.generations1d);
  graph.set(ids.boundary1d, state.boundary1d);
  graph.set(ids.initial1d, state.initial1d);
  graph.set(ids.seed1d, state.seed1d);
  graph.set(ids.bsRule, state.bsRule);
  graph.set(ids.width2d, state.width2d);
  graph.set(ids.height2d, state.height2d);
  graph.set(ids.generations2d, state.generations2d);
  graph.set(ids.boundary2d, state.boundary2d);
  graph.set(ids.seed2d, state.seed2d);
  graph.set(ids.density2d, state.density2d);
  graph.set(ids.showVoxelView, state.showVoxelView);
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
    bsRule: graph.get<string>(ids.bsRule),
    width2d: graph.get<number>(ids.width2d),
    height2d: graph.get<number>(ids.height2d),
    generations2d: graph.get<number>(ids.generations2d),
    boundary2d: graph.get<Boundary2D>(ids.boundary2d),
    seed2d: graph.get<number>(ids.seed2d),
    density2d: graph.get<number>(ids.density2d),
    showVoxelView: graph.get<boolean>(ids.showVoxelView),
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
        const value = spacetimeElementary(
          graph.get<number>(ids.ruleNumber),
          width,
          generations,
          initial,
          graph.get<Boundary1D>(ids.boundary1d),
          rng,
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
        const initial = randomGrid(width, height, new Rng(graph.get<number>(ids.seed2d)), graph.get<number>(ids.density2d));
        const value = spacetimeLifeLike(initial, rule, generations, graph.get<Boundary2D>(ids.boundary2d));
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
        <PngExportButton getCanvas={() => rendererCanvasRef.current} label="ca-voxel-spacetime" />
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag to orbit, scroll to zoom. Y axis is time (generation); color sweeps from early (red) to late (violet) generations.</p>
    </div>
  );
}

/** An n-D cellular automata lab (issue #229): 1D elementary rules rendered as a full space-time image, 2D life-like rules animated + rendered as a voxel spacetime stack. */
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
  const spacetime1dResult = useCell<Result<Spacetime1D>>(graph, ids.spacetime1dResult);

  const bsRule = useCell<string>(graph, ids.bsRule);
  const width2d = useCell<number>(graph, ids.width2d);
  const height2d = useCell<number>(graph, ids.height2d);
  const generations2d = useCell<number>(graph, ids.generations2d);
  const boundary2d = useCell<Boundary2D>(graph, ids.boundary2d);
  const seed2d = useCell<number>(graph, ids.seed2d);
  const density2d = useCell<number>(graph, ids.density2d);
  const showVoxelView = useCell<boolean>(graph, ids.showVoxelView);
  const spacetime2dResult = useCell<Result<Spacetime2D>>(graph, ids.spacetime2dResult);

  const time = useCell<number>(graph, TIME_CELL);
  const [bsRuleInput, setBsRuleInput] = useState(bsRule);
  useEffect(() => setBsRuleInput(bsRule), [bsRule]);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const duration = spacetime2dResult.ok ? spacetime2dResult.value.length * STEP_SECONDS : 0;
  useTimelinePlayback(graph, playing, loop, speed, duration, setPlaying);

  // A changed 2D run restarts the animation from the beginning.
  useEffect(() => {
    graph.set(TIME_CELL, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spacetime2dResult]);

  useModelContextTool({
    name: `cellular_automata_${cellId}_get_state`,
    description: "Read the panel's current dimension, rule, and grid/generation parameters, plus whether the current computation succeeded (and its error message if not).",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const spacetime2d = graph.get<Result<Spacetime2D>>(ids.spacetime2dResult);
      return {
        dimension: graph.get<CaDimension>(ids.dimension),
        ruleNumber: graph.get<number>(ids.ruleNumber),
        bsRule: graph.get<string>(ids.bsRule),
        spacetime1d: graph.get<Result<Spacetime1D>>(ids.spacetime1dResult),
        spacetime2d: spacetime2d.ok ? { ok: true, generations: spacetime2d.value.length } : spacetime2d,
      };
    },
  });

  useModelContextTool({
    name: `cellular_automata_${cellId}_set_rule`,
    description: "Set the active rule -- ruleNumber (0-255) for the 1D dimension, or bsRule (e.g. \"B3/S23\") for the 2D dimension. Only the field matching the panel's current dimension has any effect.",
    inputSchema: {
      type: "object",
      properties: {
        ruleNumber: { type: "number", description: "1D elementary rule number, 0-255." },
        bsRule: { type: "string", description: '2D life-like rule in B/S notation, e.g. "B3/S23".' },
      },
    },
    handler: async (input) => {
      if (typeof input.ruleNumber === "number") graph.set(ids.ruleNumber, input.ruleNumber);
      if (typeof input.bsRule === "string") graph.set(ids.bsRule, input.bsRule);
      return { dimension: graph.get<CaDimension>(ids.dimension), ruleNumber: graph.get<number>(ids.ruleNumber), bsRule: graph.get<string>(ids.bsRule) };
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
        ids.bsRule,
        ids.width2d,
        ids.height2d,
        ids.generations2d,
        ids.boundary2d,
        ids.seed2d,
        ids.density2d,
        ids.showVoxelView,
      ],
      writeUrl,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  function updateBsRule(value: string) {
    setBsRuleInput(value);
    graph.set(ids.bsRule, value);
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

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          dimension:{" "}
          <select value={dimension} onChange={(e) => graph.set(ids.dimension, e.target.value as CaDimension)}>
            <option value="1d">1D (elementary)</option>
            <option value="2d">2D (life-like)</option>
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
              </select>
            </label>
            {initial1d === "random" && (
              <label>
                seed: <input type="number" value={seed1d} onChange={(e) => graph.set(ids.seed1d, Number(e.target.value))} style={{ font: "inherit", width: "6ch" }} />
              </label>
            )}
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{NAMED_ELEMENTARY_RULES.find((r) => r.ruleNumber === ruleNumber)?.description ?? "Custom rule."}</p>
          {!spacetime1dResult.ok && <p style={{ color: "crimson" }}>{spacetime1dResult.message}</p>}
          <canvas ref={canvas1dRef} width={canvas1dWidth} height={canvas1dHeight} style={{ border: "1px solid #ccc", maxWidth: "100%" }} />
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
              seed: <input type="number" value={seed2d} onChange={(e) => graph.set(ids.seed2d, Number(e.target.value))} style={{ font: "inherit", width: "6ch" }} />
            </label>
            <label>
              density: <input type="number" min={0} max={1} step={0.05} value={density2d} onChange={(e) => graph.set(ids.density2d, Number(e.target.value))} style={{ font: "inherit", width: "6ch" }} />
            </label>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{NAMED_LIFE_LIKE_RULES.find((r) => r.rule === bsRule)?.description ?? "Custom rule."}</p>
          {!spacetime2dResult.ok && <p style={{ color: "crimson" }}>{spacetime2dResult.message}</p>}

          <canvas ref={canvas2dRef} width={canvas2dWidth} height={canvas2dHeight} style={{ border: "1px solid #ccc", maxWidth: "100%" }} />
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
    </div>
  );
}
