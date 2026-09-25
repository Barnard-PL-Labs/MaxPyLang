// Entry point: the handler and nothing else. The Workers runtime treats every NAMED
// export of this module as an entrypoint and refuses to start if one is not a handler,
// so the helpers (and the constants the tests import) live in ./lib.ts.
import { handler } from './lib';

export default handler;
