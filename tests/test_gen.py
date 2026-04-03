"""Tests for Gen patcher support in MaxPyLang."""

import os
import sys
import json
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import maxpylang as mp


class TestGenPatcherCreation:
    """Test creating gen patchers with gen_type parameter."""

    def test_gen_type_dsp_gen(self):
        """MaxPatch with gen_type='dsp.gen' should have correct classnamespace."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        json_dict = gen_patch.get_json()
        assert json_dict["patcher"]["classnamespace"] == "dsp.gen"

    def test_gen_type_jit_gen(self):
        """MaxPatch with gen_type='jit.gen' should have correct classnamespace."""
        gen_patch = mp.MaxPatch(gen_type="jit.gen", verbose=False)
        json_dict = gen_patch.get_json()
        assert json_dict["patcher"]["classnamespace"] == "jit.gen"

    def test_gen_type_jit_pix(self):
        """MaxPatch with gen_type='jit.pix' should have correct classnamespace."""
        gen_patch = mp.MaxPatch(gen_type="jit.pix", verbose=False)
        json_dict = gen_patch.get_json()
        assert json_dict["patcher"]["classnamespace"] == "jit.pix"

    def test_gen_type_jit_gl_pix(self):
        """MaxPatch with gen_type='jit.gl.pix' should have correct classnamespace."""
        gen_patch = mp.MaxPatch(gen_type="jit.gl.pix", verbose=False)
        json_dict = gen_patch.get_json()
        assert json_dict["patcher"]["classnamespace"] == "jit.gl.pix"

    def test_default_patch_has_box_classnamespace(self):
        """Normal MaxPatch (no gen_type) should still use 'box' classnamespace."""
        patch = mp.MaxPatch(verbose=False)
        json_dict = patch.get_json()
        assert json_dict["patcher"]["classnamespace"] == "box"

    def test_gen_patch_can_place_objects(self):
        """Gen patcher should support place() just like a normal patch."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        assert gen_patch.num_objs == 2

    def test_gen_patch_can_connect_objects(self):
        """Gen patcher should support connect() just like a normal patch."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        gen_patch.connect([inp.outs[0], outp.ins[0]], verbose=False)
        assert len(outp.ins[0].sources) == 1


class TestGenPatcherEmbedding:
    """Test embedding gen patchers inside gen~ objects."""

    def test_place_gen_tilde_with_gen_patcher(self):
        """Placing gen~ with gen_patcher should embed the patcher dict."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        gen_patch.connect([inp.outs[0], outp.ins[0]], verbose=False)

        patch = mp.MaxPatch(verbose=False)
        gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

        assert "patcher" in gen_obj._dict["box"]
        assert gen_obj._dict["box"]["patcher"]["classnamespace"] == "dsp.gen"

    def test_embedded_gen_patcher_has_boxes(self):
        """Embedded gen patcher should contain the placed objects."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        gen_patch.place("in 1", verbose=False)
        gen_patch.place("out 1", verbose=False)

        patch = mp.MaxPatch(verbose=False)
        gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

        boxes = gen_obj._dict["box"]["patcher"]["boxes"]
        texts = [b["box"]["text"] for b in boxes]
        assert "in 1" in texts
        assert "out 1" in texts

    def test_embedded_gen_patcher_has_lines(self):
        """Embedded gen patcher should contain patchcord connections."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        gen_patch.connect([inp.outs[0], outp.ins[0]], verbose=False)

        patch = mp.MaxPatch(verbose=False)
        gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

        lines = gen_obj._dict["box"]["patcher"]["lines"]
        assert len(lines) == 1

    def test_save_patch_with_embedded_gen(self, tmp_path):
        """Patch with embedded gen~ should save and reload correctly."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        gen_patch.connect([inp.outs[0], outp.ins[0]], verbose=False)

        patch = mp.MaxPatch(verbose=False)
        gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]
        dac = patch.place("ezdac~", verbose=False)[0]
        patch.connect([gen_obj.outs[0], dac.ins[0]], verbose=False)

        filepath = str(tmp_path / "test_gen_embed.maxpat")
        patch.save(filepath, verbose=False, check=False)

        assert os.path.exists(filepath)
        with open(filepath, "r") as f:
            saved = json.load(f)

        gen_boxes = [b for b in saved["patcher"]["boxes"]
                     if b["box"].get("text", "") == "gen~"]
        assert len(gen_boxes) == 1
        assert gen_boxes[0]["box"]["patcher"]["classnamespace"] == "dsp.gen"

    def test_place_without_gen_patcher_unchanged(self):
        """Normal place() without gen_patcher should work as before."""
        patch = mp.MaxPatch(verbose=False)
        osc = patch.place("cycle~ 440", verbose=False)[0]
        assert "patcher" not in osc._dict["box"]


class TestGenScraper:
    """Test gen operator extraction from local Max files."""

    def test_extract_common_operators(self):
        """Should extract common gen operators from local file."""
        from maxpylang.tools.gen_scraper import extract_local_gen_operators
        result = extract_local_gen_operators()
        assert "common" in result
        assert len(result["common"]) > 100  # we know there are 150

    def test_extract_gen_tilde_operators(self):
        """Should extract gen~ specific operators from local file."""
        from maxpylang.tools.gen_scraper import extract_local_gen_operators
        result = extract_local_gen_operators()
        assert "gen_tilde" in result
        assert len(result["gen_tilde"]) > 50  # we know there are 63

    def test_extract_jitter_operators(self):
        """Should extract jitter gen operators from local file."""
        from maxpylang.tools.gen_scraper import extract_local_gen_operators
        result = extract_local_gen_operators()
        assert "jitter" in result
        assert len(result["jitter"]) > 20  # we know there are 30

    def test_operators_have_names(self):
        """Each operator should have at least a name."""
        from maxpylang.tools.gen_scraper import extract_local_gen_operators
        result = extract_local_gen_operators()
        for category, ops in result.items():
            for op in ops:
                assert "name" in op, f"Operator missing name in {category}"
                assert len(op["name"]) > 0

    def test_operators_have_categories(self):
        """Each operator should have a category."""
        from maxpylang.tools.gen_scraper import extract_local_gen_operators
        result = extract_local_gen_operators()
        for group, ops in result.items():
            for op in ops:
                assert "category" in op, f"Operator {op['name']} missing category in {group}"


class TestGenComparison:
    """Test comparison between local and online gen operator catalogs."""

    def test_generate_comparison_report(self):
        """Should produce a comparison dict with expected keys."""
        from maxpylang.tools.gen_scraper import compare_local_vs_online
        report = compare_local_vs_online()
        assert "local_only" in report
        assert "online_only" in report
        assert "both" in report
        assert "local_total" in report
        assert "online_total" in report
