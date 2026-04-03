"""
tools.gen_scraper

Extract gen operator information from local Max reference files
and online Cycling '74 documentation.
"""

import json
import os
import re

from .constants import get_constant


_DEFAULT_GEN_DOCS_PATH = "/Applications/Max.app/Contents/Resources/C74/docs/userguide/content/gen/"

_LOCAL_FILES = {
    "gen_common_operators.json": "common",
    "gen~_operators.json": "gen_tilde",
    "gen_jitter_operators.json": "jitter",
}


def _get_gen_docs_path():
    """Return path to gen docs directory, derived from Max refpath constant."""
    try:
        max_refpath = get_constant("max_refpath")
        c74_path = max_refpath.split("/docs/refpages")[0]
        gen_path = os.path.join(c74_path, "docs", "userguide", "content", "gen")
        if os.path.exists(gen_path):
            return gen_path
    except Exception:
        pass
    if os.path.exists(_DEFAULT_GEN_DOCS_PATH):
        return _DEFAULT_GEN_DOCS_PATH
    return None


def _parse_operators_from_jsx(content, headings):
    """
    Parse gen operator names and categories from JSX content string.

    Returns list of dicts: [{"name": str, "category": str}, ...]
    """
    operators = []

    # Extract h2 headings and positions for categories
    h2_pattern = r'_jsx\(_components\.h2,\s*\{\s*id:\s*"([^"]*)",\s*\n\s*children:\s*"([^"]*)"'
    h2_matches = list(re.finditer(h2_pattern, content))

    category_ranges = []
    for i, match in enumerate(h2_matches):
        start = match.start()
        end = h2_matches[i + 1].start() if i + 1 < len(h2_matches) else len(content)
        category_name = match.group(2)
        if category_name.lower() not in ("see also",):
            category_ranges.append((start, end, category_name))

    # Extract operator names within each category
    op_pattern = r'c74-object-link",\s*\n\s*children:\s*"([^"]+)"'

    for cat_start, cat_end, category in category_ranges:
        section = content[cat_start:cat_end]
        op_matches = list(re.finditer(op_pattern, section))
        seen_in_category = set()
        for op_match in op_matches:
            name = op_match.group(1)
            if name not in seen_in_category:
                seen_in_category.add(name)
                operators.append({
                    "name": name,
                    "category": category,
                })

    return operators


def extract_local_gen_operators(gen_docs_path=None):
    """
    Extract all gen operators from local Max installation files.

    Returns dict with keys 'common', 'gen_tilde', 'jitter',
    each containing a list of operator dicts with 'name' and 'category'.
    """
    if gen_docs_path is None:
        gen_docs_path = _get_gen_docs_path()

    if gen_docs_path is None:
        raise FileNotFoundError(
            "Could not find local Gen documentation. "
            "Is Max installed at /Applications/Max.app?"
        )

    result = {}
    for filename, key in _LOCAL_FILES.items():
        filepath = os.path.join(gen_docs_path, filename)
        if not os.path.exists(filepath):
            result[key] = []
            continue

        with open(filepath, "rb") as f:
            data = json.loads(f.read())

        content = data.get("content", "")
        headings = data.get("headings", [])

        if not content:
            result[key] = []
            continue

        operators = _parse_operators_from_jsx(content, headings)
        result[key] = operators

    return result


def get_all_gen_operator_names(gen_docs_path=None):
    """Return a flat deduplicated list of all gen operator names."""
    result = extract_local_gen_operators(gen_docs_path)
    names = set()
    for ops in result.values():
        for op in ops:
            names.add(op["name"])
    return sorted(names)
