"""
Backward compatibility test suite for MaxPyLang.
Ensures the new M4L/.amxd changes don't break any existing functionality.

Run with: python -m pytest tests/test_backward_compat.py -v
"""

import json
import os
import sys
import tempfile
import warnings

import pytest

# Ensure maxpylang is importable from the project root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ============================================================
# TEST 1: Import
# ============================================================

class TestImport:
    def test_import_maxpylang(self):
        """import maxpylang as mp — core classes present."""
        import maxpylang as mp
        assert hasattr(mp, "MaxPatch")
        assert hasattr(mp, "MaxObject")
        assert hasattr(mp, "Inlet")
        assert hasattr(mp, "Outlet")
        assert hasattr(mp, "import_objs")
        assert hasattr(mp, "save_amxd")
        assert hasattr(mp, "load_amxd")
        assert hasattr(mp, "DEVICE_TYPES")

    def test_import_objects(self):
        """from maxpylang.objects import stubs."""
        from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, toggle
        assert cycle_tilde is not None
        assert ezdac_tilde is not None
        assert metro is not None
        assert toggle is not None


# ============================================================
# TEST 2: Basic patch creation and save
# ============================================================

class TestBasicPatchCreation:
    def test_create_place_connect_save(self, tmp_path):
        """Create a MaxPatch, place objects, connect them, save as .maxpat."""
        import maxpylang as mp

        patch = mp.MaxPatch(verbose=False)
        osc = patch.place("cycle~ 440", verbose=False)[0]
        dac = patch.place("ezdac~", verbose=False)[0]
        patch.connect([osc.outs[0], dac.ins[0]], verbose=False)

        out = str(tmp_path / "test_basic.maxpat")
        patch.save(out, verbose=False, check=False)

        assert os.path.exists(out)
        with open(out, "r") as f:
            data = json.load(f)
        assert "patcher" in data
        assert len(data["patcher"]["boxes"]) == 2
        assert len(data["patcher"]["lines"]) == 1


# ============================================================
# TEST 3: All save() variations
# ============================================================

class TestSaveVariations:
    def test_save_no_extension(self, tmp_path):
        """save('foo') auto-appends .maxpat."""
        import maxpylang as mp
        os.chdir(tmp_path)

        patch = mp.MaxPatch(verbose=False)
        patch.place("toggle", verbose=False)
        patch.save("foo", verbose=False, check=False)
        assert os.path.exists(tmp_path / "foo.maxpat")

    def test_save_with_extension(self, tmp_path):
        """save('bar.maxpat') explicit extension."""
        import maxpylang as mp

        out = str(tmp_path / "bar.maxpat")
        patch = mp.MaxPatch(verbose=False)
        patch.place("toggle", verbose=False)
        patch.save(out, verbose=False, check=False)
        assert os.path.exists(out)

    def test_save_verbose_false(self, tmp_path, capsys):
        """save(verbose=False) suppresses output."""
        import maxpylang as mp

        out = str(tmp_path / "verbose_test.maxpat")
        patch = mp.MaxPatch(verbose=False)
        patch.place("toggle", verbose=False)
        patch.save(out, verbose=False, check=False)
        captured = capsys.readouterr()
        assert "saved" not in captured.out.lower()

    def test_save_verbose_true(self, tmp_path, capsys):
        """save(verbose=True) prints save message."""
        import maxpylang as mp

        out = str(tmp_path / "verbose_true_test.maxpat")
        patch = mp.MaxPatch(verbose=False)
        patch.place("toggle", verbose=False)
        patch.save(out, verbose=True, check=False)
        captured = capsys.readouterr()
        assert "saved" in captured.out.lower()

    def test_save_check_false(self, tmp_path):
        """save(check=False) skips checking."""
        import maxpylang as mp

        out = str(tmp_path / "check_false.maxpat")
        patch = mp.MaxPatch(verbose=False)
        patch.place("toggle", verbose=False)
        patch.save(out, verbose=False, check=False)
        assert os.path.exists(out)

    def test_save_check_true(self, tmp_path):
        """save(check=True) runs checking without errors."""
        import maxpylang as mp

        out = str(tmp_path / "check_true.maxpat")
        patch = mp.MaxPatch(verbose=False)
        patch.place("toggle", verbose=False)
        patch.save(out, verbose=False, check=True)
        assert os.path.exists(out)


