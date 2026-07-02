/**
 * Quaternion — a number of the form `w + x·i + y·j + z·k`, the four-dimensional
 * division algebra. Extends the idea of {@link ComplexNumber} and is the
 * standard tool for representing and composing 3D rotations.
 */
export class Quaternion {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;

  static readonly Identity = new Quaternion(1, 0, 0, 0);
  static readonly Zero = new Quaternion(0, 0, 0, 0);

  constructor(w = 0, x = 0, y = 0, z = 0) {
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
  }

  add(q: Quaternion): Quaternion {
    return new Quaternion(this.w + q.w, this.x + q.x, this.y + q.y, this.z + q.z);
  }

  subtract(q: Quaternion): Quaternion {
    return new Quaternion(this.w - q.w, this.x - q.x, this.y - q.y, this.z - q.z);
  }

  scale(s: number): Quaternion {
    return new Quaternion(this.w * s, this.x * s, this.y * s, this.z * s);
  }

  negate(): Quaternion {
    return new Quaternion(-this.w, -this.x, -this.y, -this.z);
  }

  /** The Hamilton product (non-commutative). */
  multiply(q: Quaternion): Quaternion {
    return new Quaternion(
      this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z,
      this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
      this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
      this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w,
    );
  }

  conjugate(): Quaternion {
    return new Quaternion(this.w, -this.x, -this.y, -this.z);
  }

  dot(q: Quaternion): number {
    return this.w * q.w + this.x * q.x + this.y * q.y + this.z * q.z;
  }

  get norm(): number {
    return Math.hypot(this.w, this.x, this.y, this.z);
  }

  normalize(): Quaternion {
    const n = this.norm;
    if (n === 0) throw new Error("Cannot normalize the zero quaternion.");
    return this.scale(1 / n);
  }

  /** Multiplicative inverse `q⁻¹ = conj(q) / |q|²`. */
  inverse(): Quaternion {
    const n2 = this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z;
    if (n2 === 0) throw new Error("The zero quaternion has no inverse.");
    return this.conjugate().scale(1 / n2);
  }

  equals(q: Quaternion): boolean {
    return this.w === q.w && this.x === q.x && this.y === q.y && this.z === q.z;
  }

  /** A unit quaternion representing a rotation of `angle` radians about `axis`. */
  static fromAxisAngle(axis: [number, number, number], angle: number): Quaternion {
    const [ax, ay, az] = axis;
    const len = Math.hypot(ax, ay, az) || 1;
    const half = angle / 2;
    const s = Math.sin(half) / len;
    return new Quaternion(Math.cos(half), ax * s, ay * s, az * s);
  }

  /** Rotate a 3D vector by this (unit) quaternion, returning `[x, y, z]`. */
  rotateVector(v: [number, number, number]): [number, number, number] {
    const q = this.normalize();
    const p = new Quaternion(0, v[0], v[1], v[2]);
    const r = q.multiply(p).multiply(q.conjugate());
    return [r.x, r.y, r.z];
  }

  /** The 3×3 rotation matrix (as `number[][]`) for this quaternion. */
  toRotationMatrix(): number[][] {
    const { w, x, y, z } = this.normalize();
    return [
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ];
  }

  /** Spherical linear interpolation between two unit quaternions. */
  static slerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
    const qa = a.normalize();
    let qb = b.normalize();
    let cos = qa.dot(qb);
    if (cos < 0) {
      qb = qb.scale(-1);
      cos = -cos;
    }
    if (cos > 0.9995) return qa.add(qb.subtract(qa).scale(t)).normalize();
    const theta0 = Math.acos(cos);
    const theta = theta0 * t;
    const sinTheta0 = Math.sin(theta0);
    const s0 = Math.sin(theta0 - theta) / sinTheta0;
    const s1 = Math.sin(theta) / sinTheta0;
    return qa.scale(s0).add(qb.scale(s1));
  }

  toString(): string {
    return `${this.w} + ${this.x}i + ${this.y}j + ${this.z}k`;
  }
}
