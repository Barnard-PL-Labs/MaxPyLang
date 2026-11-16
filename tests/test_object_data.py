"""
The object database (maxpylang/data/OBJ_INFO): objects that were missing from it or stored
with no inlets, and the importer route that fills it without a running Max.

Every check stays silent on an object the database does not know, so a gap here is a gap
in the cord and graph checks too.
"""

import json
import warnings
from pathlib import Path

import pytest

import maxpylang as mp
from maxpylang import importobjs
from maxpylang.exceptions import ConnectionWarning, UnknownObjectWarning
from maxpylang.tools import typechecks

OBJ_INFO = Path(mp.__file__).parent / "data" / "OBJ_INFO"
IMPORT_ARGS = json.loads((Path(mp.__file__).parent / "data" / "import_args.json").read_text())

# Their inlets and outlets come from what they load (a Java class, a subpatch), not from
# the box, so a bare one has none.
LOADS_ITS_XLETS = {"mxj", "mxj~", "pfft~", "mc.pfft~"}


def build(text):
    with warnings.catch_warnings():
        warnings.simplefilter("error", UnknownObjectWarning)
        return mp.MaxObject(text)


def counts(text):
    obj = build(text)
    return len(obj.ins), len(obj.outs)


# ── Max for Live ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text, expected", [
    ("live.dial", (1, 2)),
    ("live.slider", (1, 2)),
    ("live.numbox", (1, 2)),
    ("live.toggle", (1, 1)),
    ("live.menu", (1, 3)),
    ("live.gain~", (2, 5)),
    ("live.object", (2, 1)),
    ("live.path", (1, 3)),
    ("live.observer", (2, 2)),
    ("live.thisdevice", (1, 3)),
    ("live.comment", (1, 0)),      # most shipped boxes hide the inlet with @suppressinlet 1
    ("live.remote~", (2, 1)),      # the outlet is new in Max 9; older shipped patches have none
    ("live.param~ cutoff", (0, 1)),
])
def test_max_for_live_objects_are_known(text, expected):
    assert counts(text) == expected


def test_a_live_ui_object_is_saved_as_its_own_box_class():
    box = build("live.dial")._dict["box"]
    assert box["maxclass"] == "live.dial" and box["parameter_enable"] == 1
    assert build("live.object")._dict["box"]["maxclass"] == "newobj"


def test_max_for_live_stubs_are_importable():
    from maxpylang.objects import live_dial, live_gain_tilde
    assert live_dial.name == "live.dial" and len(live_gain_tilde.outs) == 5


def test_a_device_with_live_objects_saves_with_no_warning(tmp_path):
    patch = mp.MaxPatch(verbose=False)
    dial, mul, osc, out = patch.place("live.dial", "*~", "cycle~ 220", "plugout~", verbose=False)
    patch.connect([osc.outs[0], mul.ins[0]], [dial.outs[0], mul.ins[1]],
                  [mul.outs[0], out.ins[0]], [mul.outs[0], out.ins[1]], verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        patch.save(str(tmp_path / "device.amxd"), device_type="instrument", verbose=False)


def test_audio_into_a_live_dial_is_flagged():
    patch = mp.MaxPatch(verbose=False)
    osc, dial = patch.place("cycle~ 220", "live.dial", verbose=False)
    with pytest.warns(ConnectionWarning, match="takes no audio"):
        patch.connect([osc.outs[0], dial.ins[0]], verbose=False)


# ── objects Max will not create bare ──────────────────────────────────────────

@pytest.mark.parametrize("text, expected", [
    ("send foo", (1, 0)),
    ("value foo", (1, 1)),
    ("pv foo", (1, 1)),
    ("udpsend 127.0.0.1 7400", (1, 0)),
    ("peek~ buf", (3, 1)),
    ("poke~ buf", (3, 1)),
    ("index~ buf", (2, 2)),
    ("lookup~ buf", (3, 1)),
    ("fftin~ 1", (1, 3)),
    ("fftout~ 1", (2, 0)),
    ("adstatus sr", (2, 2)),
    ("plugsend~ bus", (1, 0)),
    ("plugreceive~ bus", (1, 1)),
])
def test_objects_that_need_an_argument_have_their_inlets(text, expected):
    assert counts(text) == expected


def test_a_message_can_be_wired_into_send():
    patch = mp.MaxPatch(verbose=False)
    button, send = patch.place("button", "send tick", verbose=False)
    patch.connect([button.outs[0], send.ins[0]], verbose=False)
    assert send.ins[0].sources == [button.outs[0]]


def test_no_object_with_a_required_argument_is_stored_empty():
    """Max saves an error box, with no inlets or outlets, for an object it cannot create
    without arguments. The importer gives those objects the arguments in import_args.json."""
    empty = []
    for path in sorted(OBJ_INFO.glob("*/*.json")):
        spec = json.loads(path.read_text(encoding="utf-8"))
        box = spec["default"]["box"]
        if spec["args"]["required"] and not box["numinlets"] and not box["numoutlets"]:
            empty.append(path.stem)
    assert set(empty) == LOADS_ITS_XLETS


def test_every_import_argument_makes_a_known_object():
    for name, args in IMPORT_ARGS["args"].items():
        assert sum(counts(f"{name} {args}")) > 0, name


# ── Max's short names ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("short, full", [
    ("s foo", "send foo"),
    ("r foo", "receive foo"),
    ("v foo", "value foo"),
    ("s~ bus", "send~ bus"),
    ("r~ bus", "receive~ bus"),
    ("f 0.5", "float 0.5"),
    ("i 3", "int 3"),
    ("del 100", "delay 100"),
    ("p voice", "patcher voice"),
    ("list.group 3", "zl.group 3"),
    ("jit.+", "jit.op"),
])
def test_a_short_name_builds_the_object_it_stands_for(short, full):
    a, b = build(short), build(full)
    assert (len(a.ins), len(a.outs)) == (len(b.ins), len(b.outs))
    assert [o.types for o in a.outs] == [o.types for o in b.outs]
    assert a._dict["box"]["text"] == short, "the box keeps the name as typed"


