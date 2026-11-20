import base from './vite.config.mjs';
const cfg = base({ command: 'serve' });
export default { ...cfg, test: { include: ['test/*.test.ts'], environment: 'node', setupFiles: ['../web/test/setup/webaudio-mock.ts'] } };
