"""How a Max signature row becomes static inlet/outlet rates."""

from maxpylang.tools.typedstubs import object_types


def sig(inlets, outlets, methods=("int", "float"), in_kind="fixed", out_kind="fixed"):
    arity = {"inlets": {"kind": in_kind, "value": len(inlets)},
             "outlets": {"kind": out_kind, "value": len(outlets)}}
    return {"inlets": [{"rate": r} for r in inlets],
            "outlets": [{"type": t, "type_source": "patchers"} for t in outlets],
            "methods": list(methods), "arity": arity}


def test_control_inlet_without_signal_method_takes_no_audio():
    assert object_types("toggle", sig(["control"], ["int"]))["ins"] == ["control"]


def test_inlet_of_object_with_signal_method_stays_open():
    row = sig(["control", "signal|control"], ["signal"], methods=("signal", "float"))
    assert object_types("cycle~", row) == {"ins": ["any", "any"], "outs": ["signal"]}


def test_inlet_of_object_without_documented_methods_stays_open():
    assert object_types("mystery", sig(["control"], [], methods=()))["ins"] == ["any"]


def test_outlet_types_map_to_rates():
    row = sig([], ["signal", "multichannelsignal", "jit_matrix", "", "bang"])
    assert object_types("x", row)["outs"] == ["signal", "mc", "matrix", "control", "control"]


def test_argument_dependent_count_keeps_a_shared_rate():
    row = sig(["signal|control"], ["signal", "signal"], in_kind="arg_dependent", out_kind="arg_dependent")
    assert object_types("adc~", row) == {"ins": "any", "outs": "signal"}


def test_argument_dependent_audio_outlets_need_saved_patch_evidence():
    # play~'s refpage lists two signal outlets, but the last one sends a bang when done
    row = sig(["control"], ["signal", "signal"], methods=("signal",), out_kind="arg_dependent")
    for outlet in row["outlets"]:
        outlet["type_source"] = "refpage"
    assert object_types("play~", row)["outs"] == "any"


def test_argument_dependent_count_with_mixed_rates_is_open():
    row = sig(["control", "control"], ["signal", "bang"], out_kind="arg_dependent")
    assert object_types("line~", row)["outs"] == "any"


def test_containers_are_open_on_both_sides():
    row = sig(["control"], ["signal"], in_kind="content", out_kind="content")
    assert object_types("bpatcher", row) == {"ins": "any", "outs": "any"}


def test_inlet_and_outlet_objects_pass_audio():
    assert object_types("outlet", sig(["control"], [])) == {"ins": ["any"], "outs": []}
    assert object_types("inlet", sig([], ["control"])) == {"ins": [], "outs": ["any"]}


def test_refpage_audio_outlet_that_sends_a_bang_is_control():
    # mc.sfplay~'s refpage types its done-bang outlet as a signal
    row = sig(["control"], ["multichannelsignal", "signal"], methods=("signal",))
    row["outlets"][1].update(type_source="refpage", digest="bang When Done Playing")
    assert object_types("mc.sfplay~", row)["outs"] == ["mc", "control"]


def test_refpage_audio_dumpout_outlet_is_control():
    row = sig(["control"], ["signal", "signal"], methods=("signal",))
    row["outlets"][1].update(type_source="refpage", digest="dumpout")
    assert object_types("jit.peek~", row)["outs"] == ["signal", "control"]


def test_saved_audio_outlet_stays_audio_whatever_its_digest():
    row = sig(["control"], ["signal"], methods=("signal",))
    row["outlets"][0]["digest"] = "bang-rate pulse train"
    assert object_types("x~", row)["outs"] == ["signal"]
