"""
tools.patchfuncs.checking

Methods related to checking MaxPatches: unknown objects, abstraction/js links, and cords

    check() --> get info on unknowns, abstractions, js files, and audio-into-control cords

    get_coverage() --> how much of the patch the cord and graph checks could judge

    get_unknowns() --> get unknown objects
    get_abstractions() --> get abstractions
    get_js_objs() --> get js objects, linked and unlinked

"""
import collections
import os

from maxpylang.cordcheck import coverage, misused_tap_links, unchecked
from maxpylang.graphcheck import find_problems, from_patch, link_problems, warn_problems

def check(self, *flags, device_type=None):
    """
    This method checks the patch for linked abstractions, unknown objects, linked/unlinked js objects,
    cords that send audio into an inlet that takes no audio, and problems in the shape of the
    patch: hot loops, audio feedback with no delay, outputs that reach nothing, a tapout~
    with no tapin~, and names (receive, receive~, buffer~ readers) with nothing on the other end.

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
        taps = misused_tap_links(self)
        tap_part = f"{taps} sending a tap link to something that is not a tapout~, " if taps else ""
        print(f"PatchCheck: cords : {total} cord{plural}, {counts['problem'] - taps} sending audio into an inlet "
              f"that takes none, {tap_part}{counts['unknown']} not checked (no type data)")
        # an object with no type data is a gap in maxpylang, not something the user can act on,
        # so those cords stay in the count above and in get_coverage() and are not named here
        _print_some("not checked:", [f"{n} on {label} ({why})" for label, why, n in unchecked(self)
                                     if why != "no type data"])
        print()

    if 'graph' in flags:
        problems = find_problems(*from_patch(self), max_for_live=device_type is not None)
        problems += link_problems(self.get_json()["patcher"])
        warn_problems(problems)
        found = collections.Counter(problem.kind for problem in problems)
        def count(n, one, many):
            return f"{n} {one if n == 1 else many}"
        print(f"PatchCheck: graph : {count(found['hot loop'], 'hot loop', 'hot loops')}, "
              f"{count(found['audio feedback'], 'audio feedback loop', 'audio feedback loops')} with no delay, "
              f"{count(found['dead output'], 'part', 'parts')} of the patch whose output reaches nothing")
        if found["no delay line"] or found["missing name"]:
            print(f"PatchCheck: links : {count(found['no delay line'], 'tapout~', 'tapout~ objects')} with no "
                  f"tapin~, {count(found['missing name'], 'name', 'names')} with nothing on the other end")
        _print_some("not seen into:", self.get_coverage()["objects"]["not_seen_into"])
        print()

    return



def count_problems(patch, device_type=None):
    """
    Run the checks that save() runs, without printing, and return how many problems they found.

    Each problem counted here has already been reported as it happened, so save() can point
    back at it: an unknown object when it was made (UnknownObjectWarning), a js object with no
    file when it was made, a cord sending audio into an inlet that takes none at connect()
    (ConnectionWarning). Problems in the shape of the patch are found now, and raise one
    GraphWarning each here.
    """
    graph = find_problems(*from_patch(patch), max_for_live=device_type is not None)
    warn_problems(graph)
    _, js_unlinked = patch.get_js_objs()
    return len(patch.get_unknowns()) + len(js_unlinked) + coverage(patch)["problem"] + len(graph)


def count_unchecked(patch):
    """
    How many objects the checks could not see into: subpatchers, abstractions and js, which
    can do anything. Unknown objects are left out, since they are already counted as problems.
    patch.check() and get_coverage() name them.
    """
    nodes, _ = from_patch(patch)
    unknown = patch.get_unknowns()
    return sum(1 for box_id, node in nodes.items() if node.opaque and box_id not in unknown)


def _print_some(heading, items, limit=5):
    """One indented line listing up to `limit` items, and how many more there are."""
    if not items:
        return
    more = f", and {len(items) - limit} more" if len(items) > limit else ""
    print("              ", heading, ", ".join(items[:limit]) + more)


def get_coverage(self):
    """
    How much of the patch the checks could judge. A check says nothing about what it does
    not know, so a patch that saves with no warning is only as checked as these numbers say.

    :returns: ``{"cords": {"total", "checked", "flagged", "not_checked", "not_checked_because"},
        "objects": {"total", "not_seen_into"}}``. ``not_checked_because`` lists
        ``(object, reason, cords)``; ``not_seen_into`` lists the objects the graph check treats
        as able to do anything: subpatchers, abstractions, js and unknown objects.
    :rtype: dict
    """
    counts = coverage(self)
    nodes, _ = from_patch(self)
    return {
        "cords": {
            "total": sum(counts.values()),
            "checked": counts["ok"] + counts["problem"],
            "flagged": counts["problem"],
            "not_checked": counts["unknown"],
            "not_checked_because": unchecked(self),
        },
        "objects": {
            "total": len(nodes),
            "not_seen_into": [node.label for node in nodes.values() if node.opaque],
        },
    }


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