# ============================================================
# TEST 4: Loading existing .maxpat files
# ============================================================

class TestLoadFile:
    def test_load_maxpat(self, tmp_path):
        """MaxPatch(load_file=...) loads .maxpat correctly."""
        import maxpylang as mp

        # Create a patch to load
        out = str(tmp_path / "to_load.maxpat")
        patch1 = mp.MaxPatch(verbose=False)
        osc = patch1.place("cycle~ 440", verbose=False)[0]
        dac = patch1.place("ezdac~", verbose=False)[0]
        patch1.connect([osc.outs[0], dac.ins[0]], verbose=False)
        patch1.save(out, verbose=False, check=False)

        # Load it back
        patch2 = mp.MaxPatch(load_file=out, verbose=False)
        assert patch2.num_objs == 2
        obj_names = [obj.name for obj in patch2.objs.values()]
        assert "cycle~" in obj_names
        assert "ezdac~" in obj_names

    def test_load_existing_example(self):
        """Load an existing example .maxpat from the repo."""
        import maxpylang as mp

        example = os.path.join(
            os.path.dirname(__file__),
            "..",
            "examples",
            "random_pitch_generator",
            "tester3.maxpat",
        )
        if not os.path.exists(example):
            pytest.skip("Example file not found")

        patch = mp.MaxPatch(load_file=example, verbose=False)
        assert patch.num_objs > 0

    def test_load_and_resave_roundtrip(self, tmp_path):
        """Load-and-resave roundtrip preserves objects and connections."""
        import maxpylang as mp

        orig_path = str(tmp_path / "roundtrip_orig.maxpat")
        resave_path = str(tmp_path / "roundtrip_resave.maxpat")

        patch1 = mp.MaxPatch(verbose=False)
        m = patch1.place("metro 500", verbose=False)[0]
        t = patch1.place("toggle", verbose=False)[0]
        patch1.connect([t.outs[0], m.ins[0]], verbose=False)
        patch1.save(orig_path, verbose=False, check=False)

        patch2 = mp.MaxPatch(load_file=orig_path, verbose=False)
        patch2.save(resave_path, verbose=False, check=False)

        with open(orig_path) as f:
            orig = json.load(f)
        with open(resave_path) as f:
            resaved = json.load(f)

        assert len(orig["patcher"]["boxes"]) == len(resaved["patcher"]["boxes"])
        assert len(orig["patcher"]["lines"]) == len(resaved["patcher"]["lines"])


# ============================================================
# TEST 5: Object placement
# ============================================================

