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
