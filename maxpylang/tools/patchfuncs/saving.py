"""
tools.patchfuncs.saving

Methods related to saving MaxPatches to files.

    save() --> save MaxPatch to file (.maxpat or .amxd)
    get_json() --> get json representation of MaxPatch
"""

import json
from pathlib import Path
import copy

from .checking import count_problems, count_unchecked

#save patch to file
def save(self, filename="default.maxpat", device_type=None, verbose=True, check=True):

    """
    Save to .maxpat or .amxd file.

    Usage:
    filename --> savefile name (.maxpat or .amxd)
    device_type --> for Max for Live .amxd files: "instrument", "audio_effect", or "midi_effect"
                    required when saving as .amxd; when set, forces .amxd extension
    verbose --> print one line naming the file, how many objects and cords it has, and how
                many problems the checks found, e.g.
                saved hello_world.maxpat (2 objects, 1 cord, no problems found)
    check --> check the patch once it is written: unknown objects, js links, cords, and the
              shape of the patch (GraphWarning for a hot loop, audio feedback with no delay,
              or output that reaches nothing). For the full report, call patch.check().
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

    #warnings for the shape of the patch come first, so the summary line can point back at them
    problems = count_problems(self, device_type=device_type) if check else None
    unchecked = count_unchecked(self) if check else 0

    if verbose:
        print(summary(self, filename, device_type, problems, unchecked))

    return


def summary(patch, filename, device_type=None, problems=None, unchecked=0):
    """
    The line save() prints: the file, what is in it, and how many problems were found.
    problems is None when the patch was not checked, so the line makes no claim about it.
    unchecked counts objects the checks could not see into, so "no problems found" does not
    claim more than the checks know.
    """
    def count(n, word):
        return f"{n} {word}" + ("" if n == 1 else "s")

    cords = sum(len(outlet.destinations) for obj in patch._objs.values() for outlet in obj.outs)
    parts = [count(len(patch._objs), "object"), count(cords, "cord")]
    if device_type is not None:
        parts.insert(0, f"M4L {device_type}")
    if problems == 0:
        parts.append("no problems found")
    elif problems is not None:
        parts.append(count(problems, "problem") + ", see warning" + ("" if problems == 1 else "s") + " above")
    if unchecked:
        parts.append(count(unchecked, "object") + " not checked")
    return f"saved {filename} ({', '.join(parts)})"




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