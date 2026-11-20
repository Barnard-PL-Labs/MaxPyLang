"""
Check that every link in the built site points at something that exists.

    python docs-site/scripts/check_links.py docs

Run it on the deployed folder (after `make -C docs deploy` and `npm --prefix docs-site run
build`). It checks:
  - every page the reference links to (the `${BASE}…` hrefs in docs-site/src/main.ts),
  - every script, stylesheet and file the reference's index.html loads,
  - every internal href/src in the guides' HTML pages (Sphinx output),
and exits 1, listing each broken link, if any is missing. External links (http…) and
in-page anchors are not fetched.
"""

import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlparse

SITE_PREFIX = "/MaxPyLang/"
MAIN_TS = Path(__file__).resolve().parents[1] / "src" / "main.ts"


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in ("href", "src") and value:
                self.links.append(value)


def resolve(root: Path, page: Path, link: str):
    """The file a link points at, or None for links this check skips."""
    url = urlparse(link)
    if url.scheme or link.startswith(("#", "mailto:", "data:", "javascript:")):
        return None
    path = unquote(url.path)
    if not path:
        return None
    if path.startswith(SITE_PREFIX):
        target = root / path[len(SITE_PREFIX):]
    elif path.startswith("/"):
        target = root / path.lstrip("/")
    else:
        target = page.parent / path
    if target.is_dir() or path.endswith("/"):
        target = target / "index.html"
    return target


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "docs").resolve()
    broken = []

    # 1. The reference's own links, which its script builds at run time.
    for path in sorted(set(re.findall(r"\$\{BASE\}([^`\"'\s<>]*)", MAIN_TS.read_text()))):
        target = root / path if path else root / "index.html"
        if target.is_dir():
            target = target / "index.html"
        if not target.exists():
            broken.append(f"src/main.ts links to {SITE_PREFIX}{path}: {target.relative_to(root)} is missing")

    # 2 and 3. Every HTML page's internal links: the reference's index.html and the guides.
    pages = [root / "index.html"] + [p for p in root.rglob("*.html")
                                     if p.parts[len(root.parts)] not in ("app", "source", "html", "doctrees")
                                     and p != root / "index.html"]
    checked = 0
    for page in pages:
        if not page.exists():
            broken.append(f"{page.relative_to(root)} is missing")
            continue
        parser = Links()
        parser.feed(page.read_text(encoding="utf-8", errors="replace"))
        for link in parser.links:
            target = resolve(root, page, link)
            if target is None:
                continue
            checked += 1
            if not target.exists():
                broken.append(f"{page.relative_to(root)} links to {link}: not found")

    if broken:
        print(f"{len(broken)} broken link(s):")
        for b in broken:
            print("  " + b)
        sys.exit(1)
    print(f"ok: {checked} links in {len(pages)} pages, and every page the reference links to")


if __name__ == "__main__":
    main()
