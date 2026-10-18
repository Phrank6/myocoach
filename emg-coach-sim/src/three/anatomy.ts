import {
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { MuscleId } from '../domain/muscles';

/**
 * Muscles are surface patches laid onto the mannequin rather than free-floating solids.
 * Each one is a closed outline in the parameter space of the surface it sits on
 * (torso: angle around the body × height; arm: angle around the limb × length),
 * filled with a ring grid and lifted along the surface normal into a belly that thins to nothing at the edge.
 */

export interface Surface {
  p: (u: number, v: number) => Vector3;
  out: (u: number, v: number) => Vector3;
  /** World units per unit of u, so fibre spacing is even on screen. */
  metric: number;
}

export type Fibers = { kind: 'parallel'; angle: number } | { kind: 'fan'; origin: [number, number] };

export interface PatchSpec {
  outline: [number, number][];
  center?: [number, number];
  thick: number;
  base?: number;
  fibers: Fibers;
}

const N = 72;
const RINGS = 9;
const STRIPE_TILE = 0.07;

export function buildPatch(surf: Surface, spec: PatchSpec): BufferGeometry {
  const curve = new CatmullRomCurve3(spec.outline.map(([u, v]) => new Vector3(u, v, 0)), true, 'centripetal');
  const ring = curve.getSpacedPoints(N).slice(0, N);
  const c = spec.center ? new Vector3(spec.center[0], spec.center[1], 0) : ring.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / N);
  const base = spec.base ?? 0.002;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];

  const m = surf.metric;
  const fiber = spec.fibers;
  let rMean = 0;
  if (fiber.kind === 'fan') {
    for (const p of ring) rMean += Math.hypot((p.x - fiber.origin[0]) * m, p.y - fiber.origin[1]);
    rMean /= N;
  }
  const uvOf = (u: number, v: number): [number, number] => {
    const x = u * m;
    if (fiber.kind === 'parallel') {
      const dx = Math.cos(fiber.angle);
      const dy = Math.sin(fiber.angle);
      return [(-x * dy + v * dx) / STRIPE_TILE, (x * dx + v * dy) / 0.12];
    }
    const ox = x - fiber.origin[0] * m;
    const oy = v - fiber.origin[1];
    return [(Math.atan2(oy, ox) * rMean) / STRIPE_TILE, Math.hypot(ox, oy) / 0.12];
  };

  const push = (u: number, v: number, s: number) => {
    const p = surf.p(u, v);
    const n = surfaceNormal(surf, u, v);
    const h = base + spec.thick * Math.pow(Math.max(0, 1 - s * s), 0.6);
    p.addScaledVector(n, h);
    pos.push(p.x, p.y, p.z);
    const [a, b] = uvOf(u, v);
    uv.push(a, b);
    // Darken toward the edge so neighbouring muscles read as separate bellies.
    const shade = 0.72 + 0.28 * Math.pow(1 - s * s, 0.35);
    col.push(shade, shade, shade);
  };

  push(c.x, c.y, 0);
  for (let k = 1; k <= RINGS; k++) {
    const s = k / RINGS;
    for (const p of ring) push(c.x + (p.x - c.x) * s, c.y + (p.y - c.y) * s, s);
  }

  const idx: number[] = [];
  const at = (k: number, j: number) => (k === 0 ? 0 : 1 + (k - 1) * N + (j % N));
  for (let j = 0; j < N; j++) idx.push(0, at(1, j), at(1, j + 1));
  for (let k = 1; k < RINGS; k++) {
    for (let j = 0; j < N; j++) {
      const a = at(k, j), b = at(k, j + 1), cc = at(k + 1, j), d = at(k + 1, j + 1);
      idx.push(a, cc, b, b, cc, d);
    }
  }

  // Orient triangles outward whatever the outline's winding was.
  const P = (i: number) => new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  let flip = 0;
  for (let j = 0; j < N; j += 6) {
    const fn = P(at(1, j)).sub(P(0)).cross(P(at(1, j + 1)).sub(P(0)));
    flip += Math.sign(fn.dot(surfaceNormal(surf, c.x, c.y)));
  }
  if (flip < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function surfaceNormal(surf: Surface, u: number, v: number): Vector3 {
  const e = 1e-3;
  const pu = surf.p(u + e, v).sub(surf.p(u - e, v));
  const pv = surf.p(u, v + e).sub(surf.p(u, v - e));
  const n = pu.cross(pv).normalize();
  if (n.dot(surf.out(u, v)) < 0) n.negate();
  return n;
}

/* ------------------------------------------------------------------ surfaces */

export const TORSO_PROFILE: [number, number][] = [
  [0.0, 0.9], [0.125, 0.905], [0.14, 0.97], [0.132, 1.08], [0.148, 1.2], [0.168, 1.31], [0.174, 1.39], [0.15, 1.465], [0.075, 1.515], [0.0, 1.53],
];

function torsoR(y: number): number {
  const pts = TORSO_PROFILE;
  if (y <= pts[1][1]) return pts[1][0];
  for (let i = 2; i < pts.length; i++) {
    const [r1, y1] = pts[i];
    if (y <= y1) {
      const [r0, y0] = pts[i - 1];
      return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    }
  }
  return 0;
}

/** Front of the torso: u = angle from the sternum toward +X. Back: u = angle from the spine toward +X. */
export function torsoSurface(w: number, back: boolean): Surface {
  const a = 1.15 * w;
  const b = 0.68 * w;
  const th = (u: number) => (back ? Math.PI - u : u);
  return {
    p: (u, y) => {
      const r = torsoR(y);
      return new Vector3(a * r * Math.sin(th(u)), y, b * r * Math.cos(th(u)));
    },
    out: (u, y) => new Vector3(Math.sin(th(u)), y > 1.46 ? 1.5 * (y - 1.46) / 0.07 : 0, Math.cos(th(u))),
    metric: 0.16 * w,
  };
}

function upperArmR(y: number, L1: number): number {
  if (y >= -0.02) return Math.sqrt(Math.max(0, 0.056 * 0.056 - y * y));
  const top = Math.sqrt(0.056 * 0.056 - 0.02 * 0.02);
  if (y >= -0.075) {
    const t = (y + 0.02) / -0.055;
    const s = t * t * (3 - 2 * t);
    return top + (0.041 - top) * s;
  }
  const lo = -L1 + 0.035;
  if (y >= lo) return 0.041;
  const t = Math.min(1, (lo - y) / 0.035);
  return 0.041 - 0.005 * t;
}

/** Upper arm in the shoulder-joint frame (built for the +X arm): u = angle from the front toward lateral, v = height. */
export function upperArmSurface(L1: number): Surface {
  return {
    p: (u, y) => {
      const R = upperArmR(y, L1);
      return new Vector3(R * Math.sin(u), y, R * Math.cos(u));
    },
    out: (u, y) => (y > -0.02 ? new Vector3(Math.sin(u), y / 0.05, Math.cos(u)) : new Vector3(Math.sin(u), 0, Math.cos(u))),
    metric: 0.045,
  };
}

export function forearmSurface(L2: number): Surface {
  return {
    p: (u, y) => {
      const t = Math.min(1, Math.max(0, -y / L2));
      const R = 0.0335 + 0.006 * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - t);
      return new Vector3(R * Math.sin(u), y, R * Math.cos(u));
    },
    out: (u) => new Vector3(Math.sin(u), 0, Math.cos(u)),
    metric: 0.034,
  };
}

