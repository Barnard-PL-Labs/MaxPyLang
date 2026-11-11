"""
Write llms.txt and llms-full.txt into the built site, for coding agents.

    llms.txt       an index in the llmstxt.org format: a summary and a link per page
    llms-full.txt  every Markdown page in navigation order, with examples inlined,
                   then an API reference read from maxpylang's signatures and docstrings

Both are built from the same sources as the HTML pages, so they cannot drift from them.
Pages written in reStructuredText are left out, except the API pages, which are generated
here from the code instead.
"""

import inspect
import re
from pathlib import Path

# Pages written in .rst that llms-full.txt leaves out on purpose.
SKIP = {
    "tutorial",  # older examples in the untyped list style; the guide pages replace it
    "support",
    "indices",
    "topics/topics",  # only a list of links
}

SUMMARY = (
    "MaxPyLang is a Python package that writes Max (MaxMSP) patches: place objects, connect "
    "them, and save a .maxpat file, or a .amxd Max for Live device."
)

NOTES = """Key rules:
- `patch.place()` always returns a list; use `[0]` for one object.
- Connect with tuples, `patch.connect((src.outs[0], dst.ins[0]))`. Inlets and outlets are 0-based.
- Prefer stubs from `maxpylang.objects` (`cycle_tilde(440)`) so a type checker can check cords.
- Fix every `UnknownObjectWarning`: an unknown object has no inlets or outlets.
- Running a script does not check cords; run mypy or pyright on it.
- In 0.1.1, loading patches saved by Max usually fails; build patches from scratch. See "Known issues".
- Call stubs for objects that need arguments (`delay(500)`); a bare one is placed with no inlets, silently.
- Live's live.* objects and `expr` are unknown to maxpylang; use dial, slider or number. `noteout` needs `noteout a 1`."""


# -- page order and text ----------------------------------------------------

def page_order(env, root):
    """Every document reachable from the root toctree, depth first."""
    order, seen = [], set()

    def visit(doc):
        if doc in seen:
            return
        seen.add(doc)
        order.append(doc)
        for child in env.toctree_includes.get(doc, []):
            visit(child)

    visit(root)
    return order


FRONT_MATTER = re.compile(r"\A---\n.*?\n---\n", re.S)
LITERALINCLUDE = re.compile(r"```\{literalinclude\}\s+(\S+)\n((?::[^\n]*\n)*)```")
DOC_ROLE = re.compile(r"\{doc\}`([^`<]*?)\s*(?:<([^`>]+)>)?`")
TOCTREE = re.compile(r"```\{toctree\}.*?```\n?", re.S)
ADMONITION = re.compile(r":::\{(\w+)\}\n(.*?)\n:::", re.S)


def markdown_for_agents(text, source, titles, docname):
    """Turn MyST source into plain Markdown: inline the examples, flatten links and notes."""

    def include(m):
        code = (source.parent / m.group(1)).resolve().read_text().rstrip()
        return f"```python\n{code}\n```"

    def doc_link(m):
        label, target = m.group(1).strip(), m.group(2)
        if target is None:
            target, label = label, ""
        base = docname.rsplit("/", 1)[0] if "/" in docname else ""
        resolved = str(Path(base, target)).replace("\\", "/") if not target.startswith("/") else target[1:]
        resolved = re.sub(r"[^/]+/\.\./", "", resolved)
        return f'"{label or titles.get(resolved, resolved)}"'

    def admonition(m):
        return "\n".join(f"> {line}" if line else ">" for line in
                         (f"**{m.group(1).capitalize()}:** " + m.group(2).strip()).splitlines())

    text = FRONT_MATTER.sub("", text)
    text = LITERALINCLUDE.sub(include, text)
    text = TOCTREE.sub("", text)
    text = DOC_ROLE.sub(doc_link, text)
    text = ADMONITION.sub(admonition, text)
    return text.strip()


def first_sentence(text):
    for block in text.split("\n\n"):
        block = block.strip()
        if block and not block.startswith(("#", "```", "|", "-", ":::", ">")):
            sentence = re.split(r"(?<=[.!?])\s", " ".join(block.split()))[0]
            return re.sub(r"\{doc\}`([^`<]*?)\s*(?:<[^`>]+>)?`", r"\1", sentence)
    return ""


# -- API section ------------------------------------------------------------

