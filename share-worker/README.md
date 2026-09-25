# maxpy-share

Short links for MaxPy patches: a Cloudflare Worker plus a KV namespace. The app's
normal Share link carries the whole patch in its `#p=` fragment and uploads nothing;
this service is the opt-in "Make a short link for posting" step in the Share popover,
for Bluesky, Facebook, LinkedIn and Reddit. See `src/lib.ts` for the design.

- `POST /api/share` `{p, name}` → `{id, url}` — `p` is the payload after `#p=`.
- `GET /s/<id>` — link-preview tags, then a redirect to the app at `APP_URL#p=<payload>`.

Wrangler needs Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`).

## Develop

    npm install
    npm test                       # unit tests, in-memory KV
    npm run dev                    # real Workers runtime, local KV, on :8787

The deployed Worker is https://maxpy-share.forg-lab.workers.dev (set in
`web/.env.production`).

To try it with the app: `npx wrangler dev --port 8787 --var APP_URL:http://localhost:5391/`
here, and `VITE_SHARE_API=http://localhost:8787 npx vite --port 5391` in `web/`.

## Deploy (first time)

    npx wrangler kv namespace create PATCHES    # paste the id into wrangler.toml
    npx wrangler deploy                         # prints the workers.dev URL

Then put that URL in `web/.env.production` as `VITE_SHARE_API=…` and rebuild the app.

## Operate

    npx wrangler tail                                          # live logs
    npx wrangler kv key list --binding PATCHES --remote        # stored links
    npx wrangler kv key delete --binding PATCHES <id> --remote # take one down

A taken-down link can stay cached at the edge for up to an hour (`max-age=3600`).

Cost: Cloudflare's free plan covers ~1,000 new links and ~100,000 clicks a day. Past
that, requests fail until the daily reset; there is no bill without a paid plan.
