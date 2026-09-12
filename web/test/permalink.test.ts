// src/ui/permalink.ts — a whole patch in a URL fragment.
//
// The claim under test is "send this link to someone and they get your patch, exactly".
// Three independent ways it could be false, and one way it could be dangerous:
//
//   ROUND TRIP — every patch this repo ships goes out through gzip + base64url and comes
//     back, compared as JSON TEXT rather than with a deep equal, so key order counts too.
//     A codec that silently reordered or re-spelled a number would pass a deep equal and
//     still hand the recipient a file that differs from the sender's.
//
//   ALPHABET — the payload has to survive a URL, a chat client's linkifier and a copy out
//     of a rendered message. That means base64URL: no `+`, no `/`, no `=`. Plain base64
//     round-trips perfectly in a unit test and then loses its padding somewhere between
//     two humans.
//
//   SIZE — the two thresholds, and that the refusal is a throw rather than a link nobody
//     can paste. Tested both on the pure length arithmetic (a long base) and on a
//     genuinely incompressible patch, because the arithmetic is what the thresholds ARE
//     and the big patch is proof the encoder actually reaches them.
//
//   PRIVACY — the payload must be in the FRAGMENT. Everything before the `#` is what
//     reaches a server access log, so the assertion that it is unchanged by this module
//     is the one that keeps a private patch private.
//
// All of it runs headlessly: CompressionStream is native in Node 18+, which is the whole
// reason the codec is built on it rather than on a library.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PERMALINK_MAX_CHARS,
  PERMALINK_WARN_CHARS,
  PermalinkTooLargeError,
  buildPermalink,
  decodePatch,
  encodePatch,
  readPermalinkFromLocation,
} from '../src/ui/permalink';

const PATCH_DIR = fileURLToPath(new URL('../public/test-patches/', import.meta.url));

const CORPUS = readdirSync(PATCH_DIR)
  .filter((n) => n.endsWith('.maxpat'))
  .sort()
  .map((name) => ({ name, json: JSON.parse(readFileSync(join(PATCH_DIR, name), 'utf8')) }));

/** Where the patcher actually lives, so the URL assertions are about a real link. */
const BASE = 'https://barnard-pl-labs.github.io/MaxPyLang/app/patcher.html';

/**
 * Deterministic text that gzip cannot shrink — mulberry32 over a 64-symbol alphabet, so
 * every character carries a full 6 bits and the payload comes out about the same size as
 * the source. An LCG is not good enough here: the first draft of this helper produced
 * 40000 characters that compressed to 6655, which would have made the "too long" test
 * silently assert nothing.
 */
function noise(count: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  let t = 0x9e3779b9;
  let out = '';
  for (let i = 0; i < count; i++) {
    t = (t + 0x6d2b79f5) | 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    out += alphabet[((x ^ (x >>> 14)) >>> 0) & 63];
  }
  return out;
}

/** A patch-shaped object carrying `chars` of incompressible data. */
const bigPatch = (chars: number) => ({ patcher: { boxes: [], lines: [], note: noise(chars) } });

