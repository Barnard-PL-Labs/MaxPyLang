import { defineConfig } from 'vitest/config';

// Node-run test suite (signature, fuzz, control unit, integration). The Web Audio
// mock in setup lets signal objects instantiate headlessly — see
// test/setup/webaudio-mock.ts. Real acoustic tests run under browser mode separately.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup/webaudio-mock.ts'],
    include: ['test/**/*.test.ts'],
  },
});