/* ------------------------------------------------------------------ muscles */

export type Region = 'front' | 'back' | 'upper' | 'fore';

export interface MuscleSpec extends PatchSpec {
  id: MuscleId;
  region: Region;
}

const PI = Math.PI;

/** Outlines for the +X half of the body; the other half is mirrored. */
export function muscleSpecs(mf: number, L1: number, L2: number): MuscleSpec[] {
  const t = (x: number) => x * mf;
  const specs: MuscleSpec[] = [
    {
      id: 'pecs', region: 'front', thick: t(0.022), base: 0.003,
      outline: [[0.03, 1.445], [0.3, 1.455], [0.6, 1.455], [0.86, 1.44], [1.04, 1.405], [1.16, 1.37], [1.08, 1.33], [0.88, 1.29], [0.58, 1.262], [0.28, 1.258], [0.04, 1.27]],
      center: [0.5, 1.36],
      fibers: { kind: 'fan', origin: [1.3, 1.38] },
    },
    ...[0, 1, 2, 3].map((i): MuscleSpec => {
      const yc = 1.305 - 0.036 * i;
      const x0 = 1.0 + 0.03 * i;
      return {
        id: 'serratus', region: 'front', thick: t(0.0065), base: 0.002,
        outline: [[x0, yc - 0.004], [x0 + 0.08, yc + 0.012], [1.4, yc + 0.028], [1.46, yc + 0.012], [1.4, yc - 0.012], [x0 + 0.12, yc - 0.018], [x0 + 0.02, yc - 0.014]],
        fibers: { kind: 'parallel', angle: 0.35 },
      };
    }),
    ...[
      [1.238, 1.178], [1.166, 1.108], [1.096, 1.036], [1.024, 0.93],
    ].map(([top, bot], i): MuscleSpec => {
      const wb = i === 3 ? 0.2 : 0.27;
      return {
        id: 'abs', region: 'front', thick: t(0.0085), base: 0.0025,
        outline: [[0.028, top], [0.15, top + 0.003], [0.27, top - 0.002], [0.28, (top + bot) / 2], [wb, bot + 0.004], [0.15, bot], [0.028, bot + 0.002], [0.024, (top + bot) / 2]],
        fibers: { kind: 'parallel', angle: PI / 2 },
      };
    }),
    {
      id: 'obliques', region: 'front', thick: t(0.009), base: 0.002,
      outline: [[0.34, 1.2], [0.7, 1.215], [1.05, 1.205], [1.38, 1.16], [1.52, 1.03], [1.38, 0.945], [1.0, 0.925], [0.6, 0.935], [0.33, 0.97], [0.3, 1.08]],
      fibers: { kind: 'parallel', angle: -2.3 },
    },
    {
      id: 'traps', region: 'back', thick: t(0.012), base: 0.003,
      outline: [[0.0, 1.522], [0.28, 1.512], [0.62, 1.495], [0.98, 1.468], [1.24, 1.448], [1.08, 1.422], [0.66, 1.405], [0.4, 1.37], [0.26, 1.28], [0.12, 1.17], [0.0, 1.145]],
      center: [0.32, 1.42],
      fibers: { kind: 'fan', origin: [1.35, 1.452] },
    },
    {
      id: 'rhomboids', region: 'back', thick: t(0.006), base: 0.0018,
      outline: [[0.36, 1.37], [0.56, 1.392], [0.74, 1.372], [0.7, 1.31], [0.54, 1.262], [0.36, 1.262], [0.3, 1.3]],
      fibers: { kind: 'parallel', angle: -0.55 },
    },
    {
      id: 'lats', region: 'back', thick: t(0.013), base: 0.0024,
      outline: [[0.26, 1.215], [0.17, 1.06], [0.2, 0.96], [0.6, 0.952], [1.05, 0.975], [1.42, 1.08], [1.6, 1.22], [1.66, 1.34], [1.5, 1.375], [1.16, 1.325], [0.76, 1.272], [0.42, 1.245]],
      center: [0.85, 1.13],
      fibers: { kind: 'fan', origin: [1.75, 1.37] },
    },
    {
      id: 'erectors', region: 'back', thick: t(0.011), base: 0.0028,
      outline: [[0.03, 1.18], [0.1, 1.185], [0.16, 1.13], [0.17, 1.02], [0.15, 0.93], [0.08, 0.91], [0.03, 0.925], [0.025, 1.05]],
      fibers: { kind: 'parallel', angle: PI / 2 },
    },
    {
      id: 'delt_front', region: 'upper', thick: t(0.013), base: 0.004,
      outline: [[-0.5, 0.028], [0.15, 0.046], [0.78, 0.049], [0.98, 0.0], [1.26, -0.07], [1.5, -0.112], [1.12, -0.09], [0.42, -0.052], [-0.28, -0.012]],
      center: [0.42, 0.005],
      fibers: { kind: 'fan', origin: [PI / 2, -0.135] },
    },
    {
      id: 'delt_side', region: 'upper', thick: t(0.014), base: 0.004,
      outline: [[0.84, 0.051], [1.57, 0.054], [2.3, 0.051], [2.14, 0.0], [1.82, -0.07], [1.57, -0.12], [1.32, -0.07], [1.0, 0.0]],
      fibers: { kind: 'fan', origin: [PI / 2, -0.135] },
    },
    {
      id: 'delt_rear', region: 'upper', thick: t(0.012), base: 0.004,
      outline: [[2.36, 0.049], [3.0, 0.046], [3.62, 0.03], [3.78, -0.01], [3.2, -0.052], [2.42, -0.09], [1.66, -0.113], [1.92, -0.07], [2.2, 0.0]],
      center: [2.7, 0.005],
      fibers: { kind: 'fan', origin: [PI / 2, -0.135] },
    },
    {
      id: 'biceps', region: 'upper', thick: t(0.015), base: 0.002,
      outline: [[-0.25, -0.07], [0.3, -0.075], [0.75, -0.12], [0.9, -0.5 * L1], [0.7, -L1 + 0.06], [0.25, -L1 + 0.025], [-0.25, -L1 + 0.03], [-0.65, -L1 + 0.07], [-0.85, -0.5 * L1], [-0.7, -0.12]],
      center: [0.0, -0.55 * L1],
      fibers: { kind: 'parallel', angle: PI / 2 },
    },
    {
      id: 'triceps', region: 'upper', thick: t(0.014), base: 0.002,
      outline: [[2.15, -0.1], [2.75, -0.085], [3.4, -0.095], [3.95, -0.14], [4.15, -0.45 * L1], [3.85, -0.82 * L1], [3.2, -0.94 * L1], [2.6, -0.82 * L1], [2.0, -0.5 * L1], [1.95, -0.2]],
      center: [3.05, -0.45 * L1],
      fibers: { kind: 'parallel', angle: PI / 2 },
    },
    {
      id: 'forearms', region: 'fore', thick: t(0.009), base: 0.0018,
      outline: [[-0.95, -0.015], [0.0, -0.01], [0.9, -0.02], [1.05, -0.3 * L2], [0.6, -0.72 * L2], [0.15, -0.86 * L2], [-0.35, -0.8 * L2], [-0.9, -0.4 * L2]],
      center: [0.0, -0.3 * L2],
      fibers: { kind: 'parallel', angle: 1.45 },
    },
    {
      id: 'forearms', region: 'fore', thick: t(0.008), base: 0.0018,
      outline: [[1.25, -0.012], [2.2, -0.008], [3.2, -0.015], [3.55, -0.3 * L2], [3.15, -0.78 * L2], [2.6, -0.88 * L2], [2.0, -0.75 * L2], [1.35, -0.4 * L2]],
      center: [2.35, -0.3 * L2],
      fibers: { kind: 'parallel', angle: 1.65 },
    },
  ];
  return specs;
}