describe('the codec round-trips', () => {
  it.each(CORPUS)('$name survives encode → decode unchanged', async ({ json }) => {
    const back = await decodePatch(await encodePatch(json));
    // Text, not toEqual: this compares key ORDER as well as content, which is the bar
    // the writer is held to elsewhere and the only one that means "the same file".
    expect(JSON.stringify(back)).toBe(JSON.stringify(json));
  });

  it('preserves unicode, floats, nesting and empty containers', async () => {
    const awkward = {
      patcher: {
        boxes: [{ box: { text: 'comment ♥ ∑ 日本語 — “curly”', patching_rect: [0.5, -12.25, 60, 22] } }],
        lines: [],
        empty: {},
        none: null,
        deep: [[[{ a: [1, 2, 3] }]]],
      },
    };
    expect(JSON.stringify(await decodePatch(await encodePatch(awkward)))).toBe(
      JSON.stringify(awkward)
    );
  });

  it('actually compresses — a patch is smaller as a payload than as JSON', async () => {
    for (const { json } of CORPUS) {
      const payload = await encodePatch(json);
      expect(payload.length).toBeLessThan(JSON.stringify(json).length);
    }
  });

  it('refuses a value that is not JSON at all', async () => {
    await expect(encodePatch(undefined)).rejects.toThrow(/not JSON/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(encodePatch(cyclic)).rejects.toThrow();
  });
});

describe('the payload is URL-safe', () => {
  it('uses only the base64url alphabet, with no padding', async () => {
    for (const { name, json } of CORPUS) {
      const payload = await encodePatch(json);
      expect(payload, name).toMatch(/^[A-Za-z0-9_-]+$/);
      // Spelled out as well as covered by the regex: these three are exactly the
      // characters plain base64 would have produced and a URL would have mangled.
      expect(payload.includes('+'), name).toBe(false);
      expect(payload.includes('/'), name).toBe(false);
      expect(payload.includes('='), name).toBe(false);
    }
  });

  it('reads a payload back in every spelling a caller might hand over', async () => {
    const payload = await encodePatch(CORPUS[0].json);
    const expected = JSON.stringify(CORPUS[0].json);
    for (const form of [payload, `p=${payload}`, `#p=${payload}`, `  #p=${payload}  `]) {
      expect(JSON.stringify(await decodePatch(form))).toBe(expected);
    }
  });

  it('rejects a damaged link instead of returning half a patch', async () => {
    const payload = await encodePatch(CORPUS[0].json);
    await expect(decodePatch('')).rejects.toThrow(/no #p=/);
    await expect(decodePatch('#')).rejects.toThrow(/no #p=/);
    await expect(decodePatch('#p=')).rejects.toThrow(/no #p=/);
    // Outside the alphabet: something mangled the link on the way.
    await expect(decodePatch('#p=not base64!')).rejects.toThrow(/damaged/);
    // Inside the alphabet but not gzip.
    await expect(decodePatch('#p=AAAAAAAA')).rejects.toThrow(/damaged/);
    // Cut short by a chat client: the gzip trailer is the part that goes missing.
    await expect(decodePatch(`#p=${payload.slice(0, payload.length - 20)}`)).rejects.toThrow(
      /damaged|cut short/
    );
  });
});

describe('the link', () => {
  it('puts the whole patch in the fragment and nothing before the #', async () => {
    const { url } = await buildPermalink(CORPUS[0].json, BASE);
    const [before, ...rest] = url.split('#');
    // The half a server sees is byte-identical to the page URL. This is the privacy
    // property: no query parameter, no path segment, nothing derived from the patch.
    expect(before).toBe(BASE);
    expect(rest).toHaveLength(1);
    expect(url.startsWith(`${BASE}#p=`)).toBe(true);
  });

  it('leaves an existing query string alone', async () => {
    const withQuery = `${BASE}?patch=fm_synth`;
    const { url } = await buildPermalink(CORPUS[0].json, withQuery);
    expect(url.startsWith(`${withQuery}#p=`)).toBe(true);
  });

  it('round-trips through the link, not just through the payload', async () => {
    for (const { name, json } of CORPUS) {
      const { url } = await buildPermalink(json, BASE);
      const back = await readPermalinkFromLocation(url.slice(url.indexOf('#')));
      expect(JSON.stringify(back), name).toBe(JSON.stringify(json));
    }
  });

  it('reports bytes as the length of the URL a human would paste', async () => {
    const { url, bytes } = await buildPermalink(CORPUS[0].json, BASE);
    expect(bytes).toBe(url.length);
  });
});

describe('size limits', () => {
  it('leaves every bundled patch comfortably shareable', async () => {
    for (const { name, json } of CORPUS) {
      const { bytes, tooLong } = await buildPermalink(json, BASE);
      expect(tooLong, name).toBe(false);
      expect(bytes, name).toBeLessThan(PERMALINK_WARN_CHARS);
    }
  });

  it('flags tooLong exactly at PERMALINK_WARN_CHARS, measured on the URL', async () => {
    // The base does the work, so this pins the arithmetic rather than gzip's ratio:
    // payload length is identical in both calls and only the prefix differs.
    const payload = await encodePatch(CORPUS[0].json);
    const fragment = `#p=${payload}`.length;
    const under = 'x'.repeat(PERMALINK_WARN_CHARS - fragment);
    const over = 'x'.repeat(PERMALINK_WARN_CHARS - fragment + 1);

    const a = await buildPermalink(CORPUS[0].json, under);
    expect(a.bytes).toBe(PERMALINK_WARN_CHARS);
    expect(a.tooLong).toBe(false);

    const b = await buildPermalink(CORPUS[0].json, over);
    expect(b.bytes).toBe(PERMALINK_WARN_CHARS + 1);
    expect(b.tooLong).toBe(true);
    // Still a real, usable link — "too long" is a warning, not a refusal.
    expect(JSON.stringify(await decodePatch(b.url.slice(b.url.indexOf('#'))))).toBe(
      JSON.stringify(CORPUS[0].json)
    );
  });

  it('refuses past PERMALINK_MAX_CHARS rather than returning a truncated link', async () => {
    const payload = await encodePatch(CORPUS[0].json);
    const fragment = `#p=${payload}`.length;
    const atLimit = 'x'.repeat(PERMALINK_MAX_CHARS - fragment);
    expect((await buildPermalink(CORPUS[0].json, atLimit)).bytes).toBe(PERMALINK_MAX_CHARS);

    const past = 'x'.repeat(PERMALINK_MAX_CHARS - fragment + 1);
    await expect(buildPermalink(CORPUS[0].json, past)).rejects.toBeInstanceOf(
      PermalinkTooLargeError
    );
    // The size is on the error, so the caller can say how far over it is.
    const err = await buildPermalink(CORPUS[0].json, past).catch((e) => e);
    expect(err.bytes).toBe(PERMALINK_MAX_CHARS + 1);
    expect(String(err)).toMatch(/\.maxpat/); // and points at the way out
  });

  it('reaches both thresholds on a real, incompressible patch', async () => {
    // ~9000 characters of noise: past the warning, inside the hard limit.
    const warned = await buildPermalink(bigPatch(9000), BASE);
    expect(warned.bytes).toBeGreaterThan(PERMALINK_WARN_CHARS);
    expect(warned.bytes).toBeLessThan(PERMALINK_MAX_CHARS);
    expect(warned.tooLong).toBe(true);
    expect(await decodePatch(warned.url.slice(warned.url.indexOf('#')))).toEqual(bigPatch(9000));

    // ~40000, which no link should carry.
    await expect(buildPermalink(bigPatch(40000), BASE)).rejects.toBeInstanceOf(
      PermalinkTooLargeError
    );
  });
});

describe('reading the link the page was opened with', () => {
  it('is null when there is no #p=, and only then', async () => {
    expect(await readPermalinkFromLocation('')).toBeNull();
    expect(await readPermalinkFromLocation('#')).toBeNull();
    expect(await readPermalinkFromLocation('#section-2')).toBeNull();
    expect(await readPermalinkFromLocation('#q=1&r=2')).toBeNull();
  });

  it('throws on a damaged #p= rather than quietly falling back to the starter', async () => {
    await expect(readPermalinkFromLocation('#p=AAAAAAAA')).rejects.toThrow(/damaged/);
  });

  it('returns null off-DOM, where there is no location to read', async () => {
    expect(typeof location).toBe('undefined'); // the node suite, by construction
    expect(await readPermalinkFromLocation()).toBeNull();
  });
});
