// A small drawing of an example's patch, as boxes and cords.
//
// Examples are written without set_position(), so their saved coordinates are a plain
// grid. The drawing lays boxes out by signal flow instead: each box sits one row below
// the lowest box that feeds it, so the picture reads top to bottom like a Max patch.

type Box = { id: string; text: string; ins: number; outs: number };
type Line = { from: string; out: number; to: string; in: number };

const H = 22, ROW = 46, GAP = 14, CHAR = 7.2, PAD = 10;

function readPatch(patch: unknown): { boxes: Box[]; lines: Line[] } {
  const p = (patch as { patcher: { boxes: { box: Record<string, any> }[]; lines: { patchline: Record<string, any> }[] } }).patcher;
  const boxes = p.boxes.map(({ box }) => ({
    id: box.id,
    text: box.maxclass === 'newobj' ? box.text ?? '' : box.text || box.maxclass,
    ins: box.numinlets ?? 0,
    outs: box.numoutlets ?? 0,
  }));
  const lines = p.lines.map(({ patchline: l }) => ({ from: l.source[0], out: l.source[1], to: l.destination[0], in: l.destination[1] }));
  return { boxes, lines };
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function patchSvg(patch: unknown, signalColor: string): string {
  const { boxes, lines } = readPatch(patch);
  // row = longest path from a box with no incoming cords
  const row = new Map<string, number>(boxes.map((b) => [b.id, 0]));
  for (let pass = 0; pass < boxes.length; pass++) {
    let changed = false;
    for (const l of lines) {
      const r = (row.get(l.from) ?? 0) + 1;
      if (r > (row.get(l.to) ?? 0) && r < boxes.length) { row.set(l.to, r); changed = true; }
    }
    if (!changed) break;
  }
  const width = (b: Box) => Math.max(32, b.text.length * CHAR + 12);
  const rows = new Map<number, Box[]>();
  for (const b of boxes) rows.set(row.get(b.id)!, [...(rows.get(row.get(b.id)!) ?? []), b]);
  const pos = new Map<string, { x: number; y: number; w: number; b: Box }>();
  let maxW = 0;
  for (const [r, list] of [...rows].sort((a, b) => a[0] - b[0])) {
    let x = PAD;
    for (const b of list) {
      pos.set(b.id, { x, y: PAD + r * ROW, w: width(b), b });
      x += width(b) + GAP;
    }
    maxW = Math.max(maxW, x - GAP + PAD);
  }
  const height = PAD * 2 + (Math.max(0, ...row.values()) * ROW) + H;
  const portX = (p: { x: number; w: number }, i: number, n: number) => (n <= 1 ? p.x + 4 : p.x + 4 + (i * (p.w - 8)) / (n - 1));
  const signal = (b: Box) => /~$/.test(b.text.split(' ')[0]);

  const cords = lines.map((l) => {
    const a = pos.get(l.from), b = pos.get(l.to);
    if (!a || !b) return '';
    const x1 = portX(a, l.out, a.b.outs), y1 = a.y + H, x2 = portX(b, l.in, b.b.ins), y2 = b.y;
    const sig = signal(a.b);
    return `<path d="M${x1},${y1} C${x1},${y1 + 18} ${x2},${y2 - 18} ${x2},${y2}" fill="none" stroke="${sig ? signalColor : '#555'}" stroke-width="${sig ? 2.5 : 1.5}"${sig ? ' stroke-dasharray="6 3"' : ''}/>`;
  });
  const nodes = [...pos.values()].map(({ x, y, w, b }) => {
    const ports = (n: number, py: number) =>
      Array.from({ length: n }, (_, i) => `<rect x="${portX({ x, w }, i, n) - 4}" y="${py}" width="8" height="3" fill="#222"/>`).join('');
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${H}" rx="3" fill="#fbfbfb" stroke="#222"/>`
      + ports(b.ins, y) + ports(b.outs, y + H - 3)
      + `<text x="${x + 6}" y="${y + 15}" font-family="ui-monospace, Menlo, monospace" font-size="12" fill="#111">${escape(b.text)}</text></g>`;
  });
  return `<svg viewBox="0 0 ${Math.max(maxW, 100)} ${height}" role="img" aria-label="Patch diagram" xmlns="http://www.w3.org/2000/svg">${cords.join('')}${nodes.join('')}</svg>`;
}
