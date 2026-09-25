// maxpy-share: short links for MaxPy patches, so they can be posted where a 4,000-
// character link can't go.
//
// The app's normal Share link carries the whole patch in its fragment (`#p=<gzip,
// base64url>`, web/src/ui/permalink.ts). That uploads nothing, which is why it stays the
// default — but it is too long for a Bluesky post, and Facebook and LinkedIn fetch the
// URL server-side, where the fragment never arrives. This Worker stores that same
// payload under a short id:
//
//   POST /api/share  {p, name}  → {id, url}     store (or find) a patch
//   GET  /s/<id>                                  a page with the post's title and
//                                                 description for link previews, which
//                                                 then sends the browser to the app at
//                                                 APP_URL#p=<payload>
//
// The payload is stored exactly as the app encodes it, so a short link resolves to the
// very link Share would have made; the app needs no new loading path.
//
// Costs are the reason for three choices, on Cloudflare's free plan (1,000 KV writes and
// 100,000 reads a day):
//   • ids are a hash of the content, so sharing the same patch again is a read, not a
//     write, and returns the same link;
//   • rate limiting uses the Workers rate-limit binding, never KV counters, which would
//     spend a write per request;
//   • link previews are built from metadata written once at share time, so a click is a
//     single KV read and no decompression.
//
// Takedown: `npx wrangler kv key delete --binding PATCHES <id> --remote` (see README).
//
// This file holds everything; src/index.ts only default-exports `handler`, because the
// Workers runtime treats every named export of the entry module as an entrypoint.

export interface Env {
  PATCHES: KVNamespace;
  /** Optional: absent in tests and wherever the binding is unavailable. */
  SHARE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** The patcher app, e.g. https://barnard-pl-labs.github.io/MaxPyLang/app/ */
  APP_URL: string;
  /** Comma-separated origins allowed to create links from a browser. */
  ALLOWED_ORIGINS: string;
}

/** Same ceiling as the app's own links (PERMALINK_MAX_CHARS): bigger ones are refused. */
export const MAX_PAYLOAD_CHARS = 32000;
/** Decompressed ceiling: a small payload must not inflate into something huge. */
export const MAX_PATCH_BYTES = 1_000_000;
const MAX_NAME_CHARS = 80;
const ID_CHARS = 10;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ID = /^[A-Za-z0-9]{6,16}$/;

/** What is kept beside each payload, for the preview page. KV caps metadata at 1 KB. */
export interface LinkMeta {
  name: string;
  /** e.g. "12 objects: cycle~, *~, lores~, ezdac~ …" */
  summary: string;
  created: string;
}

export const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/share') {
        if (request.method === 'OPTIONS') return preflight(request, env);
        if (request.method === 'POST') return withCors(await create(request, env, url), request, env);
        return text('Method not allowed', 405);
      }
      const m = /^\/s\/([^/]+)\/?$/.exec(url.pathname);
      if (m && (request.method === 'GET' || request.method === 'HEAD')) return await open(m[1], env);
      if (url.pathname === '/') return Response.redirect(env.APP_URL, 302);
      return text('Not found', 404);
    } catch (err) {
      console.error(err);
      return text('Something went wrong', 500);
    }
  },
};

// ── POST /api/share ──────────────────────────────────────────────────────────

async function create(request: Request, env: Env, url: URL): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (env.SHARE_LIMITER) {
    const { success } = await env.SHARE_LIMITER.limit({ key: ip });
    if (!success) return json({ error: 'Too many links at once — try again in a minute.' }, 429);
  }

  let body: { p?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }
  const payload = typeof body.p === 'string' ? body.p.trim() : '';
  if (!payload || !BASE64URL.test(payload)) return json({ error: 'Not a patch link payload.' }, 400);
  if (payload.length > MAX_PAYLOAD_CHARS) return json({ error: 'This patch is too big to share as a link.' }, 413);

  let patch: unknown;
  try {
    patch = await decode(payload);
  } catch (err) {
    return json({ error: `Not a readable patch: ${(err as Error).message}` }, 400);
  }
  const boxes = (patch as { patcher?: { boxes?: unknown } })?.patcher?.boxes;
  if (!Array.isArray(boxes)) return json({ error: 'Not a Max patch.' }, 400);

  const name = cleanName(body.name);
  const id = await idFor(name, payload);
  const link = `${url.origin}/s/${id}`;

  // Content-addressed: if it is already stored, this share costs a read and no write.
  if ((await env.PATCHES.get(id)) === null) {
    const meta: LinkMeta = { name, summary: summarize(boxes), created: new Date().toISOString() };
    await env.PATCHES.put(id, payload, { metadata: meta });
  }
  return json({ id, url: link }, 200);
}

