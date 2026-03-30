"""
tools.patchfuncs.saving

Methods related to saving MaxPatches to files.

    save() --> save MaxPatch to file (.maxpat or .amxd)
    get_json() --> get json representation of MaxPatch
"""

import json
from pathlib import Path
import copy

#save patch to file
def save(self, filename="default.maxpat", device_type=None, verbose=True, check=True):

    """
    Save to .maxpat or .amxd file.

    Usage:
    filename --> savefile name (.maxpat or .amxd)
    device_type --> for Max for Live .amxd files: "instrument", "audio_effect", or "midi_effect"
                    required when saving as .amxd; when set, forces .amxd extension
    verbose --> print log message to console
    check --> run check_patch before saving
    """

    ext = Path(filename).suffix

    if ext == ".amxd" or device_type is not None:
        # Max for Live save path
        from ...amxd import save_amxd

        if device_type is None:
            raise ValueError(
                "device_type is required for .amxd files. "
                "Choose from: 'instrument', 'audio_effect', 'midi_effect'"
            )

        if ".amxd" not in Path(filename).suffixes:
            # replace existing extension (e.g. .maxpat) with .amxd, or append .amxd if none
            filename = str(Path(filename).with_suffix(".amxd"))

        json_dict = self.get_json()
        save_amxd(json_dict, filename, device_type=device_type)

    else:
        # Standard .maxpat save path
        if ".maxpat" not in Path(filename).suffixes:
            filename += ".maxpat"

        json_dict = self.get_json()

        with open(filename, 'w') as f:
            json.dump(json_dict, f, indent=2)

    #save filepath for later saving
    self._filename = filename

    #log unknown objs and unlinked js objs
    #(abstractions only get marked as abstractions if the file is found)
    #also log linked abstractions and linked js files
    if check:
        self.check('unknown', 'js', 'abstractions')

    #log messages
    if verbose:
        if device_type is not None:
            print(f"maxpatch saved to {filename} (M4L {device_type})")
        else:
            print("maxpatch saved to", filename)


    return




def get_json(self):
    """
    Helper function for saving.

    Returns patcher dict with objects and patchcords added. 
    """

    #copy patcher_dict, for inserting objs and cords
    json_dict = copy.deepcopy(self._patcher_dict)

    #for each obj...
    for id, obj in self._objs.items():

        #add object jsons
        json_dict['patcher']['boxes'].append(obj._dict)

        #add patchcord json for outgoing edges...
        for outlet in obj.outs:
            #to each destination...
            for destination in outlet.destinations:
                #write patchcord going from id to destination.parent._dict['id']
                patchcord_dict = {'patchline':{'destination': [destination.parent._dict['box']['id'], destination.index],
                                               'source': [id, outlet.index], 
                                               'midpoints': destination.midpoints[destination.sources.index(outlet)]}}
                                                #midpoints entry corresponding to outlet entry, in source inlet 

                json_dict['patcher']['lines'].append(patchcord_dict)

    return json_dict