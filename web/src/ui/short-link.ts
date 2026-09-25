// Short links, from the maxpy-share Worker (share-worker/ at the repo root).
//
// The ordinary Share link carries the whole patch and uploads nothing; this is the
// opt-in alternative for places a long link can't go (a Bluesky post, a Facebook or
// LinkedIn card). It sends the link's payload — the same gzip+base64url token that sits
// after `#p=` — to the Worker, which stores it and answers with `…/s/<id>`.
//
// The service URL is a build-time setting, VITE_SHARE_API (see web/.env.production for
// the deployed Worker). Empty turns the feature off: the popover offers no short link.

export const SHARE_API: string =
  (import.meta.env.VITE_SHARE_API as string | undefined) ?? '';

/** Is a short-link service configured for this build? */
export const shortLinksEnabled = (): boolean => SHARE_API.trim() !== '';

/** The `#p=` payload out of a full permalink. */
export function payloadOf(url: string): string {
  const hash = url.slice(url.indexOf('#') + 1);
  return new URLSearchParams(hash).get('p') ?? '';
}

/**
 * Store the patch behind `permalink` and return its short URL. Throws with a message
 * fit to show the user (the Worker's own when it sent one).
 */
export async function makeShortLink(permalink: string, name: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${SHARE_API.replace(/\/+$/, '')}/api/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ p: payloadOf(permalink), name }),
    });
  } catch {
    throw new Error('Could not reach the link service — check your connection.');
  }
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error ?? `The link service answered ${res.status}.`);
  return body.url;
}
