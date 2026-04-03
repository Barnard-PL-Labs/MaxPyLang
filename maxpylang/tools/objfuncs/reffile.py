"""
tools.obj.reffile

Methods that deal with the MaxObject's reference file.

    get_ref() --> find the path to the reference file
    check_aliases() --> check object name against aliases
    get_info() --> read the reference file and return MaxObject info 
    
"""

import os
import json
import warnings
from pathlib import Path

from maxpylang.exceptions import UnknownObjectWarning


def get_ref(self, name):

    """
    Helper function for instantiation.

    Gets path to reference file, if it exists.
    If it doesn't exist, look for an abstraction file.
    If no abstraction file, print error and return "not_found"
    """

    #check aliases for symbol objs and special objs
    name = self.check_aliases(name)

    ref_file = None

    #look through known_objs to find ref_file
    for package, obj_list in self.known_objs.items(): #known_objs = { package_name: [list of obj_names] }
        if name in obj_list:
            package_folder = os.path.join(self.obj_info_folder, package)
            ref_file = os.path.join(package_folder, name + ".json")
            if os.path.exists(ref_file):
                return ref_file

    #case-insensitive fallback for gen operators (e.g., PI -> pi, SAMPLERATE -> samplerate)
    #needed because case-insensitive filesystems can't store both pi.json and PI.json
    for package, obj_list in self.known_objs.items():
        name_lower = name.lower()
        if name_lower in obj_list:
            package_folder = os.path.join(self.obj_info_folder, package)
            ref_file = os.path.join(package_folder, name_lower + ".json")
            if os.path.exists(ref_file):
                return ref_file

    if ref_file is None:
        #look for possible abstraction file in current directory
        if os.path.exists(name) or os.path.exists(name + '.maxpat'):
            ref_file = "abstraction"
        else:
            warnings.warn(f"Unknown Max object: '{name}'", UnknownObjectWarning, stacklevel=4)
            ref_file = "not_found"

    return ref_file



def check_aliases(self, name):
    """
    Check name against aliases and return aliased object name, if applicable.
    """

    aliases_file = os.path.join(self.obj_info_folder, "obj_aliases.json")

    with open(aliases_file, 'r') as f:
        obj_aliases = json.loads(f.read())

    if name in obj_aliases.keys():
        name = obj_aliases[name]

    return name



def get_info(self, ref_file = None):
    """
    Helper function. 

    Returns dictionary of reference file info.
    """
    if ref_file is None:
        ref_file = self._ref_file
    #read ref file
    with open(ref_file, 'r') as f:
        info = json.loads(f.read())

    return info