class TestPlacement:
    def test_place_string_returns_list(self):
        """place() with string returns list of MaxObject."""
        import maxpylang as mp

        patch = mp.MaxPatch(verbose=False)
        objs = patch.place("cycle~ 440", verbose=False)
        assert isinstance(objs, list)
        assert len(objs) == 1
        assert objs[0].name == "cycle~"

    def test_place_num_objs(self):
        """place() with num_objs=5 returns 5 objects."""
        import maxpylang as mp

        patch = mp.MaxPatch(verbose=False)
        toggles = patch.place("toggle", num_objs=5, verbose=False)
        assert len(toggles) == 5
        for t in toggles:
            assert t.name == "toggle"

    def test_place_starting_pos(self):
        """place() with starting_pos places objects offset from given position.

        Grid placement adds spacing before the first object, so with
        starting_pos=[100, 200] and default spacing=[80, 80], the first
        object is at x=180, y=200.
        """
        import maxpylang as mp

        patch = mp.MaxPatch(verbose=False)
        objs = patch.place("toggle", num_objs=3, starting_pos=[100, 200], verbose=False)
        assert len(objs) == 3
        # Grid spacing adds x_space before first object
        first_pos = objs[0]._dict["box"]["patching_rect"][:2]
        assert first_pos[0] == 180.0  # 100 + 80 (default x spacing)
        assert first_pos[1] == 200.0

    def test_place_stub_object(self):
        """place() with stub object works."""
        from maxpylang.objects import cycle_tilde
        import maxpylang as mp

        patch = mp.MaxPatch(verbose=False)
        osc = patch.place(cycle_tilde, verbose=False)[0]
        assert osc.name == "cycle~"

    def test_place_spacing_grid(self):
        """place() with spacing_type='grid'."""
        import maxpylang as mp

        patch = mp.MaxPatch(verbose=False)
        objs = patch.place(
            "toggle", num_objs=4, spacing_type="grid",
            spacing=[100, 100], starting_pos=[0, 0], verbose=False
        )
        assert len(objs) == 4

    def test_place_spacing_vertical(self):
        """place() with spacing_type='vertical' (spacing must be a scalar)."""
        import maxpylang as mp

        patch = mp.MaxPatch(verbose=False)
        objs = patch.place(
            "toggle", num_objs=3, spacing_type="vertical",
            spacing=80, starting_pos=[0, 0], verbose=False
        )
        assert len(objs) == 3


# ============================================================
# TEST 6: Connections
# ============================================================

class TestConnections:
    def test_single_connection(self):
        """Single connection wires correctly."""
        import maxpylang as mp

        patch = mp.MaxPatch(verbose=False)
        a = patch.place("toggle", verbose=False)[0]
        b = patch.place("metro 500", verbose=False)[0]
        patch.connect([a.outs[0], b.ins[0]], verbose=False)
        assert len(a.outs[0].destinations) == 1
        assert a.outs[0].destinations[0].parent is b

    def test_multiple_connections(self):
        """Multiple connections in one call."""
        import maxpylang as mp

        patch = mp.MaxPatch(verbose=False)
        osc = patch.place("cycle~ 440", verbose=False)[0]
        gain = patch.place("gain~", verbose=False)[0]
        dac = patch.place("ezdac~", verbose=False)[0]
        patch.connect(
            [osc.outs[0], gain.ins[0]],
            [gain.outs[0], dac.ins[0]],
            [gain.outs[0], dac.ins[1]],
            verbose=False,
        )
        assert len(osc.outs[0].destinations) == 1
        assert len(gain.outs[0].destinations) == 2


# ============================================================
# TEST 7: Common objects — inlets/outlets
# ============================================================

class TestCommonObjects:
    def test_cycle_tilde(self):
        """cycle~ has inlets and outlets."""
        import maxpylang as mp
        obj = mp.MaxObject("cycle~ 440")
        assert obj.name == "cycle~"
        assert len(obj.ins) > 0
        assert len(obj.outs) > 0

    def test_ezdac_tilde(self):
        """ezdac~ has >= 2 inlets."""
        import maxpylang as mp
        obj = mp.MaxObject("ezdac~")
        assert obj.name == "ezdac~"
        assert len(obj.ins) >= 2

    def test_metro(self):
        """metro has inlets and outlets."""
        import maxpylang as mp
        obj = mp.MaxObject("metro 500")
        assert obj.name == "metro"
        assert len(obj.ins) >= 1
        assert len(obj.outs) >= 1

    def test_toggle(self):
        """toggle has inlets and outlets."""
        import maxpylang as mp
        obj = mp.MaxObject("toggle")
        assert obj.name == "toggle"
        assert len(obj.ins) >= 1
        assert len(obj.outs) >= 1

    def test_pack(self):
        """pack has inlets and outlets."""
        import maxpylang as mp
        obj = mp.MaxObject("pack 0 0 0")
        assert obj.name == "pack"
        assert len(obj.ins) >= 1
        assert len(obj.outs) >= 1

    def test_trigger(self):
        """trigger b i f has 3 outlets."""
        import maxpylang as mp
        obj = mp.MaxObject("trigger b i f")
        assert obj.name == "trigger"
        assert len(obj.ins) >= 1
        assert len(obj.outs) == 3

    def test_metro_with_attribs(self):
        """metro with @active attribute parses correctly."""
        import maxpylang as mp
        obj = mp.MaxObject("metro 500 @active 1")
        assert obj.name == "metro"