/** base64url → gunzip (capped) → JSON. */
export async function decode(payload: string): Promise<unknown> {
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PATCH_BYTES) {
      await reader.cancel();
      throw new Error('it inflates past 1 MB');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(all));
}

/** A short, stable id: base62 of SHA-256(name + payload). Same patch and name, same link. */
export async function idFor(name: string, payload: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${name}\n${payload}`))
  );
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let n = 0n;
  for (const b of digest.slice(0, 12)) n = (n << 8n) | BigInt(b);
  let id = '';
  while (id.length < ID_CHARS) {
    id += alphabet[Number(n % 62n)];
    n /= 62n;
  }
  return id;
}

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\.(maxpat|json)$/i, '') : '';
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_CHARS);
  return clean || 'Untitled';
}

/** "12 objects: cycle~, *~, lores~, ezdac~ …" — the distinct object names, in patch order. */
export function summarize(boxes: unknown[]): string {
  const names: string[] = [];
  for (const entry of boxes) {
    const box = (entry as { box?: { maxclass?: unknown; text?: unknown } })?.box;
    if (!box) continue;
    const cls = box.maxclass === 'newobj' || box.maxclass === undefined
      ? String(box.text ?? '').trim().split(/\s+/)[0]
      : String(box.maxclass);
    if (cls && cls !== 'comment' && cls !== 'message' && !names.includes(cls)) names.push(cls);
  }
  const shown = names.slice(0, 8).join(', ');
  const more = names.length > 8 ? ' …' : '';
  const count = boxes.length === 1 ? '1 object' : `${boxes.length} objects`;
  return (shown ? `${count}: ${shown}${more}` : count).slice(0, 300);
}

// ── GET /s/<id> ──────────────────────────────────────────────────────────────

async function open(id: string, env: Env): Promise<Response> {
  if (!ID.test(id)) return notFound(env);
  const { value: payload, metadata } = await env.PATCHES.getWithMetadata<LinkMeta>(id);
  if (payload === null) return notFound(env);
  const target = `${env.APP_URL}#p=${payload}`;
  const name = metadata?.name ?? 'A Max patch';
  const title = `${name} — a Max patch on MaxPy`;
  const summary = metadata?.summary ? `${metadata.summary}${metadata.summary.endsWith('…') ? '' : '.'} ` : '';
  const description = `${summary}Open it in your browser and press ▶ to hear it.`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MaxPy">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<style>body{font:15px system-ui,sans-serif;margin:3rem auto;max-width:32rem;padding:0 1rem;color:#222}a{color:#1a6fc4}</style>
</head>
<body>
<p>Opening <strong>${esc(name)}</strong> in MaxPy…</p>
<p><a href="${esc(target)}">Continue to the patch</a></p>
<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')});</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Content-addressed, so a stored link never changes; a takedown should still bite
      // within the hour, hence not immutable.
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

function notFound(env: Env): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>Link not found — MaxPy</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:15px system-ui,sans-serif;margin:3rem auto;max-width:32rem;padding:0 1rem}</style>
<p>This patch link doesn't exist or was removed.</p>
<p><a href="${esc(env.APP_URL)}">Open MaxPy</a></p>`;
  return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function allowedOrigin(request: Request, env: Env): string | undefined {
  const origin = request.headers.get('Origin');
  if (!origin) return undefined;
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : undefined;
}

function preflight(request: Request, env: Env): Response {
  const origin = allowedOrigin(request, env);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'Origin',
    },
  });
}

function withCors(response: Response, request: Request, env: Env): Response {
  const origin = allowedOrigin(request, env);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('vary', 'Origin');
  return new Response(response.body, { status: response.status, headers });
}
