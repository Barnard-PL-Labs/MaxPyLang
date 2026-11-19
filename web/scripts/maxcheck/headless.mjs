// Render every test patch through the browser engine, in a headless Chromium.
// Needs `npm run dev` (port 5173) and `python server.py <dir>` (port 8766) running.
//   node headless.mjs web_patches.json signal.wav <subdir for the WAVs>
import { chromium } from 'playwright';
const [tests, wav, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5173/interactive-plugin.html');
await page.waitForFunction(() => typeof window.__fx?.renderOffline === 'function', null, { timeout: 60000 });
const res = await page.evaluate(async ([tests, wav, outDir]) => {
  const base = 'http://127.0.0.1:8766/';
  const fx = window.__fx;
  const list = await (await fetch(base + tests)).json();
  const raw = await (await fetch(base + wav)).arrayBuffer();
  const input = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(raw);
  const failed = []; let done = 0;
  for (const t of list) {
    try {
      const out = await fx.renderOffline(t.json, input);
      await fetch(base + outDir + '/' + t.name + '.wav', { method: 'POST', body: fx.encodeWav(out) });
      done++;
    } catch (e) { failed.push(t.name + ': ' + String(e)); }
  }
  return { done, failed };
}, [tests, wav, outDir]);
console.log(JSON.stringify(res));
await browser.close();