# ============================================================
# TEST 8: Abstractions
# ============================================================

class TestAbstractions:
    def test_abstraction_basic(self):
        """MaxObject(abstraction=True, inlets=2, outlets=2) declares abstraction."""
        import maxpylang as mp
        obj = mp.MaxObject("my_synth", abstraction=True, inlets=2, outlets=2)
        assert obj.name == "my_synth"
        assert len(obj.ins) == 2
        assert len(obj.outs) == 2
        assert obj.notknown() is False

    def test_abstraction_with_args(self):
        """Abstraction with arguments."""
        import maxpylang as mp
        obj = mp.MaxObject("my_synth 440 0.5", abstraction=True, inlets=2, outlets=2)
        assert obj.name == "my_synth"
        assert len(obj.ins) == 2
        assert len(obj.outs) == 2

    def test_abstraction_place(self):
        """Place abstraction in patch."""
        import maxpylang as mp
        patch = mp.MaxPatch(verbose=False)
        obj = mp.MaxObject("my_fx", abstraction=True, inlets=1, outlets=1)
        placed = patch.place(obj, verbose=False)[0]
        assert placed.name == "my_fx"
        assert len(placed.ins) == 1
        assert len(placed.outs) == 1

    def test_abstraction_default_io(self):
        """Abstraction with default I/O (0, 0)."""
        import maxpylang as mp
        obj = mp.MaxObject("no_io_synth", abstraction=True)
        assert obj.name == "no_io_synth"
        assert len(obj.ins) == 0
        assert len(obj.outs) == 0


# ============================================================
# TEST 9: Edge case — save with device_type=None
# ============================================================

class TestDeviceTypeNone:
    def test_save_device_type_none(self, tmp_path):
        """save(device_type=None) produces .maxpat (not .amxd)."""
        import maxpylang as mp

        out = str(tmp_path / "devnone.maxpat")
        patch = mp.MaxPatch(verbose=False)
        patch.place("toggle", verbose=False)
        patch.save(out, device_type=None, verbose=False, check=False)
        assert os.path.exists(out)
        # Verify it's valid JSON (not binary amxd)
        with open(out, "r") as f:
            data = json.load(f)
        assert "patcher" in data

    def test_save_no_ext_device_type_none(self, tmp_path):
        """save('foo', device_type=None) auto-appends .maxpat."""
        import maxpylang as mp
        os.chdir(tmp_path)

        patch = mp.MaxPatch(verbose=False)
        patch.place("toggle", verbose=False)
        patch.save("foo2", device_type=None, verbose=False, check=False)
        assert os.path.exists(tmp_path / "foo2.maxpat")
        with open(tmp_path / "foo2.maxpat", "r") as f:
            data = json.load(f)
        assert "patcher" in data

    def test_save_amxd_without_device_type_raises(self, tmp_path):
        """save('test.amxd') without device_type raises ValueError."""
        import maxpylang as mp

        out = str(tmp_path / "test.amxd")
        patch = mp.MaxPatch(verbose=False)
        patch.place("toggle", verbose=False)
        with pytest.raises(ValueError, match="device_type"):
            patch.save(out, verbose=False, check=False)


# ============================================================
# TEST 10: set_position
# ============================================================

class TestSetPosition:
    def test_set_position(self):
        """set_position works correctly."""
        import maxpylang as mp
        patch = mp.MaxPatch(verbose=False)
        patch.set_position(100, 200)
        assert patch.curr_position == [100, 200]


# ============================================================
# TEST 11: Patch properties
# ============================================================

