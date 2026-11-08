"""Generated files in maxpylang/objects match what their generators produce now."""

from pathlib import Path

import pytest

from maxpylang.importobjs import build_objects_init
from maxpylang.tools import typedstubs

OBJECTS = Path(__file__).resolve().parents[1] / "maxpylang" / "objects"


def test_objects_init_matches_generator():
    assert (OBJECTS / "__init__.py").read_text() == build_objects_init(["jit", "max", "msp"])


@pytest.mark.parametrize("package", typedstubs.PACKAGES)
def test_type_stubs_match_generator(package):
    expected = typedstubs.build_pyi(package, typedstubs.load_xlet_types())
    assert (OBJECTS / f"{package}.pyi").read_text() == expected, (
        "stale: run `python -m maxpylang.tools.typedstubs`"
    )


def test_objects_init_type_stub_matches_generator():
    assert (OBJECTS / "__init__.pyi").read_text() == typedstubs.build_init_pyi()


def test_pyi_types_fixed_and_open_counts():
    xlet_types = {"msp": {
        "cycle~": {"ins": ["any", "any"], "outs": ["signal"]},
        "dac~": {"ins": "any", "outs": []},
    }}
    pyi = typedstubs.build_pyi("msp", xlet_types)
    assert "def ins(self) -> tuple[Inlet[Signal | Control], Inlet[Signal | Control]]: ..." in pyi
    assert "def outs(self) -> tuple[Outlet[Signal]]: ..." in pyi
    assert "def ins(self) -> tuple[Inlet[Signal | Control], ...]: ..." in pyi
    assert "def outs(self) -> tuple[()]: ..." in pyi
    assert "cycle_tilde: _T_cycle_tilde" in pyi


def test_pyi_falls_back_to_any_for_objects_without_data():
    pyi = typedstubs.build_pyi("msp", {"msp": {}})
    assert "class _T_cycle_tilde(MaxObject):" in pyi
    assert "def ins(self) -> tuple[Inlet[Any], ...]: ..." in pyi


@pytest.mark.parametrize("package", typedstubs.PACKAGES)
def test_fixed_counts_agree_with_runtime(package):
    disagree = []
    for name, types in typedstubs.load_xlet_types()[package].items():
        counts = typedstubs.runtime_xlet_counts(package, name)
        if counts is None:
            counts = (0, 0)  # not in a clean install's object database: no xlets at runtime
        for side, count in zip(("ins", "outs"), counts):
            if isinstance(types[side], list) and len(types[side]) != count:
                disagree.append((name, side, len(types[side]), count))
    assert disagree == []


@pytest.mark.parametrize("package", typedstubs.PACKAGES)
def test_counts_that_change_with_arguments_at_runtime_are_open(package):
    fixed = [(name, side) for name, types in typedstubs.load_xlet_types()[package].items()
             for side in typedstubs.runtime_rule_sides(package, name)
             if isinstance(types[side], list)]
    assert fixed == []


@pytest.mark.parametrize("package", typedstubs.PACKAGES)
def test_each_stub_docstring_describes_its_own_object(package):
    stubs = typedstubs.read_stub_module(package)
    missing = [py_name for py_name, _, doc in stubs if not doc]
    wrong = [(py_name, max_name) for py_name, max_name, doc in stubs
             if doc and doc.strip().splitlines()[0].split(" - ")[0] != max_name]
    assert (missing, wrong) == ([], [])


def test_stub_module_puts_each_docstring_after_its_stub():
    from maxpylang.importobjs import build_stub_module

    text = build_stub_module("msp", {"cycle_tilde": "cycle~"},
                             {"cycle~": {"doc": {"digest": "Sinusoidal oscillator"}}})
    assert "cycle_tilde = MaxObject('cycle~')\n\"\"\"\ncycle~ - Sinusoidal oscillator\n\"\"\"" in text
