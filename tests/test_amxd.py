"""
Exhaustive tests for Max for Live (.amxd) support in MaxPyLang.

Tests:
1. Save all 3 device types
2. Binary format validation
3. Round-trip for each device type
4. Extension handling edge cases
5. Standalone functions (save_amxd / load_amxd)
6. M4L I/O objects
7. Complex M4L instrument patch
8. Example files execution
"""

import os
import sys
import json
import struct
import tempfile
import warnings

import pytest

# Ensure the package is importable from the repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import maxpylang as mp
from maxpylang.amxd import save_amxd, load_amxd, DEVICE_TYPES


@pytest.fixture
def tmpdir_amxd(tmp_path):
    """Return a temporary directory path for test outputs."""
    return tmp_path


def _make_simple_patch():
    """Create a simple patch with one oscillator and one dac."""
    patch = mp.MaxPatch(verbose=False)
    osc = patch.place("cycle~ 440", verbose=False)[0]
    dac = patch.place("ezdac~", verbose=False)[0]
    patch.connect([osc.outs[0], dac.ins[0]], verbose=False)
    return patch


# =====================================================================
# TEST 1: Save all 3 device types
# =====================================================================

class TestSaveAllDeviceTypes:
    @pytest.mark.parametrize("device_type", ["instrument", "audio_effect", "midi_effect"])
    def test_save_device_type(self, tmpdir_amxd, device_type):
        """Each device type should produce a valid .amxd binary file."""
        patch = _make_simple_patch()
        filename = str(tmpdir_amxd / f"test_{device_type}.amxd")
        patch.save(filename, device_type=device_type, verbose=False, check=False)

        assert os.path.exists(filename), f"File not created: {filename}"
        fsize = os.path.getsize(filename)
        assert fsize > 0, f"File is empty: {filename}"
        # Minimum: ampf(12) + meta(12) + ptch(8 + json) > 32 bytes
        assert fsize > 32, f"File too small ({fsize} bytes), likely malformed"


# =====================================================================
# TEST 2: Binary format validation
# =====================================================================

class TestBinaryFormatValidation:
    @pytest.mark.parametrize("device_type,expected_code", [
        ("instrument", b"iiii"),
        ("audio_effect", b"aaaa"),
        ("midi_effect", b"mmmm"),
    ])
    def test_ampf_chunk_device_code(self, tmpdir_amxd, device_type, expected_code):
        """ampf chunk must contain the correct 4-byte device code."""
        patch = _make_simple_patch()
        filename = str(tmpdir_amxd / f"test_{device_type}.amxd")
        patch.save(filename, device_type=device_type, verbose=False, check=False)

        with open(filename, "rb") as f:
            data = f.read()

        # ampf chunk starts at byte 0
        assert data[:4] == b"ampf", f"First chunk is not 'ampf': {data[:4]}"
        ampf_size = struct.unpack("<I", data[4:8])[0]
        assert ampf_size == 4, f"ampf chunk size should be 4, got {ampf_size}"
        device_code = data[8:12]
        assert device_code == expected_code, (
            f"Device code mismatch for {device_type}: "
            f"expected {expected_code}, got {device_code}"
        )

    @pytest.mark.parametrize("device_type", ["instrument", "audio_effect", "midi_effect"])
    def test_meta_chunk_exists(self, tmpdir_amxd, device_type):
        """meta chunk must exist after ampf chunk with 4 null bytes."""
        patch = _make_simple_patch()
        filename = str(tmpdir_amxd / f"test_{device_type}.amxd")
        patch.save(filename, device_type=device_type, verbose=False, check=False)

        with open(filename, "rb") as f:
            data = f.read()

        # meta chunk starts at byte 12 (after ampf: 4+4+4)
        assert data[12:16] == b"meta", f"Second chunk is not 'meta': {data[12:16]}"
        meta_size = struct.unpack("<I", data[16:20])[0]
        assert meta_size == 4, f"meta chunk size should be 4, got {meta_size}"
        meta_payload = data[20:24]
        assert meta_payload == b"\x00\x00\x00\x00", (
            f"meta payload should be 4 null bytes, got {meta_payload!r}"
        )

    @pytest.mark.parametrize("device_type", ["instrument", "audio_effect", "midi_effect"])
    def test_ptch_chunk_contains_valid_json(self, tmpdir_amxd, device_type):
        """ptch chunk must contain valid JSON with a patcher key."""
        patch = _make_simple_patch()
        filename = str(tmpdir_amxd / f"test_{device_type}.amxd")
        patch.save(filename, device_type=device_type, verbose=False, check=False)

        with open(filename, "rb") as f:
            data = f.read()

        # ptch chunk starts at byte 24 (after ampf:12 + meta:12)
        assert data[24:28] == b"ptch", f"Third chunk is not 'ptch': {data[24:28]}"
        ptch_size = struct.unpack("<I", data[28:32])[0]
        json_bytes = data[32:32 + ptch_size]

        # Null-terminated
        assert json_bytes[-1:] == b"\x00", "ptch payload should be null-terminated"

        # Parse JSON
        json_str = json_bytes.rstrip(b"\x00").decode("utf-8")
        patcher_dict = json.loads(json_str)
        assert "patcher" in patcher_dict, "JSON must contain 'patcher' key"
        assert "boxes" in patcher_dict["patcher"], "patcher must contain 'boxes'"
        assert "lines" in patcher_dict["patcher"], "patcher must contain 'lines'"

    @pytest.mark.parametrize("device_type", ["instrument", "audio_effect", "midi_effect"])
    def test_full_binary_structure(self, tmpdir_amxd, device_type):
        """Entire file should be exactly ampf(12) + meta(12) + ptch(8+N) bytes."""
        patch = _make_simple_patch()
        filename = str(tmpdir_amxd / f"test_{device_type}.amxd")
        patch.save(filename, device_type=device_type, verbose=False, check=False)

        with open(filename, "rb") as f:
            data = f.read()

        ptch_size = struct.unpack("<I", data[28:32])[0]
        expected_total = 12 + 12 + 8 + ptch_size
        assert len(data) == expected_total, (
            f"File size mismatch: expected {expected_total}, got {len(data)}"
        )