class TestPatchProperties:
    def test_objs_and_num_objs(self):
        """patch.objs and patch.num_objs are correct."""
        import maxpylang as mp
        patch = mp.MaxPatch(verbose=False)
        assert isinstance(patch.objs, dict)
        assert patch.num_objs == 0
        patch.place("toggle", verbose=False)
        assert patch.num_objs == 1
        assert len(patch.objs) == 1


# ============================================================
# TEST 12: MaxObject methods
# ============================================================

class TestMaxObjectMethods:
    def test_move(self):
        """obj.move(x, y) repositions object."""
        import maxpylang as mp
        obj = mp.MaxObject("toggle")
        obj.move(150, 250)
        rect = obj._dict["box"]["patching_rect"]
        assert rect[0] == 150.0
        assert rect[1] == 250.0

    def test_edit(self):
        """obj.edit() changes object text."""
        import maxpylang as mp
        obj = mp.MaxObject("metro 500")
        obj.edit(text_add="replace", text="metro 1000")
        assert obj.name == "metro"

    def test_notknown_for_known_object(self):
        """obj.notknown() returns False for known objects."""
        import maxpylang as mp
        obj = mp.MaxObject("toggle")
        assert obj.notknown() is False


# ============================================================
# TEST 13: Full workflow (docs examples)
# ============================================================

class TestFullWorkflow:
    def test_audio_chain(self, tmp_path):
        """Full audio chain from docs example."""
        from maxpylang.objects import gain_tilde, ezdac_tilde
        import maxpylang as mp

        patch = mp.MaxPatch(verbose=False)
        osc = patch.place("cycle~ 440", verbose=False)[0]
        gain = patch.place(gain_tilde, verbose=False)[0]
        dac = patch.place(ezdac_tilde, verbose=False)[0]
        patch.connect(
            [osc.outs[0], gain.ins[0]],
            [gain.outs[0], dac.ins[0]],
            [gain.outs[0], dac.ins[1]],
            verbose=False,
        )
        out = str(tmp_path / "audio_chain_test.maxpat")
        patch.save(out, verbose=False, check=False)
        assert os.path.exists(out)
        with open(out) as f:
            data = json.load(f)
        assert len(data["patcher"]["boxes"]) == 3
        assert len(data["patcher"]["lines"]) == 3

    def test_loop_pattern(self, tmp_path):
        """Loop pattern from docs example."""
        import maxpylang as mp

        patch = mp.MaxPatch(verbose=False)
        n = 5
        toggles = patch.place("toggle", num_objs=n, starting_pos=[0, 100], verbose=False)
        gates = patch.place("gate", num_objs=n, starting_pos=[0, 200], verbose=False)
        for t, g in zip(toggles, gates):
            patch.connect([t.outs[0], g.ins[0]], verbose=False)
        out = str(tmp_path / "loop_test.maxpat")
        patch.save(out, verbose=False, check=False)
        assert os.path.exists(out)
        with open(out) as f:
            data = json.load(f)
        assert len(data["patcher"]["boxes"]) == 10
        assert len(data["patcher"]["lines"]) == 5


# ============================================================
# TEST 14: JSON output format correctness
# ============================================================

class TestJSONFormat:
    def test_json_structure(self):
        """get_json() returns proper .maxpat JSON structure."""
        import maxpylang as mp

        patch = mp.MaxPatch(verbose=False)
        osc = patch.place("cycle~ 440", verbose=False)[0]
        dac = patch.place("ezdac~", verbose=False)[0]
        patch.connect([osc.outs[0], dac.ins[0]], verbose=False)
        json_dict = patch.get_json()
        assert "patcher" in json_dict
        assert "boxes" in json_dict["patcher"]
        assert "lines" in json_dict["patcher"]
        # Check boxes have required fields
        for box in json_dict["patcher"]["boxes"]:
            assert "box" in box
            assert "id" in box["box"]
            assert "patching_rect" in box["box"]
        # Check lines have required fields
        for line in json_dict["patcher"]["lines"]:
            assert "patchline" in line
            assert "source" in line["patchline"]
            assert "destination" in line["patchline"]
