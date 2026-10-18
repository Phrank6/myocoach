import { useId, useMemo } from 'react';
import { ELECTRODES } from '../domain/electrodes';
import { MUSCLE_INDEX, muscleShort, type MuscleId } from '../domain/muscles';
import { heatCss } from '../three/heat';

/**
 * Front and back anatomy plates for the phone. Only the figure's left half is authored (midline x = 80);
 * the right half is the same paths mirrored. Muscle outlines follow the placement reference; each muscle
 * carries a neutral base, a heat tint, fibre hatching clipped to its outline, belly shading and a hairline edge.
 */

type Fib = { a: number; s?: number } | { o: [number, number]; s?: number };
interface Part {
  m: MuscleId | null;
  d: string;
  f?: Fib;
  deep?: boolean;
}

const SIL =
  'M80,40 L72.5,40 C72,44 70.5,46.5 68,47.5 C60,49.5 52,51 45,53 C36,55.2 29.5,60 27.2,70 C25.8,79 26.8,87 28.8,94 ' +
  'C28,106 27,120 26,134 C24.2,150 21.6,170 19.6,188 C18.6,195 16.2,201 16.8,207 C17.6,213 23.6,214.5 26.8,210.4 ' +
  'C28,204.6 27.2,198 28.2,192 C30.2,174 33,156 36,140 C38,128 40,114 42.2,100 L44.4,99.6 C46,112 47.4,124 49,138 ' +
  'C50.8,150 53,160 53.4,168 C52.6,178 51.4,188 52,206 L80,206 Z';
const HEAD = 'M80,4 C88.5,4 93.5,11 93.5,20 C93.5,28 90,35.5 84,38.5 L80,39.5 L76,38.5 C70,35.5 66.5,28 66.5,20 C66.5,11 71.5,4 80,4 Z';

const absSeg = (t: number, b: number, xt: number, xb: number) =>
  `M78.6,${t + 0.6} C75,${t - 0.3} 71,${t - 0.1} ${xt},${t + 1.2} C${xt - 0.9},${t + (b - t) * 0.35} ${xb - 0.9},${t + (b - t) * 0.65} ${xb},${b - 1} ` +
  `C71,${b + 0.2} 75,${b + 0.4} 78.6,${b - 0.3} Z`;

const slip = (i: number) => {
  const y = 86.5 + 6.6 * i;
  const x = 46.2 + 0.35 * i;
  return `M${x},${y} C${x + 3},${y - 1.6} ${x + 7},${y - 0.6} ${x + 10},${y + 1.8} C${x + 7},${y + 4.4} ${x + 3},${y + 5.2} ${x + 0.4},${y + 4.8} Z`;
};

const FOREARM = 'M25,138.5 C22.4,148 20.4,160 19.4,174 C19,182 19.2,188 20,192.5 L26.6,193 C27.4,184 29,172 31,160 C32.8,152 34.8,145 36.2,139 C32.4,136.4 28.4,136.4 25,138.5 Z';
const MID_DELT = 'M36.2,56.8 C31.6,58.8 28.6,63 27.6,70 C26.6,78 27.6,87 30.8,94.6 C31.4,86 32,76 33,68 C33.8,63 34.8,59.6 36.2,56.8 Z';

const FRONT: Part[] = [
  { m: 'traps', d: 'M71.2,44.6 C66,47 58,49.2 50.5,51.6 C57,52.4 63.5,52.4 69.2,51 C70.6,49 71.2,47 71.2,44.6 Z', f: { a: 160 } },
  { m: 'delt_side', d: MID_DELT, f: { o: [31, 96] } },
  { m: 'delt_front', d: 'M48.2,54.4 C43.6,54.2 39.6,55 36.2,56.8 C34.4,63.6 33.2,73.6 32.4,84 C32,88 31.4,91.4 30.8,94.6 C34.6,89 38.4,82 41.4,74 C44,66.6 46.2,60 48.2,54.4 Z', f: { o: [31, 96] } },
  { m: 'pecs', d: 'M78.4,55.6 C70,53.8 58.6,54 49.2,55.8 C46.4,62 44.2,68.4 42.4,75 C43.4,79 45.2,82.4 47.4,85.4 C55.6,91.4 66.4,93.4 78.4,91.4 Z', f: { o: [41.2, 75.4], s: 1.35 } },
  { m: 'biceps', d: 'M37.2,94.2 C32.6,98 30.4,106 30.4,114 C30.4,122 32,129.6 34.2,136 C36.4,129.6 39.2,122 39.4,114 C39.6,106 39.2,99 37.2,94.2 Z', f: { a: 92 } },
  { m: null, d: 'M30.6,96 C29,104 28.2,114 28.6,124 C29.2,130 31,134 33.4,136.6 C31.6,129 30.2,122 30.2,114 C30.2,107 30.4,100.6 30.6,96 Z', f: { a: 95 } },
  { m: 'forearms', d: FOREARM, f: { a: 104 } },
  { m: 'lats', d: 'M44.6,99.8 C47.4,100.6 49.6,103 50.6,107 C50,120 50.2,132 51.6,144 C49.4,134 47.6,120 44.6,99.8 Z', f: { a: 78 } },
  ...[0, 1, 2, 3].map((i): Part => ({ m: 'serratus', d: slip(i), f: { a: 18 } })),
  { m: 'obliques', d: 'M65.6,103.6 C60.4,101.6 55.4,104.4 51.6,109.8 C50.4,124 50.8,140 52.6,157 C53.6,167 54.6,175 56.4,182 C60.4,178.4 64.2,174.4 66.2,170 C66.4,150 66.4,128 65.6,103.6 Z', f: { a: 52 } },
  { m: 'abs', d: absSeg(93, 106.6, 67.8, 67.2), f: { a: 90, s: 1.3 } },
  { m: 'abs', d: absSeg(108.4, 121.6, 67, 66.6), f: { a: 90, s: 1.3 } },
  { m: 'abs', d: absSeg(123.4, 136.8, 66.6, 66.8), f: { a: 90, s: 1.3 } },
  { m: 'abs', d: absSeg(138.6, 178, 66.8, 73.6), f: { a: 90, s: 1.3 } },
];