def test_the_cord_check_sees_through_a_short_name():
    patch = mp.MaxPatch(verbose=False)
    osc, send, signal_send = patch.place("cycle~ 220", "s level", "s~ bus", verbose=False)
    with pytest.warns(ConnectionWarning, match="takes no audio"):
        patch.connect([osc.outs[0], send.ins[0]], verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        patch.connect([osc.outs[0], signal_send.ins[0]], verbose=False)


def test_a_name_with_different_inlets_from_its_file_is_not_an_alias():
    # Max maps xbendin2 to xbendin's file, but it has a third outlet
    for name in IMPORT_ARGS["not_aliases"]:
        with pytest.warns(UnknownObjectWarning):
            assert mp.MaxObject(name).notknown()


def test_every_alias_points_at_an_object_in_the_database():
    aliases = json.loads((OBJ_INFO / "obj_aliases.json").read_text(encoding="utf-8"))
    known = {path.stem for path in OBJ_INFO.glob("*/*.json")}
    assert [name for name, target in aliases.items() if target not in known] == []
    assert [name for name in aliases if name in known] == [], "an alias would hide a real object"


def test_max_aliases_are_read_from_the_mappings_files(fake_max):
    (fake_max / "init").mkdir()
    (fake_max / "init" / "max-objectmappings.txt").write_text(
        "max objectfile s send;\n"                    # a short name
        "max objectfile + plus;\n"                    # already an alias
        "max objectfile qmetro metro qmetro;\n"       # its own class in another object's file
        "max objectfile xbendin2 xbendin;\n"          # same file, one more outlet: listed in not_aliases
        "max objectfile list.group zl zl.group;\n"    # another spelling of zl.group
        "max objectfile flonum number number;\n"      # an object in the database
        "max objectfile mc.meter~ meter~;\n"          # multichannel: not the object it wraps
        "max objectfile old gone;\n"                  # target not in the database
        "max objectfile times2 *;\n"                  # target given by its alias
        "max definesubstitution x y;\n\n"
    )
    known = {"send", "plus", "times", "metro", "zl.group", "number", "flonum", "meter~", "xbendin"}
    found = importobjs.get_max_aliases(known, {"+": "plus", "*": "times"})
    assert found == {"s": "send", "list.group": "zl.group", "times2": "times"}


# ── counts read from the argument text ────────────────────────────────────────

@pytest.mark.parametrize("text, expected", [
    ("expr $i1 + $i2", (2, 1)),
    ("expr $f3 * 2.", (3, 1)),
    ("expr 1 + 1", (1, 1)),
    ("expr $i1 + $i9", (9, 1)),
    ("expr $i1 + $i12", (9, 1)),   # Max stops at 9 inlets
    ("expr $i99999999999999999999", (9, 1)),
    ("vexpr $f1 + $f2", (2, 1)),
    ("if $i1 > 0 then 1 else 0", (1, 1)),
    ("if $i2 then $i1", (2, 1)),
    ("if $i1 then 1 else out2 2", (1, 2)),
    ("sprintf %d %s", (2, 1)),
    ("sprintf set %i", (1, 1)),
    ("sprintf %ld:%02d", (2, 1)),
    ("sprintf 100%% %s", (1, 1)),
    ("sprintf %%d %s", (1, 1)),    # %% is a literal percent sign, not a specifier
    ("sprintf hello", (1, 1)),
])
def test_inlets_follow_the_expression_or_format(text, expected):
    obj = build(text)
    assert (len(obj.ins), len(obj.outs)) == expected
    assert (obj._dict["box"]["numinlets"], obj._dict["box"]["numoutlets"]) == expected


def test_a_bare_expr_is_still_an_error():
    with pytest.warns(UnknownObjectWarning, match="missing required arguments"):
        mp.MaxObject("expr")


def test_an_argument_with_no_documented_type_accepts_anything():
    assert typechecks.check_type([], "anything")
    assert not typechecks.check_type(["int"], "word")


# ── reading arguments ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("text, args", [
    ('route "Send to..." bang', ['"Send to..."', "bang"]),
    ('t "LCD Text / Icon"', ['"LCD Text / Icon"']),
    ("pack  0   0", [0, 0]),                                    # extra spaces are not arguments
    ('buffer~ beta "Snare 01.wav" -1', ["beta", '"Snare 01.wav"', -1]),
])
def test_a_quoted_string_is_one_argument(text, args):
    obj = build(text)
    assert obj._args == args
    assert obj._dict["box"]["text"].split(" ", 1)[1] == " ".join(str(arg) for arg in args)


