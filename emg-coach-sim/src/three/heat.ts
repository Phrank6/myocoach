import { Color } from 'three';

const STOPS: [number, string][] = [
  [0, '#2B2B2B'],
  [0.16, '#8C2F2B'],
  [0.4, '#C24C30'],
  [0.66, '#E66A32'],
  [0.84, '#FF8C42'],
  [1, '#FFD9A0'],
];
const COLORS = STOPS.map(([t, c]) => [t, new Color(c)] as const);

export function heatColor(v: number, out = new Color()): Color {
  const x = Math.min(1, Math.max(0, v));
  for (let i = 1; i < COLORS.length; i++) {
    const [t1, c1] = COLORS[i];
    if (x <= t1) {
      const [t0, c0] = COLORS[i - 1];
      return out.copy(c0).lerp(c1, (x - t0) / (t1 - t0));
    }
  }
  return out.copy(COLORS[COLORS.length - 1][1]);
}

export function heatCss(v: number): string {
  return `#${heatColor(v).getHexString()}`;
}

export const HEAT_GRADIENT_CSS = `linear-gradient(90deg, ${STOPS.map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`;
