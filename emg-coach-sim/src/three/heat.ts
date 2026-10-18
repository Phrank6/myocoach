import { Color } from 'three';

type Stops = [number, string][];

/** Eason's warm scale on white: rest is pale peach, the most-worked muscle reads as near-black ink. */
const LIGHT: Stops = [
  [0, '#FFD9A0'],
  [0.16, '#FF8C42'],
  [0.4, '#E66A32'],
  [0.66, '#C24C30'],
  [0.84, '#8C2F2B'],
  [1, '#2B2B2B'],
];

/** The same palette run the other way for dark mode, so the most-worked muscle is the brightest thing on screen. */
const DARK: Stops = [
  [0, '#4a3f37'],
  [0.16, '#8C2F2B'],
  [0.4, '#C24C30'],
  [0.66, '#E66A32'],
  [0.84, '#FF8C42'],
  [1, '#FFD9A0'],
];

const toColors = (s: Stops) => s.map(([t, c]) => [t, new Color(c)] as const);
const RAMPS = { light: { stops: LIGHT, colors: toColors(LIGHT) }, dark: { stops: DARK, colors: toColors(DARK) } };
let ramp = RAMPS.light;

export function setHeatTheme(t: 'light' | 'dark') {
  ramp = RAMPS[t];
}

export function heatColor(v: number, out = new Color()): Color {
  const COLORS = ramp.colors;
  const x = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
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

export function heatGradientCss(): string {
  return `linear-gradient(90deg, ${ramp.stops.map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`;
}
