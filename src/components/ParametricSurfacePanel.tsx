import type { Mesh } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsParametricSurface, type CellIdsParametricSurface } from "../lib/cell-ids.ts";
import { meshToGeometry, meshToMaterial } from "../lib/mesh-to-geometry.ts";
import { PARAMETRIC_PRESETS, sampleParametricSurface } from "../lib/sample-parametric-surface.ts";
import {
  DEFAULT_PARAMETRIC_SURFACE_STATE,
  decodeParametricSurfaceState,
  encodeParametricSurfaceState,
  type ParametricSurfaceState,
} from "../lib/parametric-surface-state.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const WIDTH = 500;
const HEIGHT = 500;
const RESOLUTION = 30;

function seedState(graph: CellGraph, ids: CellIdsParametricSurface, state: ParametricSurfaceState): void {
  graph.set(ids.exprX, state.exprX);
  graph.set(ids.exprY, state.exprY);
  graph.set(ids.exprZ, state.exprZ);
  graph.set(ids.uMin, state.uMin);
  graph.set(ids.uMax, state.uMax);
  graph.set(ids.vMin, state.vMin);
  graph.set(ids.vMax, state.vMax);
}

function getCurrentState(graph: CellGraph, ids: CellIdsParametricSurface): ParametricSurfaceState {
  return {
    v: 1,
    exprX: graph.get<string>(ids.exprX),
    exprY: graph.get<string>(ids.exprY),
    exprZ: graph.get<string>(ids.exprZ),
    uMin: graph.get<string>(ids.uMin),
    uMax: graph.get<string>(ids.uMax),
    vMin: graph.get<string>(ids.vMin),
    vMax: graph.get<string>(ids.vMax),
  };
}

function useParametricSurfaceGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsParametricSurface(cellId);
    const decoded = typeof window !== "undefined" ? decodeParametricSurfaceState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_PARAMETRIC_SURFACE_STATE);

    graph.define(ids.mesh, (): Result<Mesh[]> => {
      try {
        const uMin = Number(graph.get<string>(ids.uMin));
        const uMax = Number(graph.get<string>(ids.uMax));
        const vMin = Number(graph.get<string>(ids.vMin));
        const vMax = Number(graph.get<string>(ids.vMax));
        if ([uMin, uMax, vMin, vMax].some(Number.isNaN)) throw new Error("u/v bounds must be numbers.");
        if (uMin >= uMax) throw new Error("u-min must be less than u-max.");
        if (vMin >= vMax) throw new Error("v-min must be less than v-max.");
        const mesh = sampleParametricSurface(
          graph.get<string>(ids.exprX),
          graph.get<string>(ids.exprY),
          graph.get<string>(ids.exprZ),
          { min: uMin, max: uMax },
          { min: vMin, max: vMax },
          RESOLUTION,
        );
        return { ok: true, value: mesh };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/**
 * A parametric surface r(u,v) = (x(u,v), y(u,v), z(u,v)) -- torus/sphere/
 * Möbius-strip presets plus free-typed x/y/z expressions (part of #30). A
 * standalone panel (own CellGraph, no keyframe/video-export machinery)
 * rather than folded into Graph3DCanvas's much heavier z=f(x,y) pipeline --
 * that component's keyframe tracks, cross-section highlighting, and export
 * pipeline are all specific to a height-field surface with a single free
 * "z=" expression, not a genuine fit for three independent u/v expressions.
 * Keyframe animation and video export for this panel are deferred scope.
 */
export function ParametricSurfacePanel({ cellId = "param-surface-1" }: { cellId?: string } = {}) {
  const graph = useParametricSurfaceGraph(cellId);
  useCellGraphTools(`surface3d_parametric_${cellId}`, graph);
  const ids = cellIdsParametricSurface(cellId);
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group | null>(null);

  const exprX = useCell<string>(graph, ids.exprX);
  const exprY = useCell<string>(graph, ids.exprY);
  const exprZ = useCell<string>(graph, ids.exprZ);
  const uMin = useCell<string>(graph, ids.uMin);
  const uMax = useCell<string>(graph, ids.uMax);
  const vMin = useCell<string>(graph, ids.vMin);
  const vMax = useCell<string>(graph, ids.vMax);
  const meshResult = useCell<Result<Mesh[]>>(graph, ids.mesh);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeParametricSurfaceState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  function loadPreset(key: string) {
    const preset = PARAMETRIC_PRESETS[key];
    if (!preset) return;
    graph.set(ids.exprX, preset.exprX);
    graph.set(ids.exprY, preset.exprY);
    graph.set(ids.exprZ, preset.exprZ);
    graph.set(ids.uMin, String(preset.uDomain.min));
    graph.set(ids.uMax, String(preset.uDomain.max));
    graph.set(ids.vMin, String(preset.vDomain.min));
    graph.set(ids.vMax, String(preset.vDomain.max));
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const camera = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 1000);
    camera.position.set(6, 6, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(WIDTH, HEIGHT, false);
    container.appendChild(renderer.domElement);

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
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      groupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = groupRef.current;
    if (!group || !meshResult.ok) return;
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
      }
    }
    for (const surfaceMesh of meshResult.value) {
      group.add(new THREE.Mesh(meshToGeometry(surfaceMesh), meshToMaterial(surfaceMesh)));
    }
  }, [meshResult]);

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          preset:{" "}
          <select defaultValue="torus" onChange={(e) => loadPreset(e.target.value)}>
            {Object.entries(PARAMETRIC_PRESETS).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          x(u,v) = <input value={exprX} onChange={(e) => graph.set(ids.exprX, e.target.value)} style={{ font: "inherit", width: "18ch" }} />
        </label>
        <label>
          y(u,v) = <input value={exprY} onChange={(e) => graph.set(ids.exprY, e.target.value)} style={{ font: "inherit", width: "18ch" }} />
        </label>
        <label>
          z(u,v) = <input value={exprZ} onChange={(e) => graph.set(ids.exprZ, e.target.value)} style={{ font: "inherit", width: "18ch" }} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          u: [<input value={uMin} onChange={(e) => graph.set(ids.uMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />,{" "}
          <input value={uMax} onChange={(e) => graph.set(ids.uMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
        <label>
          v: [<input value={vMin} onChange={(e) => graph.set(ids.vMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />,{" "}
          <input value={vMax} onChange={(e) => graph.set(ids.vMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
      </div>
      {!meshResult.ok && <p style={{ color: "var(--danger)" }}>{meshResult.message}</p>}
      <div ref={containerRef} style={{ maxWidth: WIDTH, border: "1px solid var(--border)" }} />
      <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Drag to orbit, scroll to zoom.</p>
    </div>
  );
}
