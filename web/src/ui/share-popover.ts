// The Share popover: what clicking Share shows, anchored under the button.
//
// Share already copies the link the moment it is clicked; this is the confirmation of
// that, plus the ways to send it somewhere else. The link carries the WHOLE patch in its
// fragment (ui/permalink.ts) — typically 1–4k characters — and that fact decides which
// destinations are offered:
//
//   • Email, X and the system share sheet (Messages, AirDrop, Slack… wherever the OS
//     offers) pass the URL through intact, fragment included.
//   • Bluesky is not offered: a post is 300 characters and the link alone is longer.
//   • Facebook and LinkedIn are not offered: their share dialogs fetch the URL server
//     side, and a fragment never reaches a server, so the post would open an empty app.
//
// Those three need a SHORT link, which means storing the patch somewhere. When a
// short-link service is configured (ui/short-link.ts), the popover offers one as an
// explicit, labelled step — "this uploads the patch" — and once made, the short link
// replaces the long one in the field and every button, and adds Bluesky, Facebook,
// LinkedIn and Reddit.
//
// One popover at a time; it closes on Escape, on a click outside it, and on Share again.

import { makeShortLink, shortLinksEnabled } from './short-link';

export interface ShareOptions {
  url: string;
  /** Patch name for the message text, e.g. "fm_synth". */
  title: string;
  /** Whether the link is already on the clipboard (Share copies it before opening this). */
  copied: boolean;
  /** Shown under the link when set — e.g. that it is long enough for some apps to cut. */
  note?: string;
}

let current: { el: HTMLElement; close(): void } | undefined;

/** Close the popover if one is open. Returns whether one was. */
export function closeSharePopover(): boolean {
  if (!current) return false;
  current.close();
  return true;
}

/** Open (or re-open) the popover under `anchor`. */
export function openSharePopover(anchor: HTMLElement, opts: ShareOptions): void {
  closeSharePopover();

  const el = document.createElement('div');
  el.className = 'share-popover';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Share this patch');

  const head = document.createElement('div');
  head.className = 'share-head';
  const headline = (copied: boolean) => {
    head.textContent = copied ? '✓ Link copied' : 'Copy this link';
    head.classList.toggle('is-copied', copied);
    if (copied) {
      // Restart the flash even if it is already showing.
      head.classList.remove('flash');
      void head.offsetWidth;
      head.classList.add('flash');
    }
  };
  headline(opts.copied);

  const blurb = document.createElement('p');
  blurb.className = 'share-blurb';
  blurb.textContent = 'Anyone with the link gets this exact patch — nothing is uploaded.';

  const row = document.createElement('div');
  row.className = 'share-link-row';
  const field = document.createElement('input');
  field.type = 'text';
  field.readOnly = true;
  field.value = opts.url;
  field.setAttribute('aria-label', 'Link to this patch');
  field.addEventListener('focus', () => field.select());
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'share-copy';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      headline(true);
    } catch {
      // No clipboard permission: select the text so ⌘C works.
      field.focus();
      field.select();
      head.textContent = 'Press ⌘C to copy';
    }
  });
  row.append(field, copy);

  const note = document.createElement('p');
  note.className = 'share-note';
  note.textContent = opts.note ?? '';
  note.hidden = !opts.note;

  const message = `Listen to my Max patch “${opts.title}”`;
  let link = opts.url;
  let short = false;
  const openTab = (href: string) => window.open(href, '_blank', 'noopener,noreferrer');
  const enc = encodeURIComponent;

  const targets = document.createElement('div');
  targets.className = 'share-targets';
  /** Rebuilt whenever the link changes: which destinations work depends on its length. */
  const renderTargets = (): void => {
    targets.replaceChildren();
    const target = (label: string, glyph: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'share-target';
      const icon = document.createElement('span');
      icon.className = 'share-glyph';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = glyph;
      b.append(icon, label);
      b.addEventListener('click', onClick);
      targets.appendChild(b);
    };
    target('Email', '✉', () => {
      location.href = `mailto:?subject=${enc(message)}&body=${enc(`${message}:\n\n${link}\n`)}`;
    });
    target('X', '𝕏', () => openTab(`https://x.com/intent/post?text=${enc(message)}&url=${enc(link)}`));
    if (short) {
      target('Bluesky', '🦋', () => openTab(`https://bsky.app/intent/compose?text=${enc(`${message} ${link}`)}`));
      target('Facebook', 'f', () => openTab(`https://www.facebook.com/sharer/sharer.php?u=${enc(link)}`));
      target('LinkedIn', 'in', () => openTab(`https://www.linkedin.com/sharing/share-offsite/?url=${enc(link)}`));
      target('Reddit', '◉', () => openTab(`https://www.reddit.com/submit?url=${enc(link)}&title=${enc(message)}`));
    }
    if (typeof navigator.share === 'function') {
      target('More…', '⇪', () => {
        navigator.share({ title: message, url: link }).catch(() => undefined);
      });
    }
  };
  renderTargets();

  // The opt-in upload. Hidden entirely when no service is configured for this build.
  const shorten = document.createElement('div');
  shorten.className = 'share-shorten';
  if (shortLinksEnabled()) {
    const make = document.createElement('button');
    make.type = 'button';
    make.className = 'share-make-short';
    make.textContent = 'Make a short link for posting';
    const why = document.createElement('p');
    why.className = 'share-fineprint';
    why.textContent =
      'For Bluesky, Facebook, LinkedIn and Reddit. This uploads the patch to MaxPy’s link service so the link can be short.';
    make.addEventListener('click', async () => {
      make.disabled = true;
      make.textContent = 'Making a short link…';
      try {
        link = await makeShortLink(opts.url, opts.title);
        short = true;
        field.value = link;
        blurb.textContent = 'Short link — the patch is stored on MaxPy’s link service.';
        try {
          await navigator.clipboard.writeText(link);
          headline(true);
          head.textContent = '✓ Short link copied';
        } catch {
          head.textContent = 'Short link ready';
        }
        note.hidden = true;
        shorten.remove();
        renderTargets();
      } catch (err) {
        make.disabled = false;
        make.textContent = 'Try again';
        why.textContent = (err as Error).message;
        why.classList.add('is-error');
      }
    });
    shorten.append(make, why);
  }

  el.append(head, blurb, row, note, targets, shorten);
  document.body.appendChild(el);

  // Under the button, kept inside the window.
  const place = (): void => {
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const left = Math.max(8, Math.min(a.left + a.width / 2 - w / 2, window.innerWidth - w - 8));
    el.style.left = `${left}px`;
    el.style.top = `${a.bottom + 8}px`;
    el.style.setProperty('--arrow-x', `${a.left + a.width / 2 - left}px`);
  };
  place();

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      anchor.focus();
    }
  };
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!el.contains(t) && !anchor.contains(t)) close();
  };
  function close(): void {
    removeEventListener('keydown', onKey, true);
    removeEventListener('pointerdown', onDown, true);
    removeEventListener('resize', place);
    el.remove();
    if (current?.el === el) current = undefined;
  }
  addEventListener('keydown', onKey, true);
  addEventListener('pointerdown', onDown, true);
  addEventListener('resize', place);
  current = { el, close };
  copy.focus();
}
