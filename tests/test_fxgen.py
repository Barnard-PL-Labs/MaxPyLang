"""
The plugin generator (web/src/plugin/fxgen.py), run natively.

The page runs this same file under Pyodide. These tests are what stand behind its claim
that the device you download is a patch maxpylang built and checked: every preset must
build, pass the type checks with nothing flagged and nothing unjudged, and survive the
round trip through the .amxd container.
"""

import importlib.util
import json
from pathlib import Path

import pytest

import maxpylang as mp

PLUGIN = Path(__file__).resolve().parents[1] / "web" / "src" / "plugin"

spec = importlib.util.spec_from_file_location("fxgen", PLUGIN / "fxgen.py")
fxgen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fxgen)

SCHEMA = json.loads((PLUGIN / "schema.json").read_text())
PRESETS = json.loads((PLUGIN / "presets.json").read_text())


def everything_on():
    settings = fxgen.default_settings()
    for entry in settings["chain"]:
        entry["on"] = True
    return settings


def boxes(result, maxclass=None):
    out = [b["box"] for b in result["json"]["patcher"]["boxes"]]
    return [b for b in out if b["maxclass"] == maxclass] if maxclass else out


def dial_names(result):
    return [b["saved_attribute_attributes"]["valueof"]["parameter_longname"] for b in boxes(result, "live.dial")]


@pytest.fixture(scope="module")
def full():
    return fxgen.run(everything_on())


@pytest.mark.parametrize("preset", PRESETS, ids=[p["id"] for p in PRESETS])
def test_every_preset_builds_and_checks_clean(preset):
    result = fxgen.run(preset["settings"])
    cords = result["coverage"]["cords"]
    assert cords["flagged"] == 0
    assert cords["not_checked"] == 0, cords["not_checked_because"]
    assert cords["checked"] == cords["total"] > 0
    assert result["coverage"]["objects"]["not_seen_into"] == []
    assert result["warnings"] == []
    assert "no unknown objects" in result["log"]


@pytest.mark.parametrize("preset", PRESETS, ids=[p["id"] for p in PRESETS])
def test_every_preset_is_a_loadable_device(preset, tmp_path):
    import base64

    result = fxgen.run(preset["settings"])
    path = tmp_path / result["filename"]
    path.write_bytes(base64.b64decode(result["amxd"]))
    data = path.read_bytes()
    assert data[:4] == b"ampf" and data[8:12] == b"aaaa"  # an audio effect
    loaded = mp.load_amxd(str(path))
    assert loaded == result["json"]
    # and maxpylang can open what it wrote
    again = mp.MaxPatch(load_file=str(path), verbose=False)
    assert again.num_objs == len(boxes(result))


def test_presets_cover_every_module_and_are_distinct():
    used = {entry["module"] for p in PRESETS for entry in p["settings"]["chain"]}
    assert used == {m["id"] for m in SCHEMA["modules"]}
    assert len({p["id"] for p in PRESETS}) == len(PRESETS) >= 12
    assert len({p["name"] for p in PRESETS}) == len(PRESETS)


def test_device_shape(full):
    patcher = full["json"]["patcher"]
    assert patcher["openinpresentation"] == 1
    texts = [b.get("text", "") for b in boxes(full, "newobj")]
    assert texts.count("plugin~") == 1 and texts.count("plugout~") == 1
    assert "ezdac~" not in texts and "dac~" not in texts
    # the project's rule: clip~ -1. 1. on each channel before plugout~
    assert sum(t.startswith("clip~ -1") for t in texts) >= 2
    shown = [b for b in boxes(full) if b.get("presentation") == 1]
    assert patcher["devicewidth"] >= max(b["presentation_rect"][0] + b["presentation_rect"][2] for b in shown)
    assert all(b["presentation_rect"][1] + b["presentation_rect"][3] <= 169 for b in shown)


def test_every_dial_is_a_live_parameter(full):
    dials = boxes(full, "live.dial")
    expected = sum(len(m["params"]) for m in SCHEMA["modules"]) + len(SCHEMA["output"]["params"])
    assert len(dials) == expected
    names = dial_names(full)
    assert len(set(names)) == len(names), "Live needs every parameter name to be unique"
    for d in dials:
        p = d["saved_attribute_attributes"]["valueof"]
        assert d["presentation"] == 1 and d["parameter_enable"] == 1
        assert p["parameter_mmin"] < p["parameter_mmax"]
        assert p["parameter_initial_enable"] == 1
        assert p["parameter_mmin"] <= p["parameter_initial"][0] <= p["parameter_mmax"]


