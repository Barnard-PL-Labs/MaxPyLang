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
    assert result["warnings"] == []  # an unknown object would be an UnknownObjectWarning here
    assert result["log"] == ""  # the script saves with verbose=False


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
    assert len({p["id"] for p in PRESETS}) == len(PRESETS) >= 28
    assert len({p["name"] for p in PRESETS}) == len(PRESETS)


def test_presets_are_filed_under_the_effect_they_are():
    """The page lists presets by effect. Each section has a few, and each preset in a
    section named after a module actually uses that module."""
    sections = {}
    for p in PRESETS:
        sections.setdefault(p["group"], []).append(p)
    assert list(sections) == ["Distortion", "Lo-Fi", "Filter", "Chorus", "Tremolo", "Delay", "Reverb", "Start"]
    by_label = {m["label"]: m["id"] for m in SCHEMA["modules"]}
    for name, presets in sections.items():
        if name == "Start":
            continue
        assert len(presets) >= 4, name
        if name in by_label:
            for p in presets:
                assert by_label[name] in [e["module"] for e in p["settings"]["chain"]], p["id"]


def test_presets_stay_inside_the_dials():
    """A preset value outside its dial's range would be clamped without a word."""
    for p in PRESETS:
        normal = {e["module"]: e for e in fxgen.normalize(p["settings"])["chain"]}
        for entry in p["settings"]["chain"]:
            for key, value in entry["values"].items():
                assert normal[entry["module"]]["values"][key] == value, (p["id"], key)
            for key, value in entry["options"].items():
                assert normal[entry["module"]]["options"][key] == value, (p["id"], key)


def test_frequency_dials_stay_inside_what_max_accepts():
    """svf~ and onepole~ take cutoffs up to a quarter of the sample rate (their reference
    pages say so). Past that the dial would turn and nothing would change in Live."""
    for mod in SCHEMA["modules"]:
        for param in mod["params"]:
            if param["unit"] == "Hz" and (mod["id"], param["id"]) != ("chorus", "rate") and param["max"] > 100:
                assert param["max"] <= 44100 / 4, (mod["id"], param["id"])
    drive = next(m for m in SCHEMA["modules"] if m["id"] == "drive")
    assert next(p for p in drive["params"] if p["id"] == "amount")["max"] <= 10  # overdrive~'s range


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
    assert "[reverb_outL.outs[0], filter_inL.ins[0]]" in src


def test_options_change_the_patch():
    def texts(chain):
        return [b.get("text", "") for b in boxes(fxgen.run({"chain": chain}), "newobj")]

    soft = texts([{"module": "drive", "options": {"character": "soft"}}])
    hard = texts([{"module": "drive", "options": {"character": "hard"}}])
    assert any(t.startswith("overdrive~") for t in soft) and not any(t.startswith("overdrive~") for t in hard)
    # each distortion type is built on its own Max object
    shaper = {"soft": "overdrive~", "tube": "tanh~", "hard": "clip~ -1", "fuzz": "clip~ -0.35", "fold": "pong~ 0"}
    for kind, obj in shaper.items():
        made = texts([{"module": "drive", "options": {"character": kind}}])
        assert any(t.startswith(obj) for t in made), kind
        assert any(t.startswith("pow ") for t in made), "the makeup gain follows the Drive dial"
    # a flanger is a swept comb~; a chorus is a tapin~ / tapout~ pair
    flanger = texts([{"module": "chorus", "options": {"voice": "flanger"}}])
    chorus = texts([{"module": "chorus", "options": {"voice": "chorus"}}])
    assert any(t.startswith("comb~") for t in flanger) and not any(t.startswith("tapin~") for t in flanger)
    assert any(t.startswith("tapin~") for t in chorus) and not any(t.startswith("comb~") for t in chorus)
    # the delay time reaches the taps as a gliding signal, and the loop saturates
    delay = texts([{"module": "delay"}])
    assert any(t.startswith("line~") for t in delay) and "tanh~" in delay
    lowpass = fxgen.script({"chain": [{"module": "filter", "options": {"mode": "lowpass"}}]})
    notch = fxgen.script({"chain": [{"module": "filter", "options": {"mode": "notch"}}]})
    assert "filter_L.outs[0]" in lowpass and "filter_L.outs[3]" in notch


def test_level_matching_constants():
    """The numbers the generator bakes in as starting values are the ones its control
    objects compute, so the device sounds the same before and after a dial is touched."""
    assert fxgen.drive_makeup("soft", 4) == pytest.approx(0.5)
    assert fxgen.drive_makeup("soft", 1) == 1.0
    assert fxgen.drive_makeup("fuzz", 10) < fxgen.drive_makeup("fuzz", 1)
    # a longer reverb is not a louder one: the comb sum is scaled down as feedback rises
    assert fxgen.reverb_level(fxgen.reverb_feedback(100)) < fxgen.reverb_level(fxgen.reverb_feedback(0))
    assert fxgen.reverb_feedback(100) < 1.0
    # the Reso dial covers the part of svf~'s range that is neither flat nor ringing forever
    assert 0.15 < fxgen.svf_resonance(0) < fxgen.svf_resonance(100) <= 0.8
    assert fxgen.filter_trim(100) == 0.5


def test_a_name_used_twice_in_the_script_is_an_error():
    """Two objects under one variable would silently rewire every cord of the first.
    (It happened: a control object took the Reso dial's name and the dial fed nothing.)"""
    import re

    names = re.findall(r"^(\w+) = (?:place|dial)\(", fxgen.script(everything_on()), re.M)
    assert len(names) == len(set(names)) > 80
    emitter = fxgen.Script()
    emitter.place("twice", "cycle~", 0, 0)
    with pytest.raises(ValueError):
        emitter.place("twice", "cycle~", 0, 0)


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
    assert filt["values"]["cutoff"] == 10000 and 0 <= filt["values"]["res"] <= 100
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