const BACK: Part[] = [
  { m: null, d: 'M64.4,67 C60,65.4 53.8,63.8 47,62.4 C45.2,70 45.2,80 47.2,88 C52,91.8 58,93.8 63.4,94 C64.2,86 64.6,76 64.4,67 Z', f: { o: [40, 64], s: 1.6 } },
  { m: null, d: 'M47.4,88.6 C52.4,92.2 58.4,94.6 62.6,95.6 C58.6,99.6 52.4,100.8 45.8,99.2 C46.2,95.4 46.6,92 47.4,88.6 Z', f: { a: 160 } },
  { m: 'erectors', d: 'M79,116 C76,116.2 73.2,120 72.2,128 C71.2,144 71.2,160 72,176 C73.8,182.4 76.8,186.4 79,186.6 Z', f: { a: 92 } },
  { m: 'lats', d: 'M60,97.6 C54,97.2 48.4,97.6 44.6,99 C45.6,110 47.8,126 50,140 C52,154 54,164 56,174.4 C62,172.4 68.2,168 74,162 C72,150 70.2,138 69.2,126 C67.4,116 64.2,106 60,97.6 Z', f: { o: [41.6, 96.4], s: 1.5 } },
  { m: 'traps', d: 'M80,40.5 L80,62 C72,60 62,58.2 52,58 C49,57.4 46.4,56.4 44.4,54.6 C52,51.6 60,48.6 66,46.6 C70,45.4 72.4,42.6 72.8,40.5 Z', f: { o: [46, 58], s: 1.4 } },
  { m: 'traps', d: 'M80,62 L80,90 C74,86 66,80 58.4,72.4 C55.6,67 53.4,61.8 52,58 C62,58.2 72,60 80,62 Z', f: { a: 172 } },
  { m: 'traps', d: 'M80,90 L80,128 C77.2,118 72.4,104 66.4,92.4 C63.4,84.6 60.8,77.6 58.4,72.4 C66,80 74,86 80,90 Z', f: { a: 236 } },
  { m: 'rhomboids', d: 'M79.4,65 L79.4,96.4 C74,94.4 68.4,90.4 64.4,84.6 C62.2,78.4 60.2,72.2 58.6,66.4 C64.6,65.2 72,64.8 79.4,65 Z', deep: true },
  { m: 'delt_side', d: MID_DELT, f: { o: [31, 96] } },
  { m: 'delt_rear', d: 'M46.4,56.4 C42.4,55.4 39,55.8 36.2,56.8 C34.4,63.6 33.2,73.6 32.4,84 C32,88 31.4,91.4 30.8,94.6 C35.4,88.4 40,81.4 43.4,74.4 C45.2,69 46.4,62.6 46.4,56.4 Z', f: { o: [31, 96] } },
  { m: 'triceps', d: 'M30.8,95 C28.6,103 27.6,112 28,121 C28.6,126 30.4,129.2 32.8,130 C33,120 33,107 32.4,96 Z', f: { a: 94 } },
  { m: 'triceps', d: 'M33.4,96 C37.4,103 40,113 39.6,123 C39.2,128 37.2,131 34.6,131.4 C33.6,120 33.2,108 33.4,96 Z', f: { a: 86 } },
  { m: null, d: 'M28.6,126 C30.4,131 32.4,135.6 34.2,138.4 C36.4,135.6 38.4,132 39.4,127 C37.6,130.6 35.4,132.2 33.4,132 C31.2,131.6 29.6,129.4 28.6,126 Z', f: { a: 90 } },
  { m: 'forearms', d: FOREARM, f: { a: 78 } },
];