def test_dials_do_not_overlap_in_the_device_view(full):
    rects = sorted(b["presentation_rect"] for b in boxes(full, "live.dial"))
    for a, b in zip(rects, rects[1:]):
        assert a[0] + a[2] <= b[0], (a, b)


def test_comments_say_what_they_were_given(full):
    words = [b["text"] for b in boxes(full) if b["maxclass"] in ("comment", "live.comment")]
    assert "=== FILTER ===" in words and "FILTER" in words
    assert not any(w.startswith(("comment", "live.comment")) for w in words)


def test_chain_order_is_signal_order():
    settings = fxgen.normalize({"chain": [{"module": "reverb"}, {"module": "filter"}]})
    src = fxgen.script(settings)
    assert src.index("# ── Reverb") < src.index("# ── Filter")
    assert "reverb -> filter -> output gain" in src
    # the filter reads the reverb's output, not the input
    assert "[reverb_outL.outs[0], filter_L.ins[0]]" in src


def test_options_change_the_patch():
    def texts(chain):
        return [b.get("text", "") for b in boxes(fxgen.run({"chain": chain}), "newobj")]

    soft = texts([{"module": "drive", "options": {"character": "soft"}}])
    hard = texts([{"module": "drive", "options": {"character": "hard"}}])
    assert any(t.startswith("overdrive~") for t in soft) and not any(t.startswith("overdrive~") for t in hard)
    lowpass = fxgen.script({"chain": [{"module": "filter", "options": {"mode": "lowpass"}}]})
    notch = fxgen.script({"chain": [{"module": "filter", "options": {"mode": "notch"}}]})
    assert "filter_L.outs[0]" in lowpass and "filter_L.outs[3]" in notch


def test_the_script_is_the_program_that_ran(tmp_path, monkeypatch):
    """Exec the emitted source on its own: it must write the same device run() reports."""
    result = fxgen.run(PRESETS[0]["settings"], want_amxd=False)
    monkeypatch.chdir(tmp_path)
    exec(compile(result["script"], "script.py", "exec"), {"__name__": "__main__"})
    assert mp.load_amxd(str(tmp_path / result["filename"])) == result["json"]


def test_settings_are_bounded_before_they_reach_the_script():
    hostile = {
        "name": 'x"); import os; os.system("echo pwned")\n#',
        "accent": "red; }",
        "chain": [
            {"module": "filter", "values": {"cutoff": 1e12, "res": "nan"}, "options": {"mode": "__import__"}},
            {"module": "filter"},
            {"module": "no_such_module"},
            "not a dict",
        ],
        "output": {"gain": -1e9},
    }
    st = fxgen.normalize(hostile)
    assert st["name"] == "x import os ossystemecho pwned"
    assert st["accent"] == SCHEMA["accents"][0]
    assert [e["module"] for e in st["chain"]].count("filter") == 1
    filt = next(e for e in st["chain"] if e["module"] == "filter")
    assert filt["values"]["cutoff"] == 18000 and 0 <= filt["values"]["res"] <= 0.95
    assert filt["options"]["mode"] == "lowpass"
    assert st["output"]["gain"] == -24
    src = fxgen.script(hostile)
    assert "os.system" not in src and "__import__" not in src
    compile(src, "hostile.py", "exec")
    assert fxgen.filename(hostile).endswith(".amxd") and "/" not in fxgen.filename(hostile)
    # garbage in is the default device out
    assert fxgen.normalize(None) == fxgen.normalize({})
    assert fxgen.normalize({"name": "   "})["name"] == "MaxPy FX"


def test_named_gaps_are_the_ones_in_the_log():
    """Every workaround the script carries names a gap, and the log has that entry."""
    import re

    log = (Path(__file__).resolve().parents[1] / "docs" / "type-system" / "m4l-gaps.md").read_text()
    named = set(re.findall(r"gap (M4L-\d+)", fxgen.script(everything_on())))
    assert named == {"M4L-01", "M4L-02", "M4L-03", "M4L-04"}
    for gap_id in named:
        assert "## %s" % gap_id in log
