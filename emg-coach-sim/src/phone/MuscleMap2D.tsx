import { MUSCLE_INDEX, type MuscleId } from '../domain/muscles';
import { heatCss } from '../three/heat';

type Shape = { m: MuscleId; d?: string; e?: [number, number, number, number, number?] };

const SKIN = '#1d1f25';
const TORSO = 'M72,46 Q100,38 128,46 L142,60 L134,104 L128,152 L72,152 L66,104 L58,60 Z';
const ARM_L = 'M58,58 Q46,62 46,80 L42,118 L38,150 L50,152 L56,120 L62,86 Z';
const ARM_R = 'M142,58 Q154,62 154,80 L158,118 L162,150 L150,152 L144,120 L138,86 Z';

const FRONT: Shape[] = [
  { m: 'traps', d: 'M90,38 L74,48 L90,50 Z' },
  { m: 'traps', d: 'M110,38 L126,48 L110,50 Z' },
  { m: 'delt_side', e: [53, 63, 7, 12, -12] },
  { m: 'delt_side', e: [147, 63, 7, 12, 12] },
  { m: 'delt_front', e: [63, 60, 9, 12, 8] },
  { m: 'delt_front', e: [137, 60, 9, 12, -8] },
  { m: 'pecs', e: [86, 70, 15, 11, 6] },
  { m: 'pecs', e: [114, 70, 15, 11, -6] },
  { m: 'biceps', e: [52, 92, 6.5, 15, 6] },
  { m: 'biceps', e: [148, 92, 6.5, 15, -6] },
  { m: 'forearms', e: [46, 128, 6, 17, 5] },
  { m: 'forearms', e: [154, 128, 6, 17, -5] },
];
const BACK: Shape[] = [
  { m: 'traps', d: 'M100,36 L76,50 L92,58 L100,98 L108,58 L124,50 Z' },
  { m: 'delt_rear', e: [61, 61, 10, 12, 8] },
  { m: 'delt_rear', e: [139, 61, 10, 12, -8] },
  { m: 'rhomboids', e: [90, 74, 6.5, 11, 8] },
  { m: 'rhomboids', e: [110, 74, 6.5, 11, -8] },
  { m: 'lats', d: 'M74,78 Q66,108 82,136 L96,112 L88,84 Z' },
  { m: 'lats', d: 'M126,78 Q134,108 118,136 L104,112 L112,84 Z' },
  { m: 'triceps', e: [52, 92, 7, 16, 6] },
  { m: 'triceps', e: [148, 92, 7, 16, -6] },
  { m: 'forearms', e: [46, 128, 6, 17, 5] },
  { m: 'forearms', e: [154, 128, 6, 17, -5] },
];

function Figure({ shapes, values, label }: { shapes: Shape[]; values: number[]; label: string }) {
  return (
    <figure className="fig">
      <svg viewBox="30 4 140 156" role="img" aria-label={`${label} muscle map`}>
        <circle cx="100" cy="20" r="12" fill={SKIN} />
        <rect x="93" y="30" width="14" height="12" rx="4" fill={SKIN} />
        <path d={ARM_L} fill={SKIN} />
        <path d={ARM_R} fill={SKIN} />
        <path d={TORSO} fill={SKIN} />
        {shapes.map((s, i) => {
          const v = Math.min(1, values[MUSCLE_INDEX[s.m]] ?? 0);
          const fill = heatCss(v);
          const style = { transition: 'fill 120ms linear', filter: v > 0.55 ? `drop-shadow(0 0 ${2 + v * 4}px ${fill})` : undefined };
          return s.d ? (
            <path key={i} d={s.d} fill={fill} style={style} />
          ) : (
            <ellipse key={i} cx={s.e![0]} cy={s.e![1]} rx={s.e![2]} ry={s.e![3]} transform={`rotate(${s.e![4] ?? 0} ${s.e![0]} ${s.e![1]})`} fill={fill} style={style} />
          );
        })}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function MuscleMap2D({ values }: { values: number[] }) {
  return (
    <div className="map2d">
      <Figure shapes={FRONT} values={values} label="Front" />
      <Figure shapes={BACK} values={values} label="Back" />
    </div>
  );
}