const FRONT_LINES = [
  'M77.6,52.4 C70,50.6 58,51.2 48.6,53.6',
  'M78.4,64.2 C70,62.4 58,62.6 46.4,66.6',
  'M80,93 L80,180',
  'M56.4,182 C61,186 67,190.6 72.6,196.8',
  'M30.2,140.2 C27,156 24.8,172 23.4,188',
];
const BACK_LINES = ['M80,44 L80,196', 'M66.4,64.6 C60,62.2 53,60.4 46.6,59.6'];

/* ------------------------------------------------------------------ hatching */

function bbox(d: string) {
  const n = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < n.length; i += 2) {
    x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]);
    y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]);
  }
  return { x0, y0, x1, y1 };
}

const f2 = (v: number) => v.toFixed(2);

function hatch(d: string, f: Fib): string {
  const b = bbox(d);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const R = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2 + 1;
  const s = f.s ?? 1.25;
  const out: string[] = [];
  if ('a' in f) {
    const a = (f.a * Math.PI) / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    for (let k = -R; k <= R; k += s) {
      const px = cx - dy * k, py = cy + dx * k;
      out.push(`M${f2(px - dx * R)},${f2(py - dy * R)}L${f2(px + dx * R)},${f2(py + dy * R)}`);
    }
  } else {
    const [ox, oy] = f.o;
    const corners = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]];
    const mid = Math.atan2(cy - oy, cx - ox);
    let lo = Infinity, hi = -Infinity, rMax = 0;
    for (const [x, y] of corners) {
      let t = Math.atan2(y - oy, x - ox) - mid;
      t = Math.atan2(Math.sin(t), Math.cos(t));
      lo = Math.min(lo, t); hi = Math.max(hi, t);
      rMax = Math.max(rMax, Math.hypot(x - ox, y - oy));
    }
    const rMean = Math.max(4, Math.hypot(cx - ox, cy - oy));
    const step = s / rMean;
    for (let t = lo; t <= hi; t += step) {
      const a = mid + t;
      out.push(`M${f2(ox)},${f2(oy)}L${f2(ox + Math.cos(a) * rMax)},${f2(oy + Math.sin(a) * rMax)}`);
    }
  }
  return out.join('');
}

/* ------------------------------------------------------------------ electrodes */

interface Spot { no: string; x: number; y: number; r?: number; tag?: [number, number] }

const FRONT_PADS: Spot[] = [
  { no: '01', x: 39.6, y: 67, r: 22, tag: [8, -5] },
  { no: '02', x: 29.6, y: 75, r: 8, tag: [-7, -3] },
  { no: '04', x: 34.8, y: 114, tag: [-8, 0] },
  { no: '06', x: 61, y: 62, r: 82, tag: [0, -7] },
  { no: '11', x: 50.6, y: 98, r: 72, tag: [-7, 4] },
  { no: '12', x: 72.6, y: 114.6, tag: [-6.5, -6] },
  { no: '13', x: 58.6, y: 141, r: -38, tag: [-7, 5] },
];
const BACK_PADS: Spot[] = [
  { no: '02', x: 29.6, y: 75, r: 8, tag: [-7, -3] },
  { no: '03', x: 39.6, y: 68, r: -22, tag: [8, 3] },
  { no: '05', x: 36.4, y: 112, tag: [-9, 0] },
  { no: '07', x: 62, y: 50.4, r: 64, tag: [-1, -7] },
  { no: '08', x: 68.4, y: 74, r: 84, tag: [-7, 4] },
  { no: '09', x: 73.4, y: 103, r: 24, tag: [-7, 3] },
  { no: '10', x: 57, y: 128, r: 32, tag: [-8, 3] },
  { no: '14', x: 75.6, y: 166, tag: [-7, 0] },
];