def signature(obj, name):
    try:
        sig = str(inspect.signature(obj))
    except (TypeError, ValueError):
        return name
    return name + re.sub(r"\(self,?\s*", "(", sig)


def doc_block(obj):
    doc = inspect.getdoc(obj) or ""
    # Docstrings continued with a backslash keep the next line's indent; close those gaps.
    doc = re.sub(r"(?<=\S) {3,}(?=\S)", " ", doc)
    return f"\n```text\n{doc}\n```\n" if doc else "\n"


def api_reference():
    import maxpylang as mp
    from maxpylang import rates
    from maxpylang.exceptions import UnknownObjectWarning

    members = {
        "MaxPatch": ["objs", "num_objs", "curr_position", "dict", "place", "set_position", "connect",
                     "save", "replace", "delete", "reorder", "inspect", "check"],
        "MaxObject": ["name", "ins", "outs", "__call__", "edit", "move", "link", "inspect",
                      "notknown"],
        "Inlet": ["parent", "index", "sources"],
        "Outlet": ["parent", "index", "destinations"],
    }
    out = ["# API reference", "",
           "Generated from the docstrings in the `maxpylang` package. Import with "
           "`import maxpylang as mp`."]
    for cls_name, names in members.items():
        cls = getattr(mp, cls_name)
        out += ["", f"## `mp.{signature(cls.__init__, cls_name)}`", doc_block(cls).rstrip()]
        init_doc = inspect.getdoc(cls.__init__)
        if init_doc and init_doc != inspect.getdoc(object.__init__) and "Constructor" not in init_doc:
            out.append(doc_block(cls.__init__).rstrip())
        for name in names:
            member = inspect.getattr_static(cls, name)
            if isinstance(member, property):
                out += ["", f"### `{cls_name}.{name}` (property)", doc_block(member).rstrip()]
            else:
                func = getattr(cls, name)
                out += ["", f"### `{cls_name}.{signature(func, name)}`", doc_block(func).rstrip()]

    for func in (mp.save_amxd, mp.load_amxd, mp.import_objs):
        out += ["", f"## `mp.{signature(func, func.__name__)}`", doc_block(func).rstrip()]
    out += ["", "## `mp.DEVICE_TYPES`", "",
            "The `device_type` values `save()` and `save_amxd()` accept: "
            + ", ".join(f'`"{k}"`' for k in mp.DEVICE_TYPES) + "."]
    out += ["", "## `maxpylang.rates`", doc_block(rates).rstrip()]
    out += ["", "## `maxpylang.exceptions.UnknownObjectWarning`", doc_block(UnknownObjectWarning).rstrip()]
    return "\n".join(out).strip() + "\n"


# -- writing ----------------------------------------------------------------

def write_files(app, exception):
    if exception is not None or app.builder.format != "html":
        return
    env = app.env
    base = (app.config.html_baseurl or "").rstrip("/") + "/"
    titles = {doc: env.titles[doc].astext() for doc in env.titles}
    index_lines = [f"# {app.config.project}", "", f"> {SUMMARY}", "", NOTES, "", "## Docs", ""]
    full = [f"# {app.config.project} {app.config.release}", "", f"> {SUMMARY}", "", NOTES,
            "", f"Source: {base}", ""]

    for doc in page_order(env, app.config.root_doc):
        source = Path(env.doc2path(doc))
        if doc in SKIP or doc.startswith("API/"):
            continue
        if source.suffix == ".md":
            text = markdown_for_agents(source.read_text(), source, titles, doc)
            full += ["", "---", "", text, ""]
            description = env.metadata.get(doc, {}).get("description") or first_sentence(text)
            index_lines.append(f"- [{titles[doc]}]({base}{doc}.html): {description}")

    index_lines.append(f"- [API reference]({base}API/API.html): every public class and function.")
    index_lines += ["", "## Optional", "",
                    f"- [llms-full.txt]({base}llms-full.txt): all of the above, with the API "
                    "reference, as one Markdown file."]
    full += ["", "---", "", api_reference()]

    out = Path(app.outdir)
    (out / "llms.txt").write_text("\n".join(index_lines) + "\n")
    (out / "llms-full.txt").write_text(re.sub(r"\n{3,}", "\n\n", "\n".join(full)).strip() + "\n")


def setup(app):
    app.connect("build-finished", write_files)
    return {"parallel_read_safe": True, "parallel_write_safe": True}