# =====================================================================
# TEST 3: Round-trip for each device type
# =====================================================================

class TestRoundTrip:
    @pytest.mark.parametrize("device_type", ["instrument", "audio_effect", "midi_effect"])
    def test_round_trip_amxd(self, tmpdir_amxd, device_type):
        """save .amxd -> load -> verify objects match -> re-save as .maxpat -> verify JSON identical."""
        # Create and save
        patch1 = _make_simple_patch()
        amxd_file = str(tmpdir_amxd / f"rt_{device_type}.amxd")
        patch1.save(amxd_file, device_type=device_type, verbose=False, check=False)

        # Load back from .amxd
        patch2 = mp.MaxPatch(load_file=amxd_file, verbose=False)

        # Verify same number of objects
        assert patch2.num_objs == patch1.num_objs, (
            f"Object count mismatch: original={patch1.num_objs}, loaded={patch2.num_objs}"
        )

        # Verify object names match
        orig_names = sorted(obj.name for obj in patch1.objs.values())
        loaded_names = sorted(obj.name for obj in patch2.objs.values())
        assert orig_names == loaded_names, (
            f"Object names mismatch: {orig_names} vs {loaded_names}"
        )

        # Re-save as .maxpat
        maxpat_file = str(tmpdir_amxd / f"rt_{device_type}.maxpat")
        patch2.save(maxpat_file, verbose=False, check=False)

        # Also re-save original as .maxpat
        maxpat_orig = str(tmpdir_amxd / f"rt_{device_type}_orig.maxpat")
        patch1.save(maxpat_orig, verbose=False, check=False)

        # Load both and compare JSON structure
        with open(maxpat_file, "r") as f:
            json2 = json.load(f)
        with open(maxpat_orig, "r") as f:
            json1 = json.load(f)

        # Compare box counts
        assert len(json1["patcher"]["boxes"]) == len(json2["patcher"]["boxes"]), (
            f"Box count mismatch in JSON: {len(json1['patcher']['boxes'])} vs {len(json2['patcher']['boxes'])}"
        )
        # Compare line counts
        assert len(json1["patcher"]["lines"]) == len(json2["patcher"]["lines"]), (
            f"Line count mismatch in JSON: {len(json1['patcher']['lines'])} vs {len(json2['patcher']['lines'])}"
        )


# =====================================================================
# TEST 4: Extension handling edge cases
# =====================================================================

