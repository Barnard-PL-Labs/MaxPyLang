"""
Class representing a MaxPatch.
"""
from __future__ import annotations

import os
from typing import Any, TypeVar, Union, overload

from .maxobject import MaxObject
from .rates import R
from .tools.patchfuncs.patchcords import connect as _connect
from .tools.patchfuncs.placing import place as _place
from .xlet import Inlet, Outlet

_Obj = TypeVar("_Obj", bound=MaxObject)

# One connection: (outlet, inlet), (outlet, inlet, midpoints), or the untyped list form.
# The outlet and inlet share a rate variable, so a type checker rejects audio into an
# inlet that takes no audio. Each argument position gets its own variable.
_Conn = Union[tuple[Outlet[R], Inlet[R]], tuple[Outlet[R], Inlet[R], list[Any]], list[Any]]
# An unpacked list, connect(*pairs), resolves to the 9+ overload. mypy joins the inlets of
# pairs with different rates to `object`, so that overload leaves the inlet unconstrained.
_AnyConn = Union[tuple[Outlet[Any], object], tuple[Outlet[Any], object, list[Any]], list[Any]]
_R0 = TypeVar("_R0")
_R1 = TypeVar("_R1")
_R2 = TypeVar("_R2")
_R3 = TypeVar("_R3")
_R4 = TypeVar("_R4")
_R5 = TypeVar("_R5")
_R6 = TypeVar("_R6")
_R7 = TypeVar("_R7")


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

    def __init__(self, template=None, load_file=None, reorder=True, verbose=True):
        """
        Constructor method.
        """

        # instance variables:
        self._objs = {}  #: objects in patch, referenced as "obj-num": object
        self._num_objs = 0  #: number of objects in the patch
        self._patcher_dict = {}  #: the patch's JSON data
        self._curr_position = [0.0, 0.0]  #: 'cursor' position at which to place objects
        self._filename = "default.maxpat"  #: the file where the patch is saved

        # load existing maxpatch
        if load_file:
            self.load_file(load_file, reorder=reorder, verbose=verbose)

        # or, make copy from template
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
        replace,
        delete,
        check,
    )

    # FOR PLACING AND CONNECTING
    # Real methods rather than class-body imports, so type checkers can read their signatures.

    @overload
    def place(self, obj: _Obj, /, *, randpick: bool = ..., num_objs: Any = ..., seed: Any = ...,
              weights: Any = ..., spacing_type: str = ..., spacing: Any = ...,
              starting_pos: Any = ..., verbose: bool = ...) -> list[_Obj]: ...
    @overload
    def place(self, *objs: MaxObject | str | list[Any], randpick: bool = ..., num_objs: Any = ...,
              seed: Any = ..., weights: Any = ..., spacing_type: str = ..., spacing: Any = ...,
              starting_pos: Any = ..., verbose: bool = ...) -> list[MaxObject]: ...

    def place(self, *objs, randpick=False, num_objs=1, seed=None, weights=None, spacing_type="grid",
              spacing=[80.0, 80.0], starting_pos=None, verbose=False):
        return _place(self, *objs, randpick=randpick, num_objs=num_objs, seed=seed, weights=weights,
                      spacing_type=spacing_type, spacing=spacing, starting_pos=starting_pos,
                      verbose=verbose)

    place.__doc__ = _place.__doc__

    @overload
    def connect(self, c0: _Conn[_R0], /, *, verbose: bool = ...) -> None: ...
    @overload
    def connect(self, c0: _Conn[_R0], c1: _Conn[_R1], /, *, verbose: bool = ...) -> None: ...
    @overload
    def connect(self, c0: _Conn[_R0], c1: _Conn[_R1], c2: _Conn[_R2], /, *,
                verbose: bool = ...) -> None: ...
    @overload
    def connect(self, c0: _Conn[_R0], c1: _Conn[_R1], c2: _Conn[_R2], c3: _Conn[_R3], /, *,
                verbose: bool = ...) -> None: ...
    @overload
    def connect(self, c0: _Conn[_R0], c1: _Conn[_R1], c2: _Conn[_R2], c3: _Conn[_R3],
                c4: _Conn[_R4], /, *, verbose: bool = ...) -> None: ...
    @overload
    def connect(self, c0: _Conn[_R0], c1: _Conn[_R1], c2: _Conn[_R2], c3: _Conn[_R3],
                c4: _Conn[_R4], c5: _Conn[_R5], /, *, verbose: bool = ...) -> None: ...
    @overload
    def connect(self, c0: _Conn[_R0], c1: _Conn[_R1], c2: _Conn[_R2], c3: _Conn[_R3],
                c4: _Conn[_R4], c5: _Conn[_R5], c6: _Conn[_R6], /, *,
                verbose: bool = ...) -> None: ...
    @overload
    def connect(self, c0: _Conn[_R0], c1: _Conn[_R1], c2: _Conn[_R2], c3: _Conn[_R3],
                c4: _Conn[_R4], c5: _Conn[_R5], c6: _Conn[_R6], c7: _Conn[_R7], /, *,
                verbose: bool = ...) -> None: ...
    # Nine or more connections in one call are checked at runtime only.
    @overload
    def connect(self, c0: _AnyConn, c1: _AnyConn, c2: _AnyConn, c3: _AnyConn, c4: _AnyConn,
                c5: _AnyConn, c6: _AnyConn, c7: _AnyConn, c8: _AnyConn, /, *more: _AnyConn,
                verbose: bool = ...) -> None: ...

    def connect(self, *connections, verbose=True):
        return _connect(self, *connections, verbose=verbose)

    connect.__doc__ = _connect.__doc__

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