/* ------------------------------------------------------------------ texture */

let fiberTex: CanvasTexture | null = null;

/** Fine longitudinal striation used as both colour map and bump map; muscle colour comes from the material. */
export function fiberTexture(): CanvasTexture {
  if (fiberTex) return fiberTex;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const STRIPES = 9;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const jitter = Array.from({ length: S }, () => rnd());
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const ph = (x / S) * STRIPES * 2 * Math.PI + 0.35 * Math.sin((y / S) * 2 * Math.PI * 3 + Math.floor((x / S) * STRIPES));
      const groove = Math.pow(0.5 + 0.5 * Math.cos(ph), 3);
      const v = 255 * (0.8 + 0.2 * (1 - groove) - 0.05 * jitter[(x * 7 + y) % S]);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  fiberTex = new CanvasTexture(cv);
  fiberTex.wrapS = fiberTex.wrapT = RepeatWrapping;
  fiberTex.colorSpace = SRGBColorSpace;
  fiberTex.anisotropy = 4;
  return fiberTex;
}

/* ------------------------------------------------------------------ electrodes */

export interface PadPlacement {
  no: string;
  region: Region | 'neck';
  u: number;
  v: number;
  lift: number;
  /** Rotation of the electrode pair around the surface normal (0 = pair runs vertically). */
  rot: number;
}

