# Configuration file for the Sphinx documentation builder.
# https://www.sphinx-doc.org/en/master/usage/configuration.html

import os
import sys

# Import maxpylang from this checkout, so autodoc documents the code next to these docs.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, ROOT)

import maxpylang  # noqa: E402

# Local extensions, in docs/source/_ext.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_ext"))

# -- Project information -----------------------------------------------------

project = "MaxPyLang"
copyright = "2022-2026, Ranger Liu, Mark Santolucito and contributors"
author = "Ranger Liu, Mark Santolucito and contributors"

from importlib.metadata import PackageNotFoundError, version as _version  # noqa: E402

try:
    release = _version("maxpylang")
except PackageNotFoundError:
    release = "dev"
version = release

# -- General configuration ---------------------------------------------------

extensions = [
    "sphinx.ext.autodoc",
    "myst_parser",  # lets pages be written in Markdown
    "llms",         # writes llms.txt and llms-full.txt, for coding agents
]

source_suffix = {".rst": "restructuredtext", ".md": "markdown"}
templates_path = ["_templates"]
exclude_patterns = []

myst_enable_extensions = ["colon_fence"]
myst_heading_anchors = 3

autodoc_member_order = "bysource"
# Show signatures as written in the code, not with every overload expanded.
autodoc_typehints = "none"

# -- Options for HTML output -------------------------------------------------

html_theme = "sphinx_rtd_theme"
html_title = f"MaxPyLang {release}"
html_baseurl = "https://barnard-pl-labs.github.io/MaxPyLang/"
html_static_path = ["_static"]
html_css_files = ["custom.css"]


# -- Docstring formatting ----------------------------------------------------
# Some docstrings in maxpylang/ are plain text that reStructuredText misreads
# ("Unexpected indentation"). Fixing them is a change to the package, made in its
# own PRs. Until then, report those as a count instead of failing a -W build.
# Every other warning (a failed import, a broken link, an error in a docs page)
# still fails it.

import logging  # noqa: E402

_docstring_problems = []


class _DocstringFormatFilter(logging.Filter):
    def filter(self, record):
        location = str(getattr(record, "location", "") or "")
        if getattr(record, "type", None) == "docutils" and "docstring of maxpylang" in location:
            _docstring_problems.append(f"{location}: {record.getMessage()}")
            return False
        return True


def _report(app, exception):
    problems = sorted({p.replace(ROOT + os.sep, "") for p in _docstring_problems})
    if problems:
        print(f"\nNote: {len(problems)} formatting problems in maxpylang docstrings "
              "(not failing the build):")
        for line in problems:
            print("  " + line)


def setup(app):
    f = _DocstringFormatFilter()
    for handler in logging.getLogger("sphinx").handlers:
        # Run before Sphinx's own filter that turns warnings into errors under -W.
        handler.filters.insert(0, f)
    app.connect("build-finished", _report)
