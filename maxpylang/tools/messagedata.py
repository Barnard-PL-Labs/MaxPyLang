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

REFPAGES = Path("/Applications/Max.app/Contents/Resources/C74/docs/refpages")
DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "messages.json"

_METHODS = re.compile(r"<methodlist>(.*?)</methodlist>", re.S)
_METHOD = re.compile(r"<method\s+name=\"([^\"]+)\"")
_ATTRIBUTE = re.compile(r"<attribute\s+name=\"([^\"]+)\"")


def build_messages(refpages=REFPAGES):
    """{object name: {"methods": [...], "attributes": [...]}} from every reference page."""
    table = {}
    for page in sorted(Path(refpages).rglob("*.maxref.xml")):
        text = page.read_text(encoding="utf-8", errors="replace")
        name = page.name[:-len(".maxref.xml")]
        lists = _METHODS.findall(text)
        methods = sorted({m for block in lists for m in _METHOD.findall(block)})
        # attributes of the object, not the `inlet` notes kept inside each method
        outside = _METHODS.sub("", text)
        attributes = sorted(set(_ATTRIBUTE.findall(outside)))
        table[name] = {"methods": methods, "attributes": attributes}
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
