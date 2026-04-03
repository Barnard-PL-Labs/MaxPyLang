"""
tools.gen_scraper

Extract gen operator information from local Max reference files
and online Cycling '74 documentation.
"""

import builtins
import json
import keyword
import os
import re
import urllib.request

from .constants import get_constant, obj_info_folder


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


_CYCLING74_GEN_URLS = {
    "common": "https://docs.cycling74.com/userguide/gen/gen_common_operators",
    "gen_tilde": "https://docs.cycling74.com/userguide/gen/gen~_operators",
    "jitter": "https://docs.cycling74.com/userguide/gen/gen_jitter_operators",
}


def extract_online_gen_operators():
    """
    Scrape gen operator names from Cycling '74 online documentation.
    Returns dict with keys 'common', 'gen_tilde', 'jitter',
    each containing a list of operator name strings.
    Falls back to empty lists if URLs are unreachable.
    """
    result = {}
    for key, url in _CYCLING74_GEN_URLS.items():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "MaxPyLang/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")
            names = re.findall(r'class="[^"]*object-link[^"]*"[^>]*>([^<]+)<', html)
            seen = set()
            unique = []
            for name in names:
                name = name.strip()
                if name and name not in seen:
                    seen.add(name)
                    unique.append(name)
            result[key] = unique
        except Exception:
            result[key] = []
    return result


def compare_local_vs_online(gen_docs_path=None):
    """
    Compare local and online gen operator catalogs.
    Returns dict with local_only, online_only, both, local_total, online_total.
    """
    local = extract_local_gen_operators(gen_docs_path)
    online = extract_online_gen_operators()

    local_names = set()
    for ops in local.values():
        for op in ops:
            local_names.add(op["name"])

    online_names = set()
    for ops in online.values():
        for name in ops:
            online_names.add(name)

    return {
        "local_only": sorted(local_names - online_names),
        "online_only": sorted(online_names - local_names),
        "both": sorted(local_names & online_names),
        "local_total": len(local_names),
        "online_total": len(online_names),
    }


def generate_comparison_report(gen_docs_path=None, output_path=None):
    """Generate a markdown comparison report and write to output_path."""
    report = compare_local_vs_online(gen_docs_path)

    lines = [
        "# Gen Operator Comparison: Local vs. Cycling '74 Online Docs",
        "",
        f"**Local operators:** {report['local_total']}",
        f"**Online operators:** {report['online_total']}",
        f"**In both:** {len(report['both'])}",
        f"**Local only:** {len(report['local_only'])}",
        f"**Online only:** {len(report['online_only'])}",
        "",
    ]

    if report["local_only"]:
        lines.append("## Operators Found Only in Local Installation")
        lines.append("")
        for name in report["local_only"]:
            lines.append(f"- `{name}`")
        lines.append("")

    if report["online_only"]:
        lines.append("## Operators Found Only in Online Docs")
        lines.append("")
        for name in report["online_only"]:
            lines.append(f"- `{name}`")
        lines.append("")

    if report["both"]:
        lines.append("## Operators Found in Both Sources")
        lines.append("")
        for name in report["both"]:
            lines.append(f"- `{name}`")
        lines.append("")

    content = "\n".join(lines)

    if output_path:
        with open(output_path, "w") as f:
            f.write(content)

    return content


def _make_gen_obj_info(name, category=""):
    """
    Create an OBJ_INFO-compatible dict for a gen operator.
    """
    default_box = {
        "box": {
            "id": "obj-1",
            "maxclass": "newobj",
            "numinlets": 1,
            "numoutlets": 1,
            "outlettype": [""],
            "patching_rect": [0.0, 0.0, 60.0, 22.0],
            "text": name,
        }
    }

    # Special cases for known inlet/outlet counts
    if name in ("in", "in1", "in2", "in3", "in4", "in5"):
        default_box["box"]["numinlets"] = 0
        default_box["box"]["numoutlets"] = 1
    elif name in ("out", "out1", "out2", "out3", "out4", "out5"):
        default_box["box"]["numinlets"] = 1
        default_box["box"]["numoutlets"] = 0
    elif name in ("param", "Param"):
        default_box["box"]["numinlets"] = 0
        default_box["box"]["numoutlets"] = 1
    elif name in ("+", "add", "-", "sub", "*", "mul", "/", "div",
                  "==", "eq", "!=", "neq", ">", "gt", "<", "lt",
                  ">=", "gte", "<=", "lte", "max", "min", "pow",
                  "atan2", "mod", "%", "scale", "clip", "clamp",
                  "fold", "wrap", "mix", "smoothstep", "?", "switch",
                  "gate", "selector", "delay"):
        default_box["box"]["numinlets"] = 2
        default_box["box"]["numoutlets"] = 1
    elif name in ("noise", "samplerate", "SAMPLERATE", "vectorsize",
                  "VECTORSIZE", "elapsed", "voice", "voicecount",
                  "mc_channel", "mc_channelcount",
                  "pi", "PI", "twopi", "TWOPI", "e", "E",
                  "halfpi", "HALFPI", "constant"):
        default_box["box"]["numinlets"] = 0
        default_box["box"]["numoutlets"] = 1

    return {
        "default": default_box,
        "args": {"required": [], "optional": []},
        "attribs": [],
        "in/out": {},
        "doc": {
            "digest": f"Gen operator: {name}",
            "description": f"Gen operator '{name}' (category: {category})",
        },
    }


