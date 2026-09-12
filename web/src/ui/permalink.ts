// A patch you can paste into a chat message — with no server anywhere in the story.
//
// "Share" is the difference between a toy you played with for ten minutes and a tool you
// send a colleague. The whole patch travels in the URL's FRAGMENT (`#p=…`), and a
// fragment is never transmitted: the browser strips everything from the `#` onward before
// it opens the connection. So a link built here reaches GitHub Pages as a plain request
// for `patcher.html`, and the patch itself is only ever seen by the person you gave the
// link to. A query parameter would have put the user's work in a server access log
// forever, which is why the key is `#p=` and not `?p=`, and why this module builds the
// whole URL rather than handing a caller a payload it could staple anywhere.
//
// The codec is gzip + base64url through NATIVE CompressionStream. That is a deliberate
// no-dependency choice, twice over:
//   • lz-string (the usual answer) is in node_modules here only as a transitive DEV
//     dependency of @vitest/browser. Importing it from src/ would build fine locally and
//     then break the deploy the moment anyone ran `npm ci --omit=dev`.
//   • CompressionStream exists in Node 18+ as well as in every target browser, so the
//     codec is unit-testable headlessly — test/permalink.test.ts round-trips all 14
//     bundled patches through it with no DOM and no browser runner.
//
// base64url (`-`/`_`, no `=` padding) rather than plain base64 because `+`, `/` and `=`
// all mean something else inside a URL; a payload that survives one chat client's
// auto-linkifier and not the next one's is worse than no permalink at all.
//
// SIZE. Links have no specification limit but plenty of practical ones, so there are two
// numbers here rather than one. Past WARN the link still works and the caller is expected
// to say so (`tooLong`); past MAX this refuses outright by throwing, because a silently
// truncated link looks like a patcher bug when the user's friend opens it. Both are
// measured on the FINAL URL, since that is the string that actually gets pasted.

/** The fragment key. `#p=<base64url gzip of the .maxpat JSON>`. */
const FRAGMENT_KEY = 'p';

/** Past here the link works but is long enough that some clients will mangle it. */
export const PERMALINK_WARN_CHARS = 8000;

/** Past here we refuse: no link at all beats a link that arrives truncated. */
export const PERMALINK_MAX_CHARS = 32000;

/** Every character base64url may contain, and nothing else. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** What buildPermalink() hands back. `bytes` is the URL's length — it is pure ASCII. */
export interface Permalink {
  /** The absolute URL to share, ending in `#p=…`. */
  url: string;
  /** Length of `url` in characters, which for an ASCII URL is its length on the wire. */
  bytes: number;
  /** True past PERMALINK_WARN_CHARS: still usable, but worth warning the user about. */
  tooLong: boolean;
}

/** Thrown instead of returning a link nobody could paste. Carries the size for the message. */
export class PermalinkTooLargeError extends Error {
  readonly bytes: number;

