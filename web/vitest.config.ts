import { defineConfig, configDefaults } from 'vitest/config';

// Node-run test suite (signature, fuzz, control unit, integration, DSP kernels). The
// Web Audio mock in setup lets signal objects instantiate headlessly — see
// test/setup/webaudio-mock.ts. Real acoustic tests run under browser mode separately
// (test/browser/**, `npm run test:browser`, config in vitest.browser.config.ts) and
// are excluded here so they never run against the mock.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup/webaudio-mock.ts'],
    include: ['test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/browser/**'],
  },
});