def generate_gen_obj_info(gen_docs_path=None, output_dir=None):
    """
    Generate OBJ_INFO JSON files for all gen operators.
    If output_dir is None, writes to maxpylang/data/OBJ_INFO/gen/.
    """
    if output_dir is None:
        output_dir = os.path.join(obj_info_folder, "gen")

    os.makedirs(output_dir, exist_ok=True)

    local_ops = extract_local_gen_operators(gen_docs_path)

    # Flatten all operators, deduplicating by name
    all_ops = {}
    for group, ops in local_ops.items():
        for op in ops:
            name = op["name"]
            if name not in all_ops:
                all_ops[name] = op

    # Generate info file for each operator
    for name, op in all_ops.items():
        info = _make_gen_obj_info(name, category=op.get("category", ""))
        # Sanitize filename: replace '/' with '_div_' to avoid path issues
        safe_name = name.replace("/", "_div_")
        filepath = os.path.join(output_dir, f"{safe_name}.json")
        with open(filepath, "w") as f:
            json.dump(info, f, indent=2)

    return len(all_ops)


def _sanitize_gen_py_name(name):
    """Convert a gen operator name to a valid Python identifier."""
    symbol_map = {
        "+": "add_op",
        "-": "sub_op",
        "*": "mul_op",
        "/": "div_op",
        "%": "mod_op",
        "!": "not_op",
        "!=": "neq_op",
        "!=p": "neqp_op",
        "==": "eq_op",
        "==p": "eqp_op",
        ">": "gt_op",
        ">=": "gte_op",
        ">p": "gtp_op",
        ">=p": "gtep_op",
        "<": "lt_op",
        "<=": "lte_op",
        "<p": "ltp_op",
        "<=p": "ltep_op",
        "&&": "and_op",
        "||": "or_op",
        "^^": "xor_op",
        "?": "switch_op",
        "!-": "rsub_op",
        "!/": "rdiv_op",
        "!%": "rmod_op",
        "+=": "plusequals_op",
        "*=": "mulequals_op",
    }

    if name in symbol_map:
        return symbol_map[name]

    result = name.replace("~", "_tilde")
    result = result.replace(".", "_")
    result = result.replace("-", "_")
    if result and result[0].isdigit():
        result = "_" + result
    if keyword.iskeyword(result) or result in dir(builtins):
        result = result + "_"
    return result


def generate_gen_stubs(gen_docs_path=None, output_path=None):
    """
    Generate gen.py stub file for IDE autocomplete.
    Follows the same pattern as importobjs.generate_stubs().
    """
    if output_path is None:
        objects_dir = os.path.join(
            os.path.abspath(os.path.join(os.path.realpath(__file__), os.pardir, os.pardir)),
            "objects",
        )
        output_path = os.path.join(objects_dir, "gen.py")

    local_ops = extract_local_gen_operators(gen_docs_path)

    # Flatten and deduplicate
    all_ops = {}
    for group, ops in local_ops.items():
        for op in ops:
            name = op["name"]
            if name not in all_ops:
                all_ops[name] = op

    # Build py_name -> gen_name mapping
    names_map = {}
    for name in sorted(all_ops.keys()):
        py_name = _sanitize_gen_py_name(name)
        names_map[py_name] = name

    # Build stub file
    stub_lines = []
    stub_lines.append('"""MaxObject stubs for gen operators. Auto-generated by gen_scraper."""')
    stub_lines.append("import os as _os")
    stub_lines.append("import sys as _sys")
    stub_lines.append("from maxpylang.maxobject import MaxObject")
    stub_lines.append("")

    all_names = sorted(names_map.keys())
    stub_lines.append("__all__ = [")
    for py_name in all_names:
        stub_lines.append(f"    '{py_name}',")
    stub_lines.append("]")
    stub_lines.append("")

    stub_lines.append("_NAMES = {")
    for py_name in all_names:
        stub_lines.append(f"    '{py_name}': '{names_map[py_name]}',")
    stub_lines.append("}")
    stub_lines.append("")

    stub_lines.append("_devnull = open(_os.devnull, 'w')")
    stub_lines.append("_old_stdout = _sys.stdout")
    stub_lines.append("_sys.stdout = _devnull")
    stub_lines.append("")

    for py_name in all_names:
        gen_name = names_map[py_name]
        op = all_ops[gen_name]
        category = op.get("category", "")
        docstring = f"{gen_name} - Gen operator ({category})"
        docstring = docstring.replace('"""', '\\"""')

        stub_lines.append('"""')
        stub_lines.append(docstring)
        stub_lines.append('"""')
        stub_lines.append(f"{py_name} = MaxObject('{gen_name}')")
        stub_lines.append("")

    stub_lines.append("_sys.stdout = _old_stdout")
    stub_lines.append("_devnull.close()")
    stub_lines.append("del _devnull, _old_stdout")
    stub_lines.append("")

    with open(output_path, "w") as f:
        f.write("\n".join(stub_lines))

    return output_path
