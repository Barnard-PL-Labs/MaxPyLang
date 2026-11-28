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
GROUPS_PATH = DATA_PATH.with_name("attrib_groups.json")

# The pages of the two Jitter families whose members share attributes. An object's own page
# does not repeat them: it only carries a <mop> or <OB3D/> tag.
_GROUP_PAGES = {"mop": "jit.group-mop", "gl": "jit.group-gl"}
_GROUP_TAGS = {"mop": "mop", "gl": "OB3D"}
# The matrix family's page writes `[in/out]_dim` for in_dim, out_dim, in2_dim..., and leaves
# out the plain dim, planecount and type every matrix object takes (jit.grab @dim 320 240).
_MOP_PLAIN = [{"name": "dim", "type": "int"}, {"name": "planecount", "type": "int"},
              {"name": "type", "type": "symbol"}]

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


def build_groups(refpages=REFPAGES):
    """{"attributes": {group: [{"name", "type"}]}, "members": {group: [object names]}}.

    No size is kept: a page gives the most values an attribute holds (32 for a dim), not how
    many it needs.
    """
    refpages = Path(refpages)
    attributes, members = {}, {group: [] for group in _GROUP_PAGES}
    for group, page_name in _GROUP_PAGES.items():
        page = next(refpages.rglob(page_name + ".maxref.xml"))
        specs = {}
        for attribute in _root(page).findall("./attributelist/attribute"):
            name, kind = attribute.get("name"), attribute.get("type")
            if not name:
                continue
            for name in ([name.replace("[in/out]", side) for side in ("in", "out")]
                         if name.startswith("[in/out]") else [name]):
                specs[name] = {"name": name, "type": kind}
        if group == "mop":
            specs.update({spec["name"]: spec for spec in _MOP_PLAIN})
        attributes[group] = sorted(specs.values(), key=lambda spec: spec["name"])
    for page in sorted(refpages.rglob("*.maxref.xml")):
        name = page.name[:-len(".maxref.xml")]
        if name in _GROUP_PAGES.values():
            continue
        try:
            root = _root(page)
        except ElementTree.ParseError:
            continue
        for group, tag in _GROUP_TAGS.items():
            if root.find(".//" + tag) is not None:
                members[group].append(name)
    return {"attributes": attributes, "members": members}


def dump_groups(groups, path=GROUPS_PATH):
    doc = ("Built by maxpylang/tools/messagedata.py from Max's reference pages: the attributes the "
           "Jitter matrix objects (mop) and the OpenGL objects (gl) share, and which objects are in "
           "each family. An object's own page does not list them. Do not edit by hand.")
    Path(path).write_text(json.dumps({"_doc": doc, **groups}, indent=1) + "\n", encoding="utf-8")


def dump_messages(table, path=DATA_PATH):
    lines = [f'  {json.dumps(name)}: {json.dumps(entry)}' for name, entry in sorted(table.items())]
    doc = ('"_doc": "Built by maxpylang/tools/messagedata.py from Max\'s reference pages: the messages each '
           'object has a method for, and its attributes. Do not edit by hand."')
    Path(path).write_text("{\n  " + doc + ",\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8")


if __name__ == "__main__":
    built = build_messages(sys.argv[1] if len(sys.argv) > 1 else REFPAGES)
    dump_messages(built)
    print(f"{len(built)} objects written to {DATA_PATH}")
    groups = build_groups(sys.argv[1] if len(sys.argv) > 1 else REFPAGES)
    dump_groups(groups)
    print(", ".join(f"{len(names)} {group} objects" for group, names in groups["members"].items()),
          f"written to {GROUPS_PATH}")