class TestExtensionHandling:
    def test_amxd_extension_with_device_type(self, tmpdir_amxd):
        """save('foo.amxd', device_type='instrument') -> saves as .amxd."""
        patch = _make_simple_patch()
        filename = str(tmpdir_amxd / "foo.amxd")
        patch.save(filename, device_type="instrument", verbose=False, check=False)
        assert os.path.exists(filename)

    def test_no_extension_with_device_type(self, tmpdir_amxd):
        """save('foo', device_type='instrument') -> forces .amxd extension."""
        patch = _make_simple_patch()
        filename = str(tmpdir_amxd / "foo")
        patch.save(filename, device_type="instrument", verbose=False, check=False)
        expected = str(tmpdir_amxd / "foo.amxd")
        assert os.path.exists(expected), (
            f"Expected {expected} to be created. "
            f"Files: {os.listdir(tmpdir_amxd)}"
        )

    def test_maxpat_extension_with_device_type_changes_to_amxd(self, tmpdir_amxd):
        """save('foo.maxpat', device_type='instrument') -> changes to .amxd."""
        patch = _make_simple_patch()
        filename = str(tmpdir_amxd / "foo.maxpat")
        patch.save(filename, device_type="instrument", verbose=False, check=False)
        expected = str(tmpdir_amxd / "foo.amxd")
        assert os.path.exists(expected), (
            f"Expected {expected} to be created. "
            f"Files: {os.listdir(tmpdir_amxd)}"
        )

    def test_amxd_extension_without_device_type_raises(self, tmpdir_amxd):
        """save('foo.amxd') without device_type -> should raise ValueError."""
        patch = _make_simple_patch()
        filename = str(tmpdir_amxd / "foo.amxd")
        with pytest.raises(ValueError, match="device_type is required"):
            patch.save(filename, verbose=False, check=False)

    def test_invalid_device_type_raises(self, tmpdir_amxd):
        """save('foo.amxd', device_type='invalid_type') -> should raise error."""
        patch = _make_simple_patch()
        filename = str(tmpdir_amxd / "foo.amxd")
        with pytest.raises(ValueError):
            patch.save(filename, device_type="invalid_type", verbose=False, check=False)


# =====================================================================
# TEST 5: Standalone functions (save_amxd / load_amxd)
# =====================================================================

class TestStandaloneFunctions:
    def test_save_amxd_creates_file(self, tmpdir_amxd):
        """save_amxd() should write a binary file."""
        patcher_json = {
            "patcher": {
                "boxes": [],
                "lines": [],
            }
        }
        filename = str(tmpdir_amxd / "standalone.amxd")
        save_amxd(patcher_json, filename, device_type="instrument")
        assert os.path.exists(filename)
        assert os.path.getsize(filename) > 0

    def test_load_amxd_returns_json(self, tmpdir_amxd):
        """load_amxd() should return the same JSON dict that was saved."""
        patcher_json = {
            "patcher": {
                "boxes": [{"box": {"maxclass": "newobj", "text": "cycle~ 440"}}],
                "lines": [],
            }
        }
        filename = str(tmpdir_amxd / "standalone_rt.amxd")
        save_amxd(patcher_json, filename, device_type="audio_effect")

        loaded = load_amxd(filename)
        assert loaded == patcher_json, (
            f"JSON mismatch:\n  saved: {patcher_json}\n  loaded: {loaded}"
        )

    def test_save_amxd_invalid_device_type(self, tmpdir_amxd):
        """save_amxd() with bad device_type should raise ValueError."""
        patcher_json = {"patcher": {"boxes": [], "lines": []}}
        filename = str(tmpdir_amxd / "bad_type.amxd")
        with pytest.raises(ValueError, match="Unknown device_type"):
            save_amxd(patcher_json, filename, device_type="bogus")

    def test_load_amxd_no_ptch_raises(self, tmpdir_amxd):
        """load_amxd() on a file with no ptch chunk should raise ValueError."""
        filename = str(tmpdir_amxd / "no_ptch.amxd")
        with open(filename, "wb") as f:
            f.write(b"ampf")
            f.write(struct.pack("<I", 4))
            f.write(b"iiii")
            f.write(b"meta")
            f.write(struct.pack("<I", 4))
            f.write(b"\x00\x00\x00\x00")
            # No ptch chunk
        with pytest.raises(ValueError, match="No ptch chunk"):
            load_amxd(filename)

    def test_save_load_amxd_all_device_types(self, tmpdir_amxd):
        """Round-trip through standalone functions for each device type."""
        patcher_json = {
            "patcher": {
                "boxes": [
                    {"box": {"maxclass": "newobj", "text": "cycle~ 440"}},
                    {"box": {"maxclass": "newobj", "text": "ezdac~"}},
                ],
                "lines": [],
            }
        }
        for device_type in ["instrument", "audio_effect", "midi_effect"]:
            filename = str(tmpdir_amxd / f"standalone_{device_type}.amxd")
            save_amxd(patcher_json, filename, device_type=device_type)
            loaded = load_amxd(filename)
            assert loaded == patcher_json, f"Round-trip failed for {device_type}"

    def test_imports_from_toplevel(self):
        """save_amxd, load_amxd, and DEVICE_TYPES should be importable from maxpylang."""
        assert hasattr(mp, "save_amxd")
        assert hasattr(mp, "load_amxd")
        assert hasattr(mp, "DEVICE_TYPES")
        assert mp.DEVICE_TYPES == DEVICE_TYPES


