// live.gain~ : Max for Live's stereo gain fader, with meters.
//
// Per Max's reference page: two signal inlets (a number into the left one sets the level
// in dB), and five outlets — the two scaled signals, the level in dB, the level as a raw
// 0..1 position, and the amplitude of both channels in dB. The range is
// parameter_mmin..parameter_mmax (default −70..6), and the bottom of the range means
// OFF, not −70 dB: a live.gain~ pulled all the way down is silent.
//
// Its starting level is saved in the box, not the text — under
// `saved_attribute_attributes.valueof`, as `parameter_initial` guarded by
// `parameter_initial_enable` — so it is read from the raw box dict. Patches built for
// Live commonly start at the bottom (−70, silent) and expect the fader to be raised by
// hand, and that is what happens here too: the widget is a real fader.
//
// Messages: a number sets the level and outputs it; bang / outputvalue re-output; set
// stores without output; init restores the initial level; rawfloat sets from 0..1;
// assign outputs a level without storing it.

import { register, type MaxNode } from '../../engine/registry';
import { firstNum, isBang, type Msg } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';
import { unwire } from './lifecycle';

const hasDOM = (): boolean => typeof document !== 'undefined';

/** The Live parameter block a live.* object saves its range and initial value in. */
function paramBlock(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  const saved = raw?.saved_attribute_attributes as { valueof?: Record<string, unknown> } | undefined;
  return saved?.valueof ?? {};
}

const firstOf = (v: unknown): number | undefined => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : undefined;
};

register('live.gain~', (_args, { ctx, node }) => {
  const p = paramBlock(node?.raw);
  const min = firstOf(p.parameter_mmin) ?? -70;
  const max = firstOf(p.parameter_mmax) ?? 6;
  const initial = Number(p.parameter_initial_enable) === 1 ? firstOf(p.parameter_initial) ?? 0 : 0;
  const horizontal = Number(node?.raw?.orientation) === 1;

  const o = makeOutlets();
  const left = new GainNode(ctx, { gain: 0 });
  const right = new GainNode(ctx, { gain: 0 });
  const clamp = (db: number): number => Math.min(max, Math.max(min, db));
  const amp = (db: number): number => (db <= min ? 0 : 10 ** (db / 20));
  const norm = (db: number): number => (max === min ? 0 : (db - min) / (max - min));

  let level = clamp(initial);
  let readout: (() => void) | undefined;

  const apply = (): void => {
    const g = amp(level);
    for (const param of [left.gain, right.gain]) {
      // A short glide rather than a jump: a fader dragged in steps would otherwise zip.
      param.cancelScheduledValues(ctx.currentTime);
      param.setTargetAtTime(g, ctx.currentTime, 0.01);
    }
    readout?.();
  };
  const output = (db = level): void => {
    o.emit(3, [norm(db)]);
    o.emit(2, [db]);
  };
  const setLevel = (db: number, emit: boolean): void => {
    level = clamp(db);
    apply();
    if (emit) output();
  };
  apply();

  function message(m: Msg): void {
    if (isBang(m) || m[0] === 'outputvalue') return output();
    const n = firstNum(m.slice(typeof m[0] === 'string' ? 1 : 0));
    switch (m[0]) {
      case 'set':
        if (n !== undefined) setLevel(n, false);
        return;
      case 'init':
        return setLevel(initial, true);
      case 'rawfloat':
        if (n !== undefined) setLevel(min + Math.min(1, Math.max(0, n)) * (max - min), true);
        return;
      case 'assign':
        if (n !== undefined) output(clamp(n));
        return;
    }
    if (typeof m[0] === 'number') setLevel(m[0], true);
  }

  // ── widget: fader + two meters + dB readout ──────────────────────────────
  let el: HTMLElement | undefined;
  let meterFrame = 0;
  const meters: { analyser: AnalyserNode; bar: HTMLElement; data: Float32Array<ArrayBuffer> }[] = [];
  if (hasDOM()) {
    const root = document.createElement('div');
    root.className = `max-livegain ${horizontal ? 'is-horizontal' : 'is-vertical'}`;

    const track = document.createElement('div');
    track.className = 'lg-track';
    for (const gain of [left, right]) {
      const analyser = new AnalyserNode(ctx, { fftSize: 512 });
      gain.connect(analyser);
      const bar = document.createElement('div');
      bar.className = 'lg-meter';
      track.appendChild(bar);
      meters.push({ analyser, bar, data: new Float32Array(analyser.fftSize) });
    }

    const fader = document.createElement('input');
    fader.type = 'range';
    fader.className = 'lg-fader';
    fader.min = String(min);
    fader.max = String(max);
    fader.step = '0.1';
    fader.title = 'live.gain~ (dB)';
    fader.addEventListener('input', () => setLevel(Number(fader.value), true));
    track.appendChild(fader);

    const text = document.createElement('span');
    text.className = 'lg-readout';

    readout = () => {
      fader.value = String(level);
      text.textContent = level <= min ? '-inf dB' : `${level.toFixed(1)} dB`;
    };
    readout();
    root.append(track, text);
    el = root;

    // Meters: peak of the last block per channel, drawn and sent out outlet 4. Throttled
    // to ~20 Hz; the bar length is the dB position within the fader's own range.
    let last = 0;
    const tick = (now: number): void => {
      meterFrame = requestAnimationFrame(tick);
      if (now - last < 50) return;
      last = now;
      const dbs = meters.map(({ analyser, bar, data }) => {
        analyser.getFloatTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v));
        const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
        bar.style.setProperty('--level', String(Math.max(0, norm(clamp(db)))));
        return Number.isFinite(db) ? Math.max(db, min) : min;
      });
      o.emit(4, dbs);
    };
    if (typeof requestAnimationFrame !== 'undefined') meterFrame = requestAnimationFrame(tick);
  }

  return {
    el,
    signalIns: [left, right],
    signalOuts: [left, right, undefined, undefined, undefined],
    controlIns: [message, undefined],
    onControlOut: o.onControlOut,
    dispose() {
      if (meterFrame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(meterFrame);
      for (const { analyser } of meters) unwire(analyser);
      unwire(left);
      unwire(right);
    },
  } satisfies MaxNode;
});
