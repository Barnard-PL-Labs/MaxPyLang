// The live picture of the sound: waveform (oscilloscope) over a faint spectrum.
// This is where Hydra's reference shows its moving image.

import { analyser } from './player';

const time = new Float32Array(2048);
const freq = new Uint8Array(1024);

export function mountScope(canvas: HTMLCanvasElement, color: () => string, active: () => boolean): () => void {
  const g = canvas.getContext('2d')!;
  let frame = 0;
  let stopped = false;

  const draw = () => {
    if (stopped) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#141414';
    g.fillRect(0, 0, w, h);

    const a = analyser();
    if (a && active()) {
      // spectrum: low frequencies on the left, on a log-ish scale
      a.getByteFrequencyData(freq);
      g.fillStyle = color() + '55';
      const bars = 96;
      for (let i = 0; i < bars; i++) {
        const bin = Math.floor(Math.pow(i / bars, 2) * (freq.length - 1));
        const v = freq[bin] / 255;
        const x = (i / bars) * w;
        g.fillRect(x, h - v * h, w / bars - 1, v * h);
      }
      // waveform, started at an upward zero crossing so it stands still
      a.getFloatTimeDomainData(time);
      let start = 0;
      for (let i = 1; i < time.length / 2; i++) {
        if (time[i - 1] < 0 && time[i] >= 0) { start = i; break; }
      }
      const n = Math.min(1024, time.length - start);
      // Scale quiet sounds up so their shape is visible; the spectrum shows true level.
      let peak = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(time[start + i]));
      const gain = 0.9 / Math.max(peak, 0.05);
      g.strokeStyle = color();
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w;
        const y = h / 2 - time[start + i] * gain * (h / 2);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    } else {
      g.strokeStyle = '#3a3a3a';
      g.beginPath();
      g.moveTo(0, h / 2);
      g.lineTo(w, h / 2);
      g.stroke();
      g.fillStyle = '#8a8a8a';
      g.font = '14px ui-monospace, Menlo, monospace';
      g.textAlign = 'center';
      g.fillText('press ▶ to hear it', w / 2, h / 2 - 12);
    }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
}
