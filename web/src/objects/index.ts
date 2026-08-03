// Object bootstrap.
//
// Every module one level under objects/ (audio/*.ts, control/*.ts, ui/*.ts,
// video/*.ts) is auto-imported for its side effect of calling register(). New
// object batches therefore need only DROP A SELF-REGISTERING FILE here — no edit
// to any shared file — which keeps parallel authoring conflict-free.
//
// After all real objects are registered we wire manifest aliases and backfill a
// Tier-A stub for every remaining object, so all ~1000 are recognized.

import.meta.glob('./*/*.ts', { eager: true });

import { MANIFEST, registerAlias, registerStubs, register, getFactory, isSupported } from '../engine/registry';

for (const [name, entry] of Object.entries(MANIFEST)) {
  if (entry.aliasOf) registerAlias(name, entry.aliasOf);
}

// mc.* multichannel objects reuse their mono implementation (a single-channel
// degradation — recognisably correct for mono signals). Done here, after all real
// modules are registered, so isSupported() reflects the true set. Lazy: the wrapper
// resolves the mono factory at build time.
for (const name of Object.keys(MANIFEST)) {
  if (name.startsWith('mc.') && !isSupported(name)) {
    const mono = name.slice(3);
    if (isSupported(mono)) register(name, (args, ctx) => getFactory(mono)!(args, ctx));
  }
}

registerStubs();