def test_a_quoted_argument_counts_once_for_inlets_and_outlets():
    assert counts('route "Control Border" "Text / Icon"') == counts("route a b")
    assert len(build('t "LCD Text / Icon"').outs) == 1


def test_an_attribute_value_in_quotes_is_one_value():
    name, args, attribs = build("metro").parse_text('metro 500 @varname "one two" @active 1')
    assert (name, args, attribs) == ("metro", [500], {"varname": ['"one two"'], "active": ["1"]})


@pytest.mark.parametrize("text", [
    "metro 16n", "metro 4nd", "metro 8nt", "metro 100ms", "makenote 127 4n", "adsr~ 4n 4n 0.3 4n",  # time values
    "* #1", "tapin~ #1", "clip #2 #3", "delay~ #1 512", "cycle~ #3wind",                               # patcher arguments
    "cycle~ mybuffer", "svf~ 0.2 radians", "change +", "bondo 2 n",                                  # optional, by type
    "join", "select foo", "sel a b c", "split 15", "noteout", "noteout a", "patcherargs", "past 50",  # not really required
])
def test_arguments_max_accepts_do_not_make_an_object_unknown(text):
    assert sum(counts(text)) > 0


@pytest.mark.parametrize("text", ["metro abc", "metro 4x", "gate n", "expr", "setclock foo"])
def test_arguments_max_does_not_accept_are_still_caught(text):
    with pytest.warns(UnknownObjectWarning):
        mp.MaxObject(text)


def test_a_number_argument_may_be_a_time_value_or_a_patcher_argument():
    for arg in ("4n", "16nd", "8nt", "100ms", "2.5s", "10hz", "480ticks", "1:30", "0:1:30", "2.1.0", "#1", "#0_name"):
        assert typechecks.check_type(["int"], arg), arg
    for arg in ("n4", "4x", "ms", "word", "1:", "#name"):
        assert not typechecks.check_type(["int"], arg), arg


def test_a_float_is_not_an_int():
    assert typechecks.check_int("3") and typechecks.check_int(3)
    assert not typechecks.check_int(1.5) and not typechecks.check_int("1.5")


def test_the_importer_keeps_only_the_arguments_max_really_requires():
    info = {"required": [{"name": "minimum"}, {"name": "maximum"}], "optional": [{"name": "extra"}]}
    assert importobjs.demote_required_args(info, 1) == {
        "required": [{"name": "minimum"}], "optional": [{"name": "maximum"}, {"name": "extra"}]}
    for name, count in IMPORT_ARGS["required_count"].items():
        stored = json.loads(next(OBJ_INFO.glob(f"*/{name}.json")).read_text())["args"]["required"]
        assert len(stored) == count, name


