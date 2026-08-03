"""
Class representing a MaxPatch.
"""
from __future__ import annotations

import os

from .maxobject import MaxObject
from .xlet import Inlet, Outlet


class MaxPatch:
    """
    This class represents a MaxMSP patch. A MaxPatch can be created as a copy of a template file, \
    or by loading in an existing *.maxpat* file.

    :param template: the path to a template *.maxpat* file. Can be given as an absolute path, a relative path \
                     from the current directory, or a relative path from ``MaxPy/maxpy/data/PATCH_TEMPLATES/``.
    :type template: str, optional; default: None

    :param load_file: the path to an existing *.maxpat* file to be loaded in. \
                      Can be given as an absolute path or a relative path from the current directory.
    :type load_file: str, optional; default: None

    :param reorder: whether or not to reassign object ids after loading in an existing file. See :func:`MaxPatch.reorder`.
    :type reorder: bool, optional; default: True

    :param verbose: for logging output.
    :type verbose: bool, optional; default: True
    """

    from .tools.constants import (
        patch_templates_path,
    )  #: Path to the patch templates folder MaxPy/maxpy/data/PATCH_TEMPLATES.

    def __init__(self, template=None, load_file=None, reorder=True, verbose=True, gen_type=None):
        """
        Constructor method.
        """

        # instance variables:
        self._objs = {}  #: objects in patch, referenced as "obj-num": object
        self._num_objs = 0  #: number of objects in the patch
        self._patcher_dict = {}  #: the patch's JSON data
        self._curr_position = [0.0, 0.0]  #: 'cursor' position at which to place objects
        self._filename = "default.maxpat"  #: the file where the patch is saved
        self._gen_type = gen_type

        # load existing maxpatch
        if load_file:
            self.load_file(load_file, reorder=reorder, verbose=verbose)

        # or, make copy from template
        else:
            if gen_type is not None:
                if template is None:
                    template = os.path.join(
                        self.patch_templates_path, "gen_template.json"
                    )
                self.load_template(template, verbose=verbose)
                self._patcher_dict["patcher"]["classnamespace"] = gen_type
            else:
                if template is None:
                    template = os.path.join(
                        self.patch_templates_path, "empty_template.json"
                    )
                self.load_template(template, verbose=verbose)

        return

    # some properties to get info...
    @property
    def objs(self) -> dict:
        """
        A dictionary of all Max objects in the patch, stored by object id. Read-only.
        """
        return (
            self._objs
        )  # this one is tricky bc you can still technically set the dictionary values....w/e

    @property
    def num_objs(self) -> int:
        """
        The number of Max objects in the patch. Read-only.
        """
        return self._num_objs

    @property
    def curr_position(self) -> list[int, float]:
        """
        The current position of the 'cursor' at which to place Max objects. Given as a two-element list [x, y] of patch coordinates.
        Can be set using :func:`MaxPatch.set_position`.
        """
        return self._curr_position

    @property
    def dict(self) -> dict:
        """
        The JSON dict of the patch. Read-only.
        """
        return self.get_json()

    # FOR INSTANTIATION
    from .tools.patchfuncs.instantiation import load_template
    from .tools.patchfuncs.instantiation import (
        load_file,
        load_objs_from_dict,
        load_patchcords_from_dict,
        clean_patcher_dict,
    )

    # functions for user usage
    from .tools.patchfuncs.exposed import (
        reorder,
        set_position,
        inspect,
        save,
        place,
        connect,
        replace,
        delete,
        check,
    )

    # FOR SAVING
    from .tools.patchfuncs.saving import get_json

    # FOR PLACING
    from .tools.patchfuncs.placing import (
        place_check_args,
        place_pick_objs,
        place_grid,
        place_random,
        place_custom,
        place_vertical,
        place_obj,
        get_obj_from_spec,
    )

    # FOR PATCHCORDS
    from .tools.patchfuncs.patchcords import (
        swap_patchcords,
        check_connection_format,
        check_connection_typing,
        check_connection_exists,
    )

    # FOR DELETING
    from .tools.patchfuncs.deleting import (
        delete_get_extra_cords,
        delete_cords,
        delete_objs,
    )

    # FOR CHECKING
    from .tools.patchfuncs.checking import get_unknowns, get_abstractions, get_js_objs

    # MISC FUNCTIONS
    from .tools.patchfuncs.misc import add_barebones_obj
