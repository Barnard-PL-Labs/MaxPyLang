// playlist~ : a list of sound-file clips, one of which plays at a time.
//
// The clips are not in the box text. Max saves them in the box dict as
// `data.clips[] = {filename, selection: [start, end] (0..1), loop, …}`, so this factory
// reads them from the IR node's raw box, and gets their audio from ./samples.ts — which
// is the part that matters for a pasted patch, because the files themselves never
// travel with it. A clip with no audio stays silent and its row in the widget says so,
// with a menu of built-in drums and a "Load file…" to fix it.
//
// Ports follow the saved box, not the manifest: `channelcount` audio outlets, then the
// sync signal, then the notification and content (dict) outlets. A two-channel
// playlist~ has five outlets and a one-channel one has four, and a patch's cords are
// numbered against whichever it was saved with.
//
// Messages (from Max's reference page): an int plays that clip (1-based), 0 stops;
// next, pause, resume; selection / selectionms with 1, 2 or 3 args; setclip N loop 0|1;
// append [file] [slot]; remove N; clear.
//
// NOT modelled: the sync outlet is silent, notifications and getcontent never emit,
// signal-driven cue triggering is ignored, and there is no time-stretch or pitch-shift.

import { register, type MaxNode } from '../../engine/registry';
import { firstNum, nums, type Msg } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';
import { stopSource, unwire } from './lifecycle';
import {
  AUDIO_FILE,
  KIT,
  addSampleFile,
  chooseSample,
  loadSample,
  onSamplesChange,
  resolveSample,
  sampleFileNames,
  type KitId,
  type SampleSource,
} from './samples';

interface Clip {
  fileName: string;
  /** Playback window. `norm` is 0..1 of the file, `ms` is milliseconds. */
  sel?: { start: number; end: number; unit: 'norm' | 'ms' };
  loop: boolean;
  source?: SampleSource;
  buffer?: AudioBuffer;
  /** Why there is no buffer, for the widget. */
  problem?: string;
}

const hasDOM = (): boolean => typeof document !== 'undefined';

function clipsFrom(raw: Record<string, unknown> | undefined): Clip[] {
  const data = raw?.data as { clips?: unknown } | undefined;
  if (!Array.isArray(data?.clips)) return [];
  return data.clips.flatMap((c: Record<string, unknown>) => {
    const fileName = String(c?.filename ?? c?.absolutepath ?? '').split(/[\\/]/).pop() ?? '';
    if (!fileName) return [];
    const s = Array.isArray(c.selection) ? c.selection.map(Number) : [];
    const sel =
      s.length === 2 && Number.isFinite(s[0]) && Number.isFinite(s[1]) && s[1] > s[0]
        ? { start: s[0], end: s[1], unit: 'norm' as const }
        : undefined;
    return [{ fileName, sel, loop: Number(c.loop) === 1 }];
  });
}

/** [offset, end] in seconds for a clip's window over its buffer. */
function clipWindow(clip: Clip, duration: number): [number, number] {
  const sel = clip.sel;
  if (!sel) return [0, duration];
  const scale = sel.unit === 'ms' ? 0.001 : duration;
  const start = Math.min(Math.max(0, sel.start * scale), duration);
  const end = Math.min(Math.max(start, sel.end * scale), duration);
  return end > start ? [start, end] : [start, duration];
}