# ── importing without a running Max ───────────────────────────────────────────

def patch_file(path, boxes):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"patcher": {"boxes": [{"box": b} for b in boxes], "lines": []}}))


def refpage(folder, name, inlets=0, outlets=0):
    xml = (f'<c74object name="{name}"><inletlist>{"<inlet/>" * inlets}</inletlist>'
           f'<outletlist>{"<outlet/>" * outlets}</outletlist></c74object>')
    path = folder / f"{name}.maxref.xml"
    path.write_text(xml)
    return str(path)


@pytest.fixture
def fake_max(tmp_path, monkeypatch):
    """A folder laid out like Max's C74 folder: refpages, and patches Max 'saved'."""
    refs = tmp_path / "C74" / "docs" / "refpages"
    (refs / "max-ref").mkdir(parents=True)
    constants = {"max_refpath": str(refs) + "/"}
    monkeypatch.setattr(importobjs, "get_constant", constants.__getitem__)
    return tmp_path / "C74"


def write_patch(path, boxes, major=9):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"patcher": {"appversion": {"major": major},
                                            "boxes": [{"box": b} for b in boxes], "lines": []}}))


def shipped_box(fake_max, name, inlets=0, outlets=0):
    ref = refpage(fake_max / "docs" / "refpages" / "max-ref", name, inlets=inlets, outlets=outlets)
    return importobjs.get_shipped_obj_info([ref], [name])[name]["box"]


def newobj(text, numinlets, numoutlets, outlettype=None, width=60.0):
    box = {"maxclass": "newobj", "text": text, "numinlets": numinlets, "numoutlets": numoutlets,
           "patching_rect": [10.0, 10.0, width, 22.0]}
    if outlettype is not None:
        box["outlettype"] = outlettype
    return box


def test_shipped_defaults_take_the_most_common_bare_box(fake_max):
    patch_file(fake_max / "help" / "a.maxhelp", [
        newobj("metro", 2, 1, ["bang"]), newobj("metro", 2, 1, ["bang"]),
        newobj("metro 500 @active 1", 2, 1, ["bang"], width=140.0),
        newobj("metro", 1, 1, ["bang"]),
    ])
    ref = refpage(fake_max / "docs" / "refpages" / "max-ref", "metro")
    box = importobjs.get_shipped_obj_info([ref], ["metro"])["metro"]["box"]
    assert box == {"id": "obj-1", "maxclass": "newobj", "numinlets": 2, "numoutlets": 1,
                   "outlettype": ["bang"], "patching_rect": [100.0, 100.0, 60.0, 22.0], "text": "metro"}


def test_shipped_defaults_use_boxes_with_arguments_for_objects_max_will_not_create_bare(fake_max):
    patch_file(fake_max / "examples" / "a.maxpat", [
        newobj("send", 0, 0), newobj("send", 0, 0), newobj("send", 0, 0),
        newobj("send foo", 1, 0), newobj("send bar", 1, 0),
    ])
    ref = refpage(fake_max / "docs" / "refpages" / "max-ref", "send")
    box = importobjs.get_shipped_obj_info([ref], ["send"])["send"]["box"]
    assert (box["numinlets"], box["numoutlets"], box["text"]) == (1, 0, "send")
    assert "outlettype" not in box


def test_shipped_defaults_keep_a_ui_box_as_its_own_class(fake_max):
    dial = {"maxclass": "live.dial", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"],
            "parameter_enable": 1, "patching_rect": [5.0, 5.0, 44.0, 47.0], "varname": "cutoff"}
    patch_file(fake_max / "help" / "m4l" / "live.dial.maxhelp", [dial])
    ref = refpage(fake_max / "docs" / "refpages" / "max-ref", "live.dial")
    box = importobjs.get_shipped_obj_info([ref], ["live.dial"])["live.dial"]["box"]
    assert box == {"id": "obj-1", "maxclass": "live.dial", "numinlets": 1, "numoutlets": 2,
                   "outlettype": ["", "float"], "parameter_enable": 1,
                   "patching_rect": [100.0, 100.0, 44.0, 47.0]}