# =====================================================================
# TEST 6: M4L I/O objects
# =====================================================================

class TestM4LIOObjects:
    def test_plugin_tilde(self):
        """plugin~ should create with proper inlet/outlet counts."""
        patch = mp.MaxPatch(verbose=False)
        obj = patch.place("plugin~", verbose=False)[0]
        assert obj.name == "plugin~"
        assert not obj.notknown(), "plugin~ should be a known object"
        assert len(obj.outs) >= 2, f"plugin~ should have >= 2 outlets, got {len(obj.outs)}"

    def test_plugout_tilde(self):
        """plugout~ should create with proper inlet/outlet counts."""
        patch = mp.MaxPatch(verbose=False)
        obj = patch.place("plugout~", verbose=False)[0]
        assert obj.name == "plugout~"
        assert not obj.notknown(), "plugout~ should be a known object"
        assert len(obj.ins) >= 2, f"plugout~ should have >= 2 inlets, got {len(obj.ins)}"

    def test_notein(self):
        """notein should create with proper inlet/outlet counts."""
        patch = mp.MaxPatch(verbose=False)
        obj = patch.place("notein", verbose=False)[0]
        assert obj.name == "notein"
        assert not obj.notknown(), "notein should be a known object"
        assert len(obj.outs) >= 3, f"notein should have >= 3 outlets (pitch, vel, channel), got {len(obj.outs)}"

    def test_midiin(self):
        """midiin should create correctly."""
        patch = mp.MaxPatch(verbose=False)
        obj = patch.place("midiin", verbose=False)[0]
        assert obj.name == "midiin"
        assert not obj.notknown(), "midiin should be a known object"
        assert len(obj.outs) >= 1, f"midiin should have >= 1 outlet, got {len(obj.outs)}"

    def test_midiout(self):
        """midiout should create correctly."""
        patch = mp.MaxPatch(verbose=False)
        obj = patch.place("midiout", verbose=False)[0]
        assert obj.name == "midiout"
        assert not obj.notknown(), "midiout should be a known object"
        assert len(obj.ins) >= 1, f"midiout should have >= 1 inlet, got {len(obj.ins)}"

    def test_midiparse(self):
        """midiparse should create correctly."""
        patch = mp.MaxPatch(verbose=False)
        obj = patch.place("midiparse", verbose=False)[0]
        assert obj.name == "midiparse"
        assert not obj.notknown(), "midiparse should be a known object"
        assert len(obj.outs) >= 1, f"midiparse should have >= 1 outlet, got {len(obj.outs)}"

    def test_midiformat(self):
        """midiformat should create correctly."""
        patch = mp.MaxPatch(verbose=False)
        obj = patch.place("midiformat", verbose=False)[0]
        assert obj.name == "midiformat"
        assert not obj.notknown(), "midiformat should be a known object"
        assert len(obj.ins) >= 1, f"midiformat should have >= 1 inlet, got {len(obj.ins)}"


# =====================================================================
# TEST 7: Complex M4L instrument patch
# =====================================================================

