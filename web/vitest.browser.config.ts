import { defineConfig } from 'vitest/config';

// SECONDARY test project — real-Chromium acoustic tests. Runs SEPARATELY from the
// default `npm test` (Node) via `npm run test:browser`. Here OfflineAudioContext and
// AudioWorklet are the genuine browser implementations, so the worklet-backed DSP
// objects actually run their per-sample math and we can assert acoustics.
//
// Requires a Chromium download: `npx playwright install chromium`. If Chromium can't
// be installed or launched in a given sandbox, this project simply won't run — the
// Node kernel tests (test/dsp/) remain the correctness source of truth.
export default defineConfig({
  test: {
    include: ['test/browser/**/*.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      name: 'chromium',
      headless: true,
      screenshotFailures: false,
    },
  },
});