def test_shipped_defaults_read_nested_patchers_but_not_gen(fake_max):
    inner = {"boxes": [{"box": newobj("metro", 2, 1, ["bang"])}], "lines": []}
    gen = {"classnamespace": "dsp.gen", "boxes": [{"box": newobj("metro", 9, 9, [""] * 9)}] * 5, "lines": []}
    patch_file(fake_max / "help" / "a.maxhelp", [
        {"maxclass": "newobj", "text": "p inner", "numinlets": 0, "numoutlets": 0, "patcher": inner},
        {"maxclass": "newobj", "text": "gen~", "numinlets": 1, "numoutlets": 1, "patcher": gen},
    ])
    ref = refpage(fake_max / "docs" / "refpages" / "max-ref", "metro")
    box = importobjs.get_shipped_obj_info([ref], ["metro"])["metro"]["box"]
    assert (box["numinlets"], box["numoutlets"]) == (2, 1)


def test_an_object_in_no_shipped_patch_gets_its_refpage_counts(fake_max, capsys):
    patch_file(fake_max / "help" / "a.maxhelp", [newobj("metro", 2, 1, ["bang"])])
    ref = refpage(fake_max / "docs" / "refpages" / "max-ref", "rare~", inlets=2, outlets=1)
    box = importobjs.get_shipped_obj_info([ref], ["rare~"])["rare~"]["box"]
    assert (box["numinlets"], box["numoutlets"], box["outlettype"]) == (2, 1, [""])
    assert "rare~ has no usable box" in capsys.readouterr().out


def test_shipped_defaults_count_only_the_newest_max_version(fake_max):
    # an object can gain an outlet between versions; old patches must not outvote the new one
    write_patch(fake_max / "old" / "a.maxpat", [newobj("remote~", 2, 0)] * 4, major=8)
    write_patch(fake_max / "help" / "remote~.maxhelp", [newobj("remote~", 2, 1, [""])] * 3, major=9)
    box = shipped_box(fake_max, "remote~")
    assert (box["numinlets"], box["numoutlets"], box["outlettype"]) == (2, 1, [""])


def test_shipped_defaults_prefer_the_shape_the_refpage_documents(fake_max):
    # boxes that set an attribute hiding the inlet outnumber the plain ones
    hidden = {"maxclass": "note", "numinlets": 0, "numoutlets": 0, "suppressinlet": 1,
              "patching_rect": [0.0, 0.0, 60.0, 20.0]}
    plain = {"maxclass": "note", "numinlets": 1, "numoutlets": 0, "patching_rect": [0.0, 0.0, 60.0, 20.0]}
    write_patch(fake_max / "help" / "note.maxhelp", [hidden] * 5 + [plain] * 2)
    assert shipped_box(fake_max, "note", inlets=1)["numinlets"] == 1
    # with no shape matching the refpage, the most common one stands
    assert shipped_box(fake_max, "note", inlets=3)["numinlets"] == 0


def test_shipped_defaults_do_not_take_counts_from_boxes_with_arguments(fake_max, capsys):
    # every shipped scissors has arguments, and its outlets follow them
    write_patch(fake_max / "help" / "a.maxhelp",
                [newobj("scissors 2 2", 1, 5, ["m"] * 5)] * 8 + [newobj("scissors 4 2", 1, 9, ["m"] * 9)] * 3)
    box = shipped_box(fake_max, "scissors", inlets=1, outlets=2)
    assert (box["numinlets"], box["numoutlets"], box["outlettype"]) == (1, 2, ["", ""])
    assert "scissors has no usable box" in capsys.readouterr().out
    # a box with arguments whose counts are the refpage's still gives the outlet types
    box = shipped_box(fake_max, "scissors", inlets=1, outlets=5)
    assert (box["numoutlets"], box["outlettype"]) == (5, ["m"] * 5)


def test_shipped_defaults_break_a_tie_the_same_way_every_time(fake_max):
    write_patch(fake_max / "help" / "a.maxhelp", [newobj("twist~", 1, 1, ["signal"]), newobj("twist~", 2, 1, ["signal"])])
    assert shipped_box(fake_max, "twist~", inlets=2, outlets=1)["numinlets"] == 2
    assert shipped_box(fake_max, "twist~", inlets=5, outlets=5)["numinlets"] == 1


def test_import_rejects_an_unknown_defaults_source():
    with pytest.raises(ValueError, match="defaults"):
        importobjs.import_objs("max", defaults="guess")
