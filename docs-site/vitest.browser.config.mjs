// Real-Chromium tests: play every example through the page's player and listen to it.
// Needs Playwright's Chromium (`npx playwright install chromium` in ../web).
import base from './vite.config.mjs';

const cfg = base({ command: 'serve' });
export default {
  ...cfg,
  test: {
    include: ['test/browser/**/*.test.ts'],
    testTimeout: 30000,
    browser: {
      enabled: true,
      provider: 'playwright',
      name: 'chromium',
      headless: true,
      screenshotFailures: false,
      // Real-time audio without a click: the examples run as a listener would hear them.
      providerOptions: { launch: { args: ['--autoplay-policy=no-user-gesture-required'] } },
    },
  },
};
