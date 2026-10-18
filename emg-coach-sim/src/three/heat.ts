import type { Color } from 'three';

/** Magma-like ramp: graphite (untrained) → indigo → plum → rose → ember → amber → pale gold. */
const STOPS: [number, string][] = [
  [0, '#2c2e37'],
  [0.15, '#3b3168'],
  [0.35, '#7a3183'],
  [0.55, '#c9406a'],
  [0.72, '#f06a42'],
  [0.88, '#fb9f45'],
  [1, '#ffd27a'],
];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const RGB = STOPS.map(([t, c]) => [t, hex(c)] as const);

export function heatRgb(v: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  for (let i = 1; i < RGB.length; i++) {
    const [t1, c1] = RGB[i];
    if (x <= t1) {
      const [t0, c0] = RGB[i - 1];
      const k = (x - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  const last = RGB[RGB.length - 1][1];
  return [last[0], last[1], last[2]];
}

/** Writes the ramp colour into a three.js Color (sRGB input). */
export function heatColor(v: number, out: Color): Color {
  const [r, g, b] = heatRgb(v);
  return out.setRGB(r, g, b, 'srgb');
}

export function heatCss(v: number): string {
  const [r, g, b] = heatRgb(v);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

export const HEAT_GRADIENT_CSS = `linear-gradient(90deg, ${STOPS.map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`;