register('playlist~', (_args, { ctx, node }) => {
  const raw = node?.raw;
  const channels = Math.max(
    1,
    node?.numOutlets ? node.numOutlets - 3 : Number(raw?.channelcount ?? 2) || 2
  );
  const clips = clipsFrom(raw);
  const o = makeOutlets();

  // One mono gain per audio outlet: `explicit` + 1 channel makes Web Audio downmix a
  // stereo file into a one-channel playlist~ instead of dropping its right side.
  const outs = Array.from(
    { length: channels },
    () => new GainNode(ctx, { gain: 1, channelCount: 1, channelCountMode: 'explicit' })
  );
  const sync = new GainNode(ctx, { gain: 0 });

  let current: { src: AudioBufferSourceNode; index: number; startedAt: number; offset: number } | undefined;
  let paused: { index: number; position: number } | undefined;
  let disposed = false;
  let render = (): void => {};

  // ── audio ──────────────────────────────────────────────────────────────────

  function stopCurrent(): void {
    if (!current) return;
    const { src } = current;
    current = undefined;
    src.onended = null;
    stopSource(src);
  }

  function play(index: number, from?: number): void {
    const clip = clips[index];
    stopCurrent();
    paused = undefined;
    if (!clip?.buffer) {
      render();
      return;
    }
    const [start, end] = clipWindow(clip, clip.buffer.duration);
    const offset = from === undefined ? start : Math.min(Math.max(from, start), end);
    const src = new AudioBufferSourceNode(ctx, { buffer: clip.buffer });
    if (clip.buffer.numberOfChannels > 1 && channels > 1) {
      const split = new ChannelSplitterNode(ctx, { numberOfOutputs: clip.buffer.numberOfChannels });
      src.connect(split);
      outs.forEach((out, i) => split.connect(out, Math.min(i, clip.buffer!.numberOfChannels - 1)));
    } else {
      for (const out of outs) src.connect(out);
    }
    if (clip.loop) {
      src.loop = true;
      src.loopStart = start;
      src.loopEnd = end;
      src.start(0, offset);
    } else {
      src.start(0, offset, Math.max(0, end - offset));
    }
    current = { src, index, startedAt: ctx.currentTime, offset };
    src.onended = () => {
      if (current?.src === src) {
        current = undefined;
        render();
      }
    };
    render();
  }

  function pause(): void {
    if (!current) return;
    const clip = clips[current.index];
    let position = current.offset + (ctx.currentTime - current.startedAt);
    if (clip?.loop && clip.buffer) {
      const [start, end] = clipWindow(clip, clip.buffer.duration);
      if (end > start && position > end) position = start + ((position - start) % (end - start));
    }
    paused = { index: current.index, position };
    stopCurrent();
    render();
  }

  // ── clips ↔ samples ────────────────────────────────────────────────────────

  /** Re-resolve every clip's audio. Runs at build and whenever the library changes. */
  function resolveAll(): void {
    for (const clip of clips) {
      const source = resolveSample(clip.fileName);
      const same =
        source && clip.source && JSON.stringify(source) === JSON.stringify(clip.source) && clip.buffer;
      if (same) continue;
      clip.source = source;
      clip.buffer = undefined;
      clip.problem = source ? 'loading…' : 'missing';
      if (!source) continue;
      loadSample(ctx, source).then(
        (buffer) => {
          if (disposed || clip.source !== source) return;
          clip.buffer = buffer;
          clip.problem = undefined;
          render();
        },
        (err: Error) => {
          if (disposed || clip.source !== source) return;
          clip.problem = err.message || 'could not load';
          render();
        }
      );
    }
    render();
  }

  function selection(m: Msg, unit: 'norm' | 'ms'): void {
    const n = nums(m.slice(1));
    const set = (clip: Clip | undefined, start: number, end: number) => {
      if (clip) clip.sel = end > start ? { start, end, unit } : undefined;
    };
    if (n.length >= 3) set(clips[n[0] - 1], n[1], n[2]);
    else if (n.length === 2) for (const c of clips) set(c, n[0], n[1]);
    else if (n.length === 1 && unit === 'norm') {
      const clip = clips[n[0] - 1];
      if (clip) clip.sel = undefined;
    } else if (n.length === 1) for (const c of clips) set(c, 0, n[0]);
  }

  function message(m: Msg): void {
    const head = m[0];
    if (typeof head === 'number') {
      const n = Math.trunc(head);
      if (n === 0) {
        stopCurrent();
        paused = undefined;
        render();
      } else if (n > 0) play(n - 1);
      return;
    }
    switch (head) {
      case 'next':
        if (clips.length) play(((current?.index ?? paused?.index ?? -1) + 1) % clips.length);
        break;
      case 'pause':
        pause();
        break;
      case 'resume':
        if (paused) play(paused.index, paused.position);
        break;
      case 'selection':
        selection(m, 'norm');
        break;
      case 'selectionms':
        selection(m, 'ms');
        break;
      case 'setclip': {
        const clip = clips[(firstNum(m.slice(1)) ?? 0) - 1];
        if (clip && m[2] === 'loop') clip.loop = Number(m[3]) === 1;
        break;
      }
      case 'append': {
        const name = typeof m[1] === 'string' ? m[1] : undefined;
        if (!name) break;
        const slot = Number(m[2]);
        const clip: Clip = { fileName: name, loop: false };
        if (Number.isInteger(slot) && slot >= 1) clips.splice(slot - 1, 1, clip);
        else clips.push(clip);
        resolveAll();
        break;
      }
      case 'remove': {
        const i = (firstNum(m.slice(1)) ?? 0) - 1;
        if (i < 0 || i >= clips.length) break;
        if (current?.index === i) stopCurrent();
        clips.splice(i, 1);
        render();
        break;
      }
      case 'clear':
        stopCurrent();
        paused = undefined;
        clips.length = 0;
        render();
        break;
    }
  }

  // ── widget ─────────────────────────────────────────────────────────────────

  let el: HTMLElement | undefined;
  if (hasDOM()) {
    const root = document.createElement('div');
    root.className = 'max-playlist';
    el = root;

    const pickFile = (onFile: (file: File) => void): void => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) onFile(file);
      });
      input.click();
    };

    /** Give a clip a user file: stored under the file's own name, pinned to this clip. */
    const useFile = async (clip: Clip, file: File): Promise<void> => {
      addSampleFile(file.name, await file.arrayBuffer());
      if (file.name.toLowerCase() !== clip.fileName.toLowerCase()) {
        chooseSample(clip.fileName, { file: file.name });
      }
    };

    const acceptsAudio = (e: DragEvent): boolean =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const badge = (clip: Clip): { text: string; tone: string; title: string } => {
      const s = clip.source;
      if (!s) return { text: 'missing', tone: 'missing', title: `${clip.fileName} is not here. Pick a sample or load a file.` };
      if (!clip.buffer) return { text: clip.problem ?? '…', tone: 'loading', title: clip.problem ?? '' };
      if (s.kind === 'file') {
        return s.name === clip.fileName.toLowerCase()
          ? { text: 'file', tone: 'file', title: `Playing the ${s.name} you loaded` }
          : { text: 'file', tone: 'sub', title: `Playing ${s.name} in place of ${clip.fileName}` };
      }
      const label = KIT.find((k) => k.id === s.id)?.label ?? s.id;
      return {
        text: `≈ ${label.toLowerCase()}`,
        tone: 'sub',
        title: `${clip.fileName} is not here — playing the built-in ${label}${s.guessed ? ' (guessed from the name)' : ''}`,
      };
    };

    const menu = (clip: Clip): HTMLSelectElement => {
      const select = document.createElement('select');
      select.className = 'pl-menu';
      select.title = 'Choose what this clip plays';
      const add = (value: string, text: string, parent: HTMLElement = select) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        parent.appendChild(opt);
        return opt;
      };
      add('', `${clip.fileName}…`).disabled = true;
      const files = sampleFileNames();
      if (files.length) {
        const loaded = document.createElement('optgroup');
        loaded.label = 'Loaded files';
        for (const f of files) add(`file:${f}`, f, loaded);
        select.appendChild(loaded);
      }
      const kit = document.createElement('optgroup');
      kit.label = 'Built-in drums';
      for (const k of KIT) add(`kit:${k.id}`, k.label, kit);
      select.appendChild(kit);
      add('none', 'Silent');
      add('load', 'Load a file…');
      const s = clip.source;
      select.value = !s ? '' : s.kind === 'kit' ? `kit:${s.id}` : `file:${s.name}`;
      select.addEventListener('change', () => {
        const v = select.value;
        if (v === 'load') {
          pickFile((file) => void useFile(clip, file));
          render();
        } else if (v === 'none') chooseSample(clip.fileName, 'none');
        else if (v.startsWith('kit:')) chooseSample(clip.fileName, { kit: v.slice(4) as KitId });
        else if (v.startsWith('file:')) chooseSample(clip.fileName, { file: v.slice(5) });
      });
      return select;
    };

    render = () => {
      if (disposed) return;
      const rows = clips.map((clip, i) => {
        const row = document.createElement('div');
        const b = badge(clip);
        row.className = `pl-clip pl-${b.tone}${current?.index === i ? ' is-playing' : ''}`;
        row.title = b.title;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pl-play';
        btn.textContent = current?.index === i ? '■' : '▶';
        btn.title = current?.index === i ? 'Stop' : `Play clip ${i + 1}`;
        btn.addEventListener('click', () => (current?.index === i ? message([0]) : play(i)));

        const name = document.createElement('span');
        name.className = 'pl-name';
        name.textContent = clip.fileName;

        const tag = document.createElement('span');
        tag.className = 'pl-badge';
        tag.textContent = b.text;
        tag.appendChild(menu(clip));

        row.append(btn, name, tag);
        row.addEventListener('dragover', (e) => {
          if (!acceptsAudio(e)) return;
          e.preventDefault();
          e.stopPropagation();
          row.classList.add('is-drop');
        });
        row.addEventListener('dragleave', () => row.classList.remove('is-drop'));
        row.addEventListener('drop', (e) => {
          if (!acceptsAudio(e)) return;
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove('is-drop');
          const file = Array.from(e.dataTransfer?.files ?? []).find((f) => AUDIO_FILE.test(f.name));
          if (file) void useFile(clip, file);
        });
        return row;
      });
      if (clips.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'pl-empty';
        empty.textContent = 'No clips — send “append file.wav”';
        rows.push(empty);
      }
      root.replaceChildren(...rows);
    };
  }

  const unsubscribe = onSamplesChange(resolveAll);
  resolveAll();

  const signalOuts: (AudioNode | undefined)[] = [...outs, sync];
  return {
    el,
    signalIns: [undefined],
    signalOuts,
    controlIns: [message],
    onControlOut: o.onControlOut,
    stop: () => {
      stopCurrent();
      paused = undefined;
      render();
    },
    dispose() {
      disposed = true;
      unsubscribe();
      stopCurrent();
      for (const out of outs) unwire(out);
      unwire(sync);
    },
  } satisfies MaxNode;
});