export function padPlacements(mf: number, L1: number): PadPlacement[] {
  const t = (x: number) => x * mf;
  return [
    { no: '01', region: 'upper', u: 0.35, v: -0.03, lift: t(0.012) + 0.007, rot: 0 },
    { no: '02', region: 'upper', u: PI / 2, v: -0.035, lift: t(0.013) + 0.007, rot: 0 },
    { no: '03', region: 'upper', u: 2.8, v: -0.03, lift: t(0.011) + 0.007, rot: 0 },
    { no: '04', region: 'upper', u: 0.0, v: -0.56 * L1, lift: t(0.015) + 0.005, rot: 0 },
    { no: '05', region: 'upper', u: 3.1, v: -0.42 * L1, lift: t(0.014) + 0.005, rot: 0 },
    { no: '06', region: 'front', u: 0.48, v: 1.415, lift: t(0.019) + 0.006, rot: 1.2 },
    { no: '07', region: 'back', u: 0.62, v: 1.49, lift: t(0.008) + 0.006, rot: 1.25 },
    { no: '08', region: 'back', u: 0.38, v: 1.39, lift: t(0.011) + 0.006, rot: 1.45 },
    { no: '09', region: 'back', u: 0.2, v: 1.255, lift: t(0.008) + 0.006, rot: 0.45 },
    { no: '10', region: 'back', u: 1.15, v: 1.16, lift: t(0.012) + 0.006, rot: 0.55 },
    { no: '11', region: 'front', u: 1.26, v: 1.24, lift: t(0.006) + 0.006, rot: -1.1 },
    { no: '12', region: 'front', u: 0.15, v: 1.135, lift: t(0.0085) + 0.006, rot: 0 },
    { no: '13', region: 'front', u: 0.95, v: 1.06, lift: t(0.009) + 0.006, rot: -0.75 },
    { no: '14', region: 'back', u: 0.095, v: 1.0, lift: t(0.011) + 0.006, rot: 0 },
  ];
}

