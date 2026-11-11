=============
API reference
=============

Generated from the docstrings in the ``maxpylang`` package. Everything below is importable
from the top level, ``import maxpylang as mp``, except the rate classes, which live in
``maxpylang.rates``.

- :class:`~maxpylang.MaxPatch`: a Max patcher file.
- :class:`~maxpylang.MaxObject`: one box in a patch.
- :class:`~maxpylang.Inlet`, :class:`~maxpylang.Outlet`: an object's inlets and outlets.
- :func:`~maxpylang.save_amxd`, :func:`~maxpylang.load_amxd`, :data:`~maxpylang.DEVICE_TYPES`: Max for Live files.
- :mod:`maxpylang.rates`: what a patch cord carries, for type checkers.
- :class:`~maxpylang.exceptions.UnknownObjectWarning` and :func:`~maxpylang.import_objs`.

.. toctree::
   :maxdepth: 1

   maxpatch
   maxobject
   inlet
   outlet
   amxd
   rates
   misc
