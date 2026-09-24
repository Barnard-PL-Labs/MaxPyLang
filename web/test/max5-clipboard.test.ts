// src/parser/max5-clipboard.ts — Max's compressed clipboard text.
//
// The fixture is a real copy out of Max (a 60-box selection), so this pins the alphabet
// and the bit order against what Max actually writes rather than against an encoder
// written to match the decoder.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { decodeMax5Patcher, isMax5Patcher } from '../src/parser/max5-clipboard';

const SAMPLE = readFileSync(
  fileURLToPath(new URL('./fixtures/max5-clipboard.txt', import.meta.url)),
  'utf8'
);

describe('decodeMax5Patcher', () => {
  it('decodes a real copy from Max to a {boxes, lines} fragment', async () => {
    const json = JSON.parse((await decodeMax5Patcher(SAMPLE))!);
    expect(json.boxes).toHaveLength(60);
    expect(json.lines).toHaveLength(59);
    expect(json.boxes[0].box.maxclass).toBe('message');
  });

  it('survives the block being re-wrapped and surrounded by other text', async () => {
    const [, head, body, tail] = /^(-+begin_max5_patcher-+)(.*?)(-+end_max5_patcher-+)$/.exec(
      SAMPLE.trim()
    )!;
    const wrapped = `see this:\n${head}\n${body.match(/.{1,70}/g)!.join('\n')}\n${tail}\nthanks`;
    expect(await decodeMax5Patcher(wrapped)).toBe(await decodeMax5Patcher(SAMPLE));
  });

  it('returns undefined for text with no block, and throws for a truncated one', async () => {
    expect(isMax5Patcher('{"boxes": []}')).toBe(false);
    expect(await decodeMax5Patcher('{"boxes": []}')).toBeUndefined();
    const truncated = SAMPLE.replace(/(\d+\.\S{200})\S*(-+end)/, '$1$2');
    await expect(decodeMax5Patcher(truncated)).rejects.toThrow(/truncated/);
  });
});
