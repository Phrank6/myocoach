import { useEffect, useRef } from 'react';
import { MUSCLE_IDS, N_MUSCLES, muscleShort } from '../domain/muscles';
import type { WorkoutEngine } from '../engine/WorkoutEngine';
import { HIGH_ACT } from '../engine/risk';
import { heatCss } from '../three/heat';

/** Scrolling per-channel trace of processed EMG activation (last 5 s). */
export function EmgScope({ engine }: { engine: WorkoutEngine }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = ref.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const W = c.clientWidth;
        const H = c.clientHeight;
        if (c.width !== W * dpr) {
          c.width = W * dpr;
          c.height = H * dpr;
        }
        const g = c.getContext('2d')!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        const len = engine.scope.length / N_MUSCLES;
        const rowH = H / N_MUSCLES;
        const labelW = 46;
        g.font = '500 10px "JetBrains Mono Variable", ui-monospace, monospace';
        for (let ch = 0; ch < N_MUSCLES; ch++) {
          const y0 = ch * rowH;
          g.fillStyle = 'rgba(255,255,255,0.05)';
          g.fillRect(labelW, y0 + rowH - 1, W - labelW, 1);
          g.strokeStyle = 'rgba(255,255,255,0.09)';
          g.setLineDash([1, 4]);
          g.beginPath();
          const yHigh = y0 + rowH - HIGH_ACT * (rowH - 2);
          g.moveTo(labelW, yHigh);
          g.lineTo(W, yHigh);
          g.stroke();
          g.setLineDash([]);
          const latest = engine.scope[((engine.scopeHead - 1 + len) % len) * N_MUSCLES + ch];
          g.strokeStyle = heatCss(0.3 + Math.min(0.7, latest));
          g.lineWidth = 1.25;
          g.beginPath();
          for (let k = 0; k < len; k++) {
            const idx = ((engine.scopeHead + k) % len) * N_MUSCLES + ch;
            const v = Math.min(1.1, engine.scope[idx]);
            const x = labelW + (k / (len - 1)) * (W - labelW);
            const y = y0 + rowH - 1 - v * (rowH - 2);
            if (k) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
          g.stroke();
          g.fillStyle = '#6c707a';
          g.fillText(muscleShort(MUSCLE_IDS[ch]), 4, y0 + rowH / 2 + 3);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);
  return <canvas ref={ref} className="scope" />;
}
