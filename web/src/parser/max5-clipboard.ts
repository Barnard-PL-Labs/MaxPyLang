// Max's own clipboard format: what "Copy Compressed" (and a plain ⌘C in Max) puts on
// the clipboard, so patches can be pasted into forums and emails as text.
//
//   ----------begin_max5_patcher----------
//   6023.3oc6cs0aiiik989Wgfw9zLoTy6W…
//   -----------end_max5_patcher-----------
//
// The number before the first `.` is the byte length of the compressed data. The rest is
// zlib (RFC 1950) data written six bits per character, in the alphabet below, with the
// bits packed LOW-FIRST: each character's value is ORed in above the bits already
// pending, and bytes are taken from the bottom. That is the opposite of base64, which is
// why no stock decoder reads it. Line breaks can appear anywhere (mail clients wrap it),
// so all whitespace is dropped before decoding.
//
// Decoded, it is the same JSON as a .maxpat's `patcher` value — or, for a copied
// selection, just `{boxes, lines, …}` — sometimes followed by a NUL terminator.

const ALPHABET = '.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+';

const BLOCK = /-+begin_max5_patcher-+([\s\S]*?)-+end_max5_patcher-+/;

/** Does this text contain a Max compressed patcher block? Cheap; decodes nothing. */
export function isMax5Patcher(text: string): boolean {
  return BLOCK.test(text);
}

/**
 * Decode a `begin_max5_patcher` block to its JSON text.
 *
 * Resolves undefined when there is no block in `text`. Throws when there is one but it
 * does not decode — a truncated paste is the usual cause, and the user should hear that
 * rather than "nothing on the clipboard".
 */
export async function decodeMax5Patcher(text: string): Promise<string | undefined> {
  const match = BLOCK.exec(text);
  if (!match) return undefined;
  const body = match[1].replace(/\s+/g, '');
  const dot = body.indexOf('.');
  const length = Number(body.slice(0, dot));
  if (dot <= 0 || !Number.isInteger(length) || length <= 0) {
    throw new Error('the Max clipboard block has no length header');
  }

  const bytes = new Uint8Array(length);
  let filled = 0;
  let bits = 0;
  let pending = 0;
  for (let i = dot + 1; i < body.length && filled < length; i++) {
    const value = ALPHABET.indexOf(body[i]);
    if (value < 0) throw new Error(`unexpected character "${body[i]}" in the Max clipboard block`);
    bits |= value << pending;
    pending += 6;
    while (pending >= 8 && filled < length) {
      bytes[filled++] = bits & 0xff;
      bits >>>= 8;
      pending -= 8;
    }
  }
  if (filled < length) throw new Error('the Max clipboard block is truncated');

  let json: string;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    json = await new Response(stream).text();
  } catch {
    throw new Error('the Max clipboard block is damaged and could not be decompressed');
  }
  return json.replace(/\0+$/, '');
}
