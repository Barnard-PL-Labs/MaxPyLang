"""
tools.messagedata

Builds maxpylang/data/messages.json: for every object in Max's reference, the messages it
has a method for and the attributes it has. messagecheck.py reads it to tell a message an
object understands from one Max would answer with "doesn't understand".

    python -m maxpylang.tools.messagedata [path to Max's refpages folder]

The reference pages are the *.maxref.xml files inside Max.app. Each lists the object's
methods (<method name="bang">) and attributes (<attribute name="interval">).
"""

import json
import re
import sys
from pathlib import Path
from xml.etree import ElementTree

REFPAGES = Path("/Applications/Max.app/Contents/Resources/C74/docs/refpages")
DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "messages.json"

_ENTITY = re.compile(r"&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)[A-Za-z0-9#]*;?")


def _root(page):
    """The parsed page. The pages use HTML entities XML does not know, which are dropped."""
    text = page.read_text(encoding="utf-8", errors="replace")
    try:
        return ElementTree.fromstring(text.encode("utf-8"))
    except ElementTree.ParseError:
        return ElementTree.fromstring(_ENTITY.sub("", text).encode("utf-8"))


def _selectors(name):
    """The messages a method entry names: `bang, getid` is two, `id nn` is `id`."""
    return [part.split()[0] for part in name.split(",") if part.split()]


def build_messages(refpages=REFPAGES):
    """{object name: {"methods": [...], "attributes": [...]}} from every reference page."""
    table, unread = {}, []
    for page in sorted(Path(refpages).rglob("*.maxref.xml")):
        name = page.name[:-len(".maxref.xml")]
        try:
            root = _root(page)
        except ElementTree.ParseError:
            unread.append(name)
            continue
        methods = sorted({selector for method in root.findall("./methodlist/method")
                          for selector in _selectors(method.get("name", ""))})
        # the object's own attributes: each also holds a nested list of notes on it (label,
        # style, default...), which are not messages
        attributes = sorted({attribute.get("name") for attribute in root.findall("./attributelist/attribute")
                             if attribute.get("name")})
        table[name] = {"methods": methods, "attributes": attributes}
    if unread:
        print(f"{len(unread)} pages could not be read: {', '.join(unread)}", file=sys.stderr)
    return table


def dump_messages(table, path=DATA_PATH):
    lines = [f'  {json.dumps(name)}: {json.dumps(entry)}' for name, entry in sorted(table.items())]
    doc = ('"_doc": "Built by maxpylang/tools/messagedata.py from Max\'s reference pages: the messages each '
           'object has a method for, and its attributes. Do not edit by hand."')
    Path(path).write_text("{\n  " + doc + ",\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8")


if __name__ == "__main__":
    built = build_messages(sys.argv[1] if len(sys.argv) > 1 else REFPAGES)
    dump_messages(built)
    print(f"{len(built)} objects written to {DATA_PATH}")