class TestComplexM4LPatch:
    def test_full_instrument_round_trip(self, tmpdir_amxd):
        """Build notein->mtof->cycle~->*~->clip~->plugout~, save as .amxd, load back, verify."""
        patch = mp.MaxPatch(verbose=False)

        # Build the chain
        patch.set_position(30, 60)
        notein = patch.place("notein", verbose=False)[0]

        patch.set_position(30, 100)
        mtof = patch.place("mtof", verbose=False)[0]

        patch.set_position(30, 140)
        osc = patch.place("cycle~", verbose=False)[0]

        patch.set_position(30, 180)
        mult = patch.place("*~ 0.5", verbose=False)[0]

        patch.set_position(30, 220)
        clip = patch.place("clip~ -1. 1.", verbose=False)[0]

        patch.set_position(30, 260)
        plugout = patch.place("plugout~", verbose=False)[0]

        # Connect the chain
        patch.connect(
            [notein.outs[0], mtof.ins[0]],
            [mtof.outs[0], osc.ins[0]],
            [osc.outs[0], mult.ins[0]],
            [mult.outs[0], clip.ins[0]],
            [clip.outs[0], plugout.ins[0]],
            [clip.outs[0], plugout.ins[1]],
            verbose=False,
        )

        # Verify objects were created
        expected_names = {"notein", "mtof", "cycle~", "*~", "clip~", "plugout~"}
        actual_names = {obj.name for obj in patch.objs.values()}
        assert expected_names == actual_names, (
            f"Object names mismatch: expected {expected_names}, got {actual_names}"
        )

        # Save as .amxd
        amxd_file = str(tmpdir_amxd / "complex_instrument.amxd")
        patch.save(amxd_file, device_type="instrument", verbose=False, check=False)
        assert os.path.exists(amxd_file)

        # Load back
        patch2 = mp.MaxPatch(load_file=amxd_file, verbose=False)

        # Verify same object count
        assert patch2.num_objs == patch.num_objs, (
            f"Object count mismatch after load: {patch.num_objs} vs {patch2.num_objs}"
        )

        # Verify object names survived
        loaded_names = {obj.name for obj in patch2.objs.values()}
        assert expected_names == loaded_names, (
            f"Object names after load: expected {expected_names}, got {loaded_names}"
        )

        # Verify connections survived - count total connections
        orig_connections = 0
        for obj in patch.objs.values():
            for outlet in obj.outs:
                orig_connections += len(outlet.destinations)

        loaded_connections = 0
        for obj in patch2.objs.values():
            for outlet in obj.outs:
                loaded_connections += len(outlet.destinations)

        assert orig_connections == loaded_connections, (
            f"Connection count mismatch: original={orig_connections}, loaded={loaded_connections}"
        )

        # Re-save as .maxpat and verify JSON is valid
        maxpat_file = str(tmpdir_amxd / "complex_instrument.maxpat")
        patch2.save(maxpat_file, verbose=False, check=False)
        with open(maxpat_file, "r") as f:
            json_data = json.load(f)
        assert len(json_data["patcher"]["boxes"]) == 6
        assert len(json_data["patcher"]["lines"]) == 6


# =====================================================================
# TEST 8: Run example files
# =====================================================================

class TestExampleFiles:
    def test_m4l_instrument_example(self, tmpdir_amxd):
        """examples/m4l_instrument/main.py should run without errors."""
        example_path = os.path.join(
            os.path.dirname(__file__), "..", "examples", "m4l_instrument", "main.py"
        )
        assert os.path.exists(example_path), f"Example file not found: {example_path}"

        # Change to tmpdir so output files go there
        old_cwd = os.getcwd()
        os.chdir(str(tmpdir_amxd))
        try:
            exec(open(example_path).read(), {"__name__": "__main__"})
        finally:
            os.chdir(old_cwd)

        # Verify the output file was created
        amxd_file = str(tmpdir_amxd / "m4l_instrument.amxd")
        assert os.path.exists(amxd_file), (
            f"Expected output file not found. Files: {os.listdir(tmpdir_amxd)}"
        )
        assert os.path.getsize(amxd_file) > 0

    def test_m4l_audio_effect_example(self, tmpdir_amxd):
        """examples/m4l_audio_effect/main.py should run without errors."""
        example_path = os.path.join(
            os.path.dirname(__file__), "..", "examples", "m4l_audio_effect", "main.py"
        )
        assert os.path.exists(example_path), f"Example file not found: {example_path}"

        old_cwd = os.getcwd()
        os.chdir(str(tmpdir_amxd))
        try:
            exec(open(example_path).read(), {"__name__": "__main__"})
        finally:
            os.chdir(old_cwd)

        amxd_file = str(tmpdir_amxd / "m4l_audio_effect.amxd")
        assert os.path.exists(amxd_file), (
            f"Expected output file not found. Files: {os.listdir(tmpdir_amxd)}"
        )
        assert os.path.getsize(amxd_file) > 0
