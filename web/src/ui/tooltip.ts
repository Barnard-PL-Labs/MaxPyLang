// What does this inlet DO? — the one question the canvas could not answer.
//
// You can already build here: double-click, type with completion, drag a cord, ⌘Z,
// Save. What was missing was the thing Max shows continuously in its assist strip: the
// meaning of the port under the cursor. Nothing on screen said what inlet 2 of
// `scale 0 127 0. 1.` is for — not the box, not a hover, not the inspector — and the
// ports are not labelled, so the answer was "leave the app and read the Max reference".
//
// It is here rather than in ui/patcher.ts because that file installs no pointer
// listeners of its own (its header says so, and the rule is what keeps hit testing in
// one place), and not in ui/patcher-input.ts because this is not a gesture: it never
// consumes an event, never touches the document, and must not exist in the middle of a
// drag. So it is a small independent attachment over the same SVG, installed by the app
// shell, and it can be removed without any other file noticing.
//
// The data is already in memory: ui/patcher-input.ts awaits loadObjDocs() when the
// canvas gains the ability to draw a cord, well before the first hover can resolve.
// If it has not loaded (offline, or the chunk failed) the tip simply never appears.

import { objDocFor, type ObjDocPort } from '../ir/connect';
import type { PatchDoc } from '../doc/patch-doc';

/** Max's own assist dwell, near enough: long enough not to flicker along a drag path. */
const DWELL_MS = 350;
/** Gap between the cursor and the tip, so the tip never sits under the pointer. */
const OFFSET = 14;

/**
 * Port `type` values that say nothing.
 *
 * 1400 of the 3373 documented ports in generated/objdocs.json carry one of these two
 * strings — an upstream doc template nobody filled in. Printing "input value —
 * INLET_TYPE" would teach the reader that this tooltip is noise, which costs more than
 * the 1973 real type strings are worth.
 */
const PLACEHOLDER_TYPES = new Set(['INLET_TYPE', 'OUTLET_TYPE']);

export interface PortTipHost {
  /** The canvas the ports live in. Delegation, so ports may come and go freely. */
  svg: SVGSVGElement;
  doc(): PatchDoc | null;
}

/**
 * Explain the port under the cursor after a dwell. Returns the teardown thunk.
 *
 * Hover state is read off the DOM (`[data-port]`), exactly like every other hit test in
 * the patcher, so it stays right under pan, zoom, a mounted widget, and the run-mode
 * rule that hides the ports layer altogether — a hidden layer reports no port and the
 * tip never opens, with no special case for mode anywhere in this file.
 */
export function attachPortTips(host: PortTipHost): () => void {
  const tip = document.createElement('div');
  tip.className = 'port-tip';
  tip.setAttribute('role', 'tooltip');
  // The three behavioural properties are set INLINE, not left to ui/patcher.css: an
  // element that could swallow a pointerdown on a port must not depend on a stylesheet
  // having loaded. Everything about how it LOOKS is in the stylesheet.
  tip.style.position = 'fixed';
  tip.style.pointerEvents = 'none';
  tip.style.whiteSpace = 'pre-line';
  tip.hidden = true;
  document.body.appendChild(tip);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let shownFor: Element | null = null;

  const hide = (): void => {
    clearTimeout(timer);
    timer = undefined;
    shownFor = null;
    tip.hidden = true;
  };

  /** The line of prose for one port, or '' when there is nothing honest to say. */
  const describe = (port: Element): string => {
    const id = port.getAttribute('data-box');
    const dir = port.getAttribute('data-dir');
    const index = Number(port.getAttribute('data-index'));
    const node = id ? host.doc()?.node(id) : undefined;
    if (!node || !Number.isInteger(index)) return '';
    const entry = objDocFor(node.className);
    const ports: ObjDocPort[] | undefined = dir === 'in' ? entry?.inlets : entry?.outlets;
    const doc = ports?.find((p) => p.index === index);
    const kind = `${dir === 'in' ? 'inlet' : 'outlet'} ${index}`;
    // The class and the port number are worth showing even with no prose behind them:
    // on a dense box like `t b b b b` "which port am I on" is half the question, and
    // 393 of the 1054 objects have no documentation at all.
    const head = `${node.className} · ${kind}`;
    const type = doc?.type && !PLACEHOLDER_TYPES.has(doc.type) ? doc.type : undefined;
    const body = [doc?.text, type].filter(Boolean).join(' — ');
    return body ? `${head}\n${body}` : head;
  };

  const place = (clientX: number, clientY: number): void => {
    // Measured after the text is set, and flipped rather than clamped: a tip that
    // overhangs the viewport edge gets scrolled to, which would move the canvas.
    const r = tip.getBoundingClientRect();
    const x = Math.max(4, Math.min(clientX + OFFSET, window.innerWidth - r.width - 4));
    const above = clientY + OFFSET + r.height > window.innerHeight;
    const y = above ? Math.max(4, clientY - OFFSET - r.height) : clientY + OFFSET;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  const onOver = (e: PointerEvent): void => {
    const port = (e.target as Element | null)?.closest('[data-port]');
    if (!port || !host.svg.contains(port)) {
      hide();
      return;
    }
    if (port === shownFor) return;
    clearTimeout(timer);
    const { clientX, clientY } = e;
    timer = setTimeout(() => {
      const text = describe(port);
      if (!text || !port.isConnected) return;
      tip.textContent = text;
      tip.hidden = false;
      shownFor = port;
      place(clientX, clientY);
    }, DWELL_MS);
  };

  // A press is a gesture starting — a cord, a drag, a marquee. Whatever the tip was
  // about is no longer what the user is doing, and a tip left floating over a drag is
  // the most annoying thing a tooltip can do.
  const onDown = (): void => hide();

  host.svg.addEventListener('pointerover', onOver);
  host.svg.addEventListener('pointerout', onOver);
  host.svg.addEventListener('pointerdown', onDown);
  host.svg.addEventListener('wheel', onDown, { passive: true });
  window.addEventListener('blur', onDown);

  return () => {
    hide();
    host.svg.removeEventListener('pointerover', onOver);
    host.svg.removeEventListener('pointerout', onOver);
    host.svg.removeEventListener('pointerdown', onDown);
    host.svg.removeEventListener('wheel', onDown);
    window.removeEventListener('blur', onDown);
    tip.remove();
  };
}
