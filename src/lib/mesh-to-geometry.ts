import type { Mesh } from "@johnhenry/math";
import * as THREE from "three";

/**
 * Converts a mallory-math Graph3DUtils Mesh (a colour + a flat list of
 * triangular Faces, each three independent Vec3 corners) into a Three.js
 * BufferGeometry. Deliberately non-indexed: mallory-math's faces don't share a
 * vertex pool, so every triangle's three corners are appended as-is rather
 * than deduplicated into an index buffer -- simpler, and the vertex counts
 * here (one grid's worth of triangles) are small enough that the memory cost
 * of duplicate vertices doesn't matter.
 */
export function meshToGeometry(mesh: Mesh): THREE.BufferGeometry {
  const positions = new Float32Array(mesh.faces.length * 9);
  let i = 0;
  for (const face of mesh.faces) {
    for (const vertex of face) {
      // mallory-math's z is the function's height (z=f(x,y)); Three.js/
      // OrbitControls conventionally treat Y as "up", so height maps to
      // Three's y-axis and mallory-math's y maps to Three's z-axis.
      positions[i++] = vertex.x;
      positions[i++] = vertex.z;
      positions[i++] = vertex.y;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function meshToMaterial(mesh: Mesh): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: mesh.material.color,
    opacity: mesh.material.alpha,
    transparent: mesh.material.alpha < 1,
    side: mesh.material.oneSide ? THREE.FrontSide : THREE.DoubleSide,
  });
}