  constructor(bytes: number) {
    super(
      `This patch needs a ${bytes}-character link, past the ${PERMALINK_MAX_CHARS} limit. ` +
        `Save it as a .maxpat file and send that instead.`
    );
    this.name = 'PermalinkTooLargeError';
    this.bytes = bytes;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// bytes ⇄ base64url
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chunked on purpose. `String.fromCharCode(...bytes)` is the one-liner everyone writes
 * and it throws RangeError once the patch is big enough to spread past the engine's
 * argument limit — i.e. exactly on the large patches this module exists to compress.
 */
function toBase64Url(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(payload: string): Uint8Array {
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  // Padding is dropped on the way out (it is `=`, which a URL reads as a separator) and
  // has to be put back before atob, which is strict about length.
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────────
// gzip, via the platform
// ─────────────────────────────────────────────────────────────────────────────

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Push bytes through a transform and collect the result.
 *
 * Sourced from a Blob rather than from a writer we drive ourselves: writing a chunk
 * larger than the stream's queue and only THEN starting to read deadlocks, and the
 * Blob's own stream does the interleaving for us. `Blob` and `CompressionStream` are
 * both present in Node 18+ and in every browser this ships to.
 */
async function through(bytes: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  // `new Uint8Array(bytes)` copies, which is not the point — it re-types. A Uint8Array
  // may be backed by a SharedArrayBuffer, which BlobPart does not accept, and TypeScript
  // 5.7+ tracks that in the element type. The copy is over a payload measured in
  // kilobytes and buys a signature that needs no cast.
  const source = new Blob([new Uint8Array(bytes)]).stream();
  return drain(source.pipeThrough(transform) as ReadableStream<Uint8Array>);
}

// ─────────────────────────────────────────────────────────────────────────────
// the codec
// ─────────────────────────────────────────────────────────────────────────────

/** The patch (a .maxpat-shaped object) as one URL-safe token. gzip, then base64url. */
export async function encodePatch(json: unknown): Promise<string> {
  const text = JSON.stringify(json);
  // JSON.stringify returns undefined for a function or a bare `undefined`, and throws on
  // a cycle. Either way there is nothing to share, and saying so here is far clearer
  // than a TypeError out of TextEncoder two frames down.
  if (typeof text !== 'string') throw new Error('permalink: this value is not JSON');
  return toBase64Url(await through(new TextEncoder().encode(text), new CompressionStream('gzip')));
}

/**
 * The inverse. Accepts what the address bar gives you (`#p=…`), what a caller is likely
 * to hand over (`p=…`), or the bare payload, so no caller has to know the fragment's
 * spelling. Throws on anything it cannot read — a corrupt link is a fact the user needs
 * to be told, not a null to be quietly replaced with the starter patch.
 */
export async function decodePatch(hash: string): Promise<unknown> {
  const payload = payloadOf(hash);
  if (!payload) throw new Error('permalink: no #p= payload in this link');
  if (!BASE64URL.test(payload)) throw new Error('permalink: this link is damaged');
  let bytes: Uint8Array;
  try {
    bytes = await through(fromBase64Url(payload), new DecompressionStream('gzip'));
  } catch {
    // Truncation by a chat client lands here: the gzip trailer is the last thing in the
    // stream, so a link that lost its tail fails at inflate rather than at base64.
    throw new Error('permalink: this link is damaged or was cut short');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Pull the payload out of whatever spelling the caller had.
 *
 * The `=`/`&` test is safe because a base64url payload can contain neither: padding is
 * stripped on the way out, so the only way those characters appear is a `p=…` form.
 */
function payloadOf(input: string): string {
  let text = input.trim();
  if (text.startsWith('#')) text = text.slice(1);
  if (text.includes('=') || text.includes('&')) {
    return new URLSearchParams(text).get(FRAGMENT_KEY)?.trim() ?? '';
  }
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// the link
// ─────────────────────────────────────────────────────────────────────────────

/**
 * This page's URL with any existing fragment and nothing else removed.
 *
 * `?patch=` is deliberately KEPT: it is harmless (the patcher's startup precedence puts
 * `#p=` in front of it) and stripping query state this module does not own would be a
 * surprise. Returns '' off-DOM — in Node the caller passes `base` explicitly, and a
 * relative `#p=…` is still a correct fragment-only URL.
 */
function currentBase(): string {
  if (typeof location === 'undefined' || !location.href) return '';
  return location.href.split('#')[0];
}

/**
 * Build the shareable link.
 *
 * @param base Where the link should point. Defaults to this page. Tests pass it, and so
 *   would anything that wanted a link to a different deployment of the patcher.
 * @throws PermalinkTooLargeError past PERMALINK_MAX_CHARS — see the module header.
 */
export async function buildPermalink(json: unknown, base?: string): Promise<Permalink> {
  const url = `${base ?? currentBase()}#${FRAGMENT_KEY}=${await encodePatch(json)}`;
  const bytes = url.length;
  if (bytes > PERMALINK_MAX_CHARS) throw new PermalinkTooLargeError(bytes);
  return { url, bytes, tooLong: bytes > PERMALINK_WARN_CHARS };
}

/**
 * The patch this page was opened with, or null if it was not opened with one.
 *
 * Null means "there was no `#p=`"; a damaged `#p=` THROWS, so the caller can tell the two
 * apart and say something true about each. The fragment is deliberately left in the
 * address bar afterwards: it is what makes a reload — and a bookmark — reproduce the
 * patch, and clearing it would quietly turn a permalink into a one-shot.
 *
 * Only the `p=` form counts here, even though decodePatch() also accepts a bare payload:
 * a fragment is a shared namespace. `#section-2` from someone's anchor link, or a
 * `#access_token=…` an OAuth redirect left behind, must read as "no permalink" and not
 * as a damaged one.
 *
 * @param hash Override for tests; defaults to `location.hash`.
 */
export async function readPermalinkFromLocation(hash?: string): Promise<unknown | null> {
  const raw = hash ?? (typeof location === 'undefined' ? '' : location.hash) ?? '';
  const payload = new URLSearchParams(raw.replace(/^#/, '')).get(FRAGMENT_KEY)?.trim();
  if (!payload) return null;
  return decodePatch(payload);
}