/** Position and orientation of a pad on a surface, optionally mirrored to the -X side. */
export function padTransform(surf: Surface, u: number, v: number, lift: number, rot: number, mirror: boolean): { position: Vector3; quaternion: Quaternion } {
  const p = surf.p(u, v);
  const n = surfaceNormal(surf, u, v);
  p.addScaledVector(n, lift);
  if (mirror) {
    p.x = -p.x;
    n.x = -n.x;
  }
  const up = Math.abs(n.y) > 0.95 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
  const x = new Vector3().crossVectors(up, n).normalize();
  const y = new Vector3().crossVectors(n, x).normalize();
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, n));
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), mirror ? -rot : rot));
  return { position: p, quaternion: q };
}

const padCache = new Map<string, CanvasTexture>();

/** Vest-style electrode: grey textile pair on white knit with the region number. */
export function padTexture(label: string, dark: boolean): CanvasTexture {
  const key = `${label}:${dark ? 'd' : 'l'}`;
  const hit = padCache.get(key);
  if (hit) return hit;
  const ref = label === 'REF';
  const W = ref ? 128 : 96;
  const H = ref ? 128 : 176;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const knit = dark ? '#3a3532' : '#F7F7F5';
  const pad = dark ? '#8b8580' : '#9A9A98';
  const padEdge = dark ? '#c9c2bb' : '#6E6E6C';
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  };
  c.clearRect(0, 0, W, H);
  if (ref) {
    c.fillStyle = knit;
    c.beginPath();
    c.arc(64, 64, 60, 0, 2 * PI);
    c.fill();
    c.strokeStyle = '#C24C30';
    c.lineWidth = 6;
    c.stroke();
    c.fillStyle = pad;
    c.beginPath();
    c.arc(64, 64, 30, 0, 2 * PI);
    c.fill();
    c.fillStyle = '#ffffff';
    c.font = '700 26px Inter, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('REF', 64, 66);
  } else {
    rr(4, 4, W - 8, H - 8, 28);
    c.fillStyle = knit;
    c.fill();
    c.strokeStyle = dark ? '#5a524c' : '#D0D0D0';
    c.lineWidth = 3;
    c.stroke();
    for (const cy of [38, H - 38]) {
      c.beginPath();
      c.ellipse(W / 2, cy, 28, 24, 0, 0, 2 * PI);
      c.fillStyle = pad;
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = padEdge;
      c.stroke();
    }
    c.fillStyle = '#C24C30';
    rr(W / 2 - 34, H / 2 - 20, 68, 40, 12);
    c.fill();
    c.fillStyle = '#ffffff';
    c.font = '800 32px Inter, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, W / 2, H / 2 + 1);
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  padCache.set(key, tex);
  return tex;
}
