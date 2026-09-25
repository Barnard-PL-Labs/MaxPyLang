// The Worker against an in-memory KV, in Node (which has the same fetch, crypto.subtle
// and CompressionStream globals the Workers runtime does). `wrangler dev` covers the real
// runtime; see the README.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import worker from '../src/index';
import { MAX_PATCH_BYTES, summarize, type Env } from '../src/lib';

/** Just enough of KVNamespace, counting writes — the resource the free plan rations. */
function fakeKV() {
  const store = new Map<string, { value: string; metadata: unknown }>();
  let writes = 0;
  const kv = {
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async getWithMetadata(key: string) {
      const hit = store.get(key);
      return { value: hit?.value ?? null, metadata: hit?.metadata ?? null };
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }) {
      writes++;
      store.set(key, { value, metadata: opts?.metadata });
    },
  };
  return { kv: kv as unknown as KVNamespace, store, writes: () => writes };
}

function makeEnv(limit?: () => boolean) {
  const kv = fakeKV();
  const env: Env = {
    PATCHES: kv.kv,
    APP_URL: 'https://example.github.io/MaxPyLang/app/',
    ALLOWED_ORIGINS: 'https://example.github.io,http://localhost:5391',
    SHARE_LIMITER: limit ? { limit: async () => ({ success: limit() }) } : undefined,
  };
  return { env, kv };
}

/** Encode exactly as web/src/ui/permalink.ts encodePatch does: gzip, base64url. */
async function encode(json: unknown): Promise<string> {
  const stream = new Blob([JSON.stringify(json)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const FM = JSON.parse(
  readFileSync(new URL('../../web/public/test-patches/fm_synth.maxpat', import.meta.url), 'utf8')
);

const post = (env: Env, body: unknown, origin = 'https://example.github.io') =>
  worker.fetch(
    new Request('https://maxpy-share.example.workers.dev/api/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: origin, 'CF-Connecting-IP': '1.2.3.4' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env
  );
const get = (env: Env, path: string) => worker.fetch(new Request(`https://maxpy-share.example.workers.dev${path}`), env);

describe('POST /api/share', () => {
  it('stores a patch and returns a short link on this Worker', async () => {
    const { env, kv } = makeEnv();
    const p = await encode(FM);
    const res = await post(env, { p, name: 'fm_synth.maxpat' });
    expect(res.status).toBe(200);
    const { id, url } = (await res.json()) as { id: string; url: string };
    expect(id).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(url).toBe(`https://maxpy-share.example.workers.dev/s/${id}`);
    expect(kv.store.get(id)?.value).toBe(p);
    expect(kv.store.get(id)?.metadata).toMatchObject({ name: 'fm_synth' });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.github.io');
  });

  it('the same patch shared twice is one link and one KV write', async () => {
    const { env, kv } = makeEnv();
    const p = await encode(FM);
    const a = (await (await post(env, { p, name: 'fm' })).json()) as { id: string };
    const b = (await (await post(env, { p, name: 'fm' })).json()) as { id: string };
    expect(a.id).toBe(b.id);
    expect(kv.writes()).toBe(1);
  });

  it('refuses what is not a patch', async () => {
    const { env, kv } = makeEnv();
    expect((await post(env, 'not json')).status).toBe(400);
    expect((await post(env, { p: 'has spaces!' })).status).toBe(400);
    expect((await post(env, { p: 'AAAA' })).status).toBe(400); // not gzip
    expect((await post(env, { p: await encode({ hello: 'world' }) })).status).toBe(400); // not a patch
    expect((await post(env, { p: 'A'.repeat(40000) })).status).toBe(413);
    expect(kv.writes()).toBe(0);
  });

  it('refuses a small payload that inflates past the cap', async () => {
    const { env } = makeEnv();
    const bomb = await encode({ patcher: { boxes: [], pad: 'x'.repeat(MAX_PATCH_BYTES + 10) } });
    expect(bomb.length).toBeLessThan(32000); // it IS small on the wire
    const res = await post(env, { p: bomb });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/1 MB/);
  });

  it('rate-limits with the binding when there is one', async () => {
    const { env, kv } = makeEnv(() => false);
    const res = await post(env, { p: await encode(FM) });
    expect(res.status).toBe(429);
    expect(kv.writes()).toBe(0);
  });

  it('answers CORS preflight only for allowed origins', async () => {
    const { env } = makeEnv();
    const pre = (origin: string) =>
      worker.fetch(new Request('https://w.dev/api/share', { method: 'OPTIONS', headers: { Origin: origin } }), env);
    expect((await pre('http://localhost:5391')).headers.get('access-control-allow-origin')).toBe('http://localhost:5391');
    expect((await pre('https://evil.example')).status).toBe(403);
  });
});

describe('GET /s/<id>', () => {
  it('serves preview tags and sends the browser to the app with the exact payload', async () => {
    const { env } = makeEnv();
    const p = await encode(FM);
    const { id } = (await (await post(env, { p, name: 'fm_synth' })).json()) as { id: string };
    const res = await get(env, `/s/${id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta property="og:title" content="fm_synth — a Max patch on MaxPy">');
    expect(html).toContain('og:description');
    expect(html).toContain('cycle~');
    expect(html).not.toContain('….');
    const target = `${env.APP_URL}#p=${p}`;
    expect(html).toContain(`content="0; url=${target}"`);
    expect(html).toContain(`location.replace(${JSON.stringify(target)})`);
  });

  it('escapes a hostile patch name', async () => {
    const { env } = makeEnv();
    const { id } = (await (await post(env, { p: await encode(FM), name: '"><script>alert(1)</script>' })).json()) as {
      id: string;
    };
    const html = await (await get(env, `/s/${id}`)).text();
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });

  it('404s an unknown or malformed id', async () => {
    const { env } = makeEnv();
    expect((await get(env, '/s/nope123456')).status).toBe(404);
    expect((await get(env, '/s/../../etc')).status).toBe(404);
  });
});

describe('summarize', () => {
  it('lists distinct object names in patch order, skipping comments and messages', () => {
    const box = (maxclass: string, text?: string) => ({ box: { maxclass, text } });
    expect(
      summarize([box('newobj', 'cycle~ 440'), box('newobj', '*~ 0.2'), box('comment', 'hi'), box('ezdac~'), box('newobj', 'cycle~ 3')])
    ).toBe('5 objects: cycle~, *~, ezdac~');
  });
});
