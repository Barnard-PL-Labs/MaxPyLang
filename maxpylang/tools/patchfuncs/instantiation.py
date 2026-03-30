"""
tools.patchfuncs.instantiation

Functions for instantiation of a MaxPatch.

    load_template() --> create patch from template

    load_file() --> create patch from existing .maxpat or .amxd file
        load_objs_from_dict() --> create objects from existing file dict
        load_patchcords_from_dict() --> create patchcords from existing file dict
        clean_patcher_dict() --> get cleaned patcher dict

"""

import os
import json
from pathlib import Path
from maxpylang.maxobject import MaxObject


#from template
def load_template(self, t, verbose=True):
    """
    Helper function for instantiation.  GOOD!
    Loads in a maxpatch template.

    verbose --> log to console
    """

    #try to find in patch_templates folder, if it doesn't exist
    if not os.path.exists(t):
        t = os.path.join(self.patch_templates_path, t)
        assert os.path.exists(t), f"Error: template file not found"

    #read template
    with open(t, "r") as f:
        patch_dict = json.loads(f.read())

    #save to patch instance
    self._patcher_dict = patch_dict

    #log...
    if verbose:
        print("Patcher: new patch created from template file:", os.path.split(t)[-1])

    return


#from file
def load_file(self, f, reorder=True, verbose=True):
    """
    Helper function for instantiation.
    Loads in an existing .maxpat or .amxd file.

    reorder --> re-number objects, starting from 1
    verbose --> log to console
    """

    #log...
    if verbose:
        print("Patcher: loading patch from existing file:", os.path.split(f)[-1])

    #read .maxpat or .amxd file into dict
    ext = Path(f).suffix
    if ext == ".amxd":
        from ...amxd import load_amxd
        patch_dict = load_amxd(f)
    elif ext == ".maxpat":
        with open(f, 'r') as file:
            patch_dict = json.loads(file.read())
    else:
        raise ValueError(
            f"Unsupported file extension '{ext}'. "
            f"Expected '.maxpat' or '.amxd'."
        )


    #load in objs
    self.load_objs_from_dict(patch_dict, verbose=verbose)

    #then load in patchcords
    self.load_patchcords_from_dict(patch_dict, verbose=verbose)

    #then load in cleaned patchdict
    self._patcher_dict = self.clean_patcher_dict(patch_dict)

    #reorder objects if necessary
    if reorder:
        self.reorder()

    #log...
    if verbose:
        print("Patcher: patch loaded from existing file:", os.path.split(f)[-1])

    return



def load_objs_from_dict(self, patch_dict, verbose=True):
    """
    Helper function for load_file.
    Loads in objects from a full patch dict.
    """

    self._num_objs = 0
    #for each obj, make obj from the obj json dict
    for box in patch_dict['patcher']['boxes']:
        obj = MaxObject(box, from_dict=True)

        #add obj to patch
        self._num_objs += 1

        obj_id = obj._dict['box']['id']
        self._objs[obj_id] = obj

        if verbose:
            print("Patcher:", obj.name, "added, total objects", self._num_objs)

    return



def load_patchcords_from_dict(self, patch_dict, verbose=True):

    """
    Helper function for load_file.
    Loads in patchcords from a patch dict and removes patchcords from patch dict.
    (must have objs loaded into patch already)
    """

    #for each patchcord, make a patchcord connection
    for line in patch_dict['patcher']['lines']:

        #get source/dest obj/xlet info from patchcord entry...
        source_obj, source_outlet = line['patchline']['source'][0], line['patchline']['source'][1]
        dest_obj, dest_inlet = line['patchline']['destination'][0], line['patchline']['destination'][1]

        midpoints = [None]
        if 'midpoints' in line['patchline'].keys():
            midpoints = line['patchline']['midpoints']

        #make the connection!
        self.connect([self._objs[source_obj].outs[source_outlet],
                      self._objs[dest_obj].ins[dest_inlet], midpoints], verbose=verbose)

    return

def clean_patcher_dict(self, patch_dict):
    """
    Helper function for load_file.

    Removes box and line information from the given dict.
    """

    #self._patcher_dict doesn't hold box/cord info...
    #gets added in automatically during saving, so we gotta get rid of it here
    patch_dict['patcher']['boxes'] = []
    patch_dict['patcher']['lines'] = []

    return patch_dict
