// Where a sound file named in a patch actually comes from.
//
// A Max patch refers to its audio by FILE NAME and nothing more — a playlist~ clip is
// `{"filename": "00-tr808-clap.wav"}` — and Max finds the file on its search path. A
// pasted or downloaded patch has no search path here, so every name is resolved through
// this module instead, in this order:
//
//   1. a choice the user made for that name (the playlist~ widget's menu), remembered
//      in localStorage so a reload does not lose it;
//   2. an audio file the user dropped in with that exact name, this session;
//   3. a built-in kit sample the name obviously asks for — `…clap…` gets the clap;
//   4. nothing, and the widget says so and offers the menu.
//
// Resolution is by name, never by box, on purpose: the same file is usually used by
// several objects, and dropping `00-tr808-clap.wav` once should fix every one of them.
//
// The kit itself lives in public/samples and is synthesized by scripts/gen-drum-kit.py.
// Dropped files are kept for the session only; they can be tens of megabytes, which is
// no size for localStorage.

export type KitId = 'kick' | 'snare' | 'clap' | 'hat';

export interface KitSample {
  id: KitId;
  label: string;
  /** Matched against a file name to guess a substitute (step 3 above). */
  pattern: RegExp;
}

export const KIT: readonly KitSample[] = [
  { id: 'kick', label: 'Bass drum', pattern: /kick|bass ?drum|\bbd\b|\bkik\b/i },
  { id: 'snare', label: 'Snare', pattern: /snare|snr|\bsd\b/i },
  { id: 'clap', label: 'Clap', pattern: /clap|\bcp\b/i },
  { id: 'hat', label: 'Hi-hat', pattern: /hi.?hat|\bhats?\b|\bhh\b|\bch\b|\boh\b|cymbal/i },
];

/** Where one file name's audio comes from. */
export type SampleSource =
  | { kind: 'kit'; id: KitId; guessed: boolean }
  | { kind: 'file'; name: string };

/** Audio file extensions accepted from a drop or the file picker. */
export const AUDIO_FILE = /\.(wav|wave|aif|aiff|aifc|mp3|m4a|aac|ogg|oga|flac|caf)$/i;

/** Is this a file the sample library can take (from a drop or a picker)? */
export function isAudioFile(file: { name: string; type?: string }): boolean {
  return AUDIO_FILE.test(file.name) || Boolean(file.type?.startsWith('audio/'));
}

const STORE_KEY = 'maxpy.sampleChoices';

const userFiles = new Map<string, ArrayBuffer>();
const choices: Record<string, string> = readChoices();
const listeners = new Set<() => void>();
const decoded = new WeakMap<BaseAudioContext, Map<string, Promise<AudioBuffer>>>();

const keyOf = (name: string): string => name.trim().toLowerCase();

function readChoices(): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveChoices(): void {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(choices));
  } catch {
    /* private window or quota: the choice still holds for this session */
  }
}

function changed(): void {
  for (const cb of [...listeners]) cb();
}

/** Hear about any change to what a name resolves to. Returns the unsubscribe. */
export function onSamplesChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The kit sample a file name obviously asks for, if any. */
export function guessKit(fileName: string): KitId | undefined {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ');
  return KIT.find((k) => k.pattern.test(base))?.id;
}

/** What a file name named by a patch plays, or undefined when nothing does. */
export function resolveSample(fileName: string): SampleSource | undefined {
  const key = keyOf(fileName);
  const choice = choices[key];
  if (choice?.startsWith('kit:')) {
    const id = choice.slice(4) as KitId;
    if (KIT.some((k) => k.id === id)) return { kind: 'kit', id, guessed: false };
  }
  if (choice?.startsWith('file:') && userFiles.has(choice.slice(5))) {
    return { kind: 'file', name: choice.slice(5) };
  }
  if (choice === 'none') return undefined;
  if (userFiles.has(key)) return { kind: 'file', name: key };
  const guess = guessKit(fileName);
  return guess ? { kind: 'kit', id: guess, guessed: true } : undefined;
}

/**
 * Pin what a file name plays: a kit sample, a dropped file (by its own name), or
 * 'none' to turn a wrong guess off. Kit and 'none' choices outlive a reload; a file
 * choice does too, but only takes effect while that file has been dropped this session.
 */
export function chooseSample(fileName: string, choice: { kit: KitId } | { file: string } | 'none'): void {
  const key = keyOf(fileName);
  choices[key] =
    choice === 'none' ? 'none' : 'kit' in choice ? `kit:${choice.kit}` : `file:${keyOf(choice.file)}`;
  saveChoices();
  changed();
}

/** Make a dropped or picked audio file available under its own name. */
export function addSampleFile(name: string, data: ArrayBuffer): void {
  const key = keyOf(name);
  userFiles.set(key, data);
  // The real file for a name replaces whatever stand-in was chosen for it; otherwise a
  // kit sample picked while the file was missing would keep playing after it arrived.
  if (choices[key] !== undefined) {
    delete choices[key];
    saveChoices();
  }
  changed();
}

/** The names of every audio file provided this session, in the order they arrived. */
export function sampleFileNames(): string[] {
  return [...userFiles.keys()];
}

/** Has an audio file with this name been provided this session? */
export function hasSampleFile(name: string): boolean {
  return userFiles.has(keyOf(name));
}

/**
 * Decode a source for one AudioContext. Cached per context and per source, so twelve
 * clips naming the same file decode it once.
 */
export function loadSample(ctx: BaseAudioContext, source: SampleSource): Promise<AudioBuffer> {
  const id = source.kind === 'kit' ? `kit:${source.id}` : `file:${source.name}`;
  let cache = decoded.get(ctx);
  if (!cache) decoded.set(ctx, (cache = new Map()));
  let pending = cache.get(id);
  if (!pending) {
    pending = bytesFor(source).then((bytes) => ctx.decodeAudioData(bytes));
    // A failure is not cached: a kit fetch that failed offline should be retried.
    pending.catch(() => cache!.delete(id));
    cache.set(id, pending);
  }
  return pending;
}

async function bytesFor(source: SampleSource): Promise<ArrayBuffer> {
  if (source.kind === 'file') {
    const data = userFiles.get(source.name);
    if (!data) throw new Error(`${source.name} has not been loaded`);
    // decodeAudioData DETACHES the buffer it is given; the original has to survive for
    // the next context (the self-test renders on its own OfflineAudioContext).
    return data.slice(0);
  }
  const res = await fetch(`${import.meta.env.BASE_URL}samples/${source.id}.wav`);
  if (!res.ok) throw new Error(`built-in ${source.id} sample: HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** For tests: forget every dropped file and every choice. */
export function resetSamples(): void {
  userFiles.clear();
  for (const key of Object.keys(choices)) delete choices[key];
  saveChoices();
  changed();
}