function Pad({ s, tag }: { s: Spot; tag: boolean }) {
  return (
    <g className="an-pad">
      <g transform={`translate(${s.x} ${s.y}) rotate(${s.r ?? 0})`}>
        <rect x={-2.9} y={-4.6} width={5.8} height={9.2} rx={2.4} className="an-pad-knit" />
        <circle cy={-2.1} r={1.55} className="an-pad-el" />
        <circle cy={2.1} r={1.55} className="an-pad-el" />
      </g>
      {tag && s.tag && (
        <g transform={`translate(${s.x + s.tag[0]} ${s.y + s.tag[1]})`}>
          <rect x={-4.3} y={-2.9} width={8.6} height={5.8} rx={2.4} className="an-tag" />
          <text y={1.75} textAnchor="middle" className="an-tag-t">{s.no}</text>
        </g>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ figure */

interface Prepared extends Part { hatch: string }
const prep = (parts: Part[]): Prepared[] => parts.map((p) => ({ ...p, hatch: p.f ? hatch(p.d, p.f) : '' }));
const PREP = { front: prep(FRONT), back: prep(BACK) };

function heatOpacity(v: number) {
  const x = Math.min(1, Math.max(0, v / 0.75));
  return 0.14 + 0.78 * x * x * (3 - 2 * x);
}

function Half({ parts, lines, values, uid, mirror }: { parts: Prepared[]; lines: string[]; values: number[]; uid: string; mirror?: boolean }) {
  return (
    <g transform={mirror ? 'matrix(-1 0 0 1 160 0)' : undefined}>
      <path d={SIL} className="an-skin" />
      {parts.map((p, i) => {
        const v = p.m ? Math.min(1, values[MUSCLE_INDEX[p.m]] ?? 0) : 0;
        return (
          <g key={i} className={p.deep ? 'an-deep' : p.m ? 'an-m' : 'an-m an-neutral'}>
            {!p.deep && <path d={p.d} className="an-base" />}
            {p.m && <path d={p.d} fill={heatCss(v)} fillOpacity={p.deep ? 0.75 * heatOpacity(v) : heatOpacity(v)} className="an-heat" />}
            {p.hatch && <path d={p.hatch} clipPath={`url(#${uid}-c${i})`} className="an-fiber" />}
            {!p.deep && <path d={p.d} fill={`url(#${uid}-shade)`} />}
            <path d={p.d} className="an-edge" />
          </g>
        );
      })}
      {lines.map((d) => <path key={d} d={d} className="an-line" />)}
      <path d={SIL} className="an-outline" />
    </g>
  );
}

function Plate({ side, values, electrodes }: { side: 'front' | 'back'; values: number[]; electrodes: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, '') + side;
  const parts = PREP[side];
  const pads = side === 'front' ? FRONT_PADS : BACK_PADS;
  const label = side === 'front' ? 'Front' : 'Back';
  return (
    <figure className="fig">
      <svg viewBox="8 2 144 214" role="img" aria-label={`${label} muscle map`}>
        <defs>
          <radialGradient id={`${uid}-shade`} cx="0.42" cy="0.36" r="0.75">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.32" />
            <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="1" stopColor="#3a1a10" stopOpacity="0.26" />
          </radialGradient>
          {parts.map((p, i) => (
            <clipPath key={i} id={`${uid}-c${i}`}><path d={p.d} /></clipPath>
          ))}
        </defs>
        <path d={HEAD} className="an-skin an-head" />
        <Half parts={parts} lines={side === 'front' ? FRONT_LINES : BACK_LINES} values={values} uid={uid} />
        <Half parts={parts} lines={side === 'front' ? FRONT_LINES : BACK_LINES} values={values} uid={uid} mirror />
        {side === 'front' && <ellipse cx="80" cy="150" rx="1.3" ry="1.9" className="an-navel" />}
        {electrodes && (
          <g>
            {pads.map((s) => <Pad key={`l${s.no}`} s={s} tag />)}
            {pads.map((s) => <Pad key={`r${s.no}`} s={{ ...s, x: 160 - s.x, r: -(s.r ?? 0) }} tag={false} />)}
            {side === 'back' && (
              <g className="an-pad">
                <circle cx="80" cy="44" r="3.6" className="an-pad-knit an-ref" />
                <circle cx="80" cy="44" r="1.8" className="an-pad-el" />
                <g transform="translate(80 34.6)">
                  <rect x={-6} y={-2.9} width={12} height={5.8} rx={2.4} className="an-tag" />
                  <text y={1.75} textAnchor="middle" className="an-tag-t">REF</text>
                </g>
              </g>
            )}
          </g>
        )}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function AnatomyMap({ values, electrodes }: { values: number[]; electrodes: boolean }) {
  const legend = useMemo(() => ELECTRODES.map((e) => ({ k: e.no, t: `${e.no} ${e.short ?? e.name}`, ch: muscleShort(e.channel) })), []);
  return (
    <div className="map2d-wrap">
      <div className="map2d">
        <Plate side="front" values={values} electrodes={electrodes} />
        <Plate side="back" values={values} electrodes={electrodes} />
      </div>
      {electrodes && (
        <ol className="an-legend" aria-label="Electrode regions">
          {legend.map((l) => <li key={l.k}>{l.t} <span className="an-ch">{l.ch}</span></li>)}
          <li>REF · C7 <span className="an-ch">ground</span></li>
        </ol>
      )}
    </div>
  );
}
