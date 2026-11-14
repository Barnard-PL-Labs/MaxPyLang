"""
tools.patchfuncs.checking

Methods related to checking MaxPatches: unknown objects, abstraction/js links, and cords

    check() --> get info on unknowns, abstractions, js files, and audio-into-control cords

    get_unknowns() --> get unknown objects
    get_abstractions() --> get abstractions
    get_js_objs() --> get js objects, linked and unlinked

"""
import collections
import os

from maxpylang.cordcheck import coverage
from maxpylang.graphcheck import find_problems, from_patch, warn_problems

def check(self, *flags, device_type=None):
    """
    This method checks the patch for linked abstractions, unknown objects, linked/unlinked js objects,
    cords that send audio into an inlet that takes no audio, and problems in the shape of the
    patch: hot loops, audio feedback with no delay, and outputs that reach nothing.

    :param \\*flags: takes keywords ``'abstractions'``, ``'unknowns'``, ``'js'``, ``'cords'``. If no flags given,
        checks all five categories. ``'graph'`` checks the shape of the patch.
    :param device_type: the Max for Live device type the patch is saved as, if any. Inside a
        device, dac~ and ezdac~ are not outputs.
    :type \\*flags: str, optional

    :returns: outputs a list of all the objects that fall under the specified categories, \
    identified by object id, name, text, and linked file (if applicable).
    :rtype: printed output
    """

    flags = list(flags)

    if len(flags) == 0 or 'all' in flags:
        flags += ['unknown', 'js', 'abstractions', 'cords', 'graph']

    if 'unknown' in flags or 'unknowns' in flags:

        unknown_objs = self.get_unknowns()

        if unknown_objs:
            print("PatchCheck: unknown objects :")
            for label, obj in unknown_objs.items():
                print("              ", label, ":", obj)

        else:
            print("PatchCheck: unknown objects : no unknown objects")
        print()

    if 'js' in flags:

        js_linked, js_unlinked = self.get_js_objs()

        if js_unlinked:
            print("PatchCheck: unlinked js objects :")
            for label, obj in js_unlinked.items():
                print("              ", label, ":", obj)


        else:
            print("PatchCheck: unlinked js objects : no unlinked js objects")
        print()

        if js_linked:
            print("PatchCheck: linked js objects (files must be in same folder as patch file):")
            for label, obj in js_linked.items():
                print("              ", label, ":", obj, "-->", os.path.basename(obj._ext_file))

        else:
            print("PatchCheck: linked js objects (files must be in same folder as patch file): no linked js objects")
        print()

    if 'abstractions' in flags or 'abstraction' in flags:
        abstractions = self.get_abstractions()
        if abstractions:
            print("PatchCheck: linked abstractions (files must be in same folder as patch file):")
            for label, obj in abstractions.items():
                print("              ", label, ":", obj, "-->", os.path.basename(obj._ext_file))

        else:
            print("PatchCheck: linked abstractions (files must be in same folder as patch file): no linked abstractions")
        print()

    if 'cords' in flags:
        counts = coverage(self)
        total = sum(counts.values())
        plural = "" if total == 1 else "s"
        print(f"PatchCheck: cords : {total} cord{plural}, {counts['problem']} sending audio into an inlet "
              f"that takes none, {counts['unknown']} not checked (no type data)")
        print()

    if 'graph' in flags:
        problems = find_problems(*from_patch(self), max_for_live=device_type is not None)
        warn_problems(problems)
        found = collections.Counter(problem.kind for problem in problems)
        def count(n, one, many):
            return f"{n} {one if n == 1 else many}"
        print(f"PatchCheck: graph : {count(found['hot loop'], 'hot loop', 'hot loops')}, "
              f"{count(found['audio feedback'], 'audio feedback loop', 'audio feedback loops')} with no delay, "
              f"{count(found['dead output'], 'part', 'parts')} of the patch whose output reaches nothing")
        print()

    return



def get_unknowns(self):
    """
    Get a list of unknown objects in the patch.
    """

    unknowns = {}

    for label, obj in self._objs.items():
        if obj._ref_file == None:
            unknowns[label] = obj

    return unknowns


def get_abstractions(self):
    """
    Get a list of abstractions in the patch.
    """

    abstractions = {}

    for label, obj in self._objs.items():
        if obj._ref_file == "abstraction":
            abstractions[label] = obj

    return abstractions

def get_js_objs(self):
    """
    Get a list of js files in the patch.
    """

    linked = {}
    unlinked = {}

    for label, obj in self._objs.items():
        if obj.name == 'js':
            if obj._ext_file is None:
                unlinked[label] = obj
            else:
                linked[label] = obj

    return linked, unlinked
