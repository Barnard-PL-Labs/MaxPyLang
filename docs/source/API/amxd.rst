==========================
Max for Live (.amxd) files
==========================

Most code never calls these directly: ``patch.save("synth.amxd", device_type="instrument")``
and ``mp.MaxPatch(load_file="synth.amxd")`` use them for you.

.. autofunction:: maxpylang.save_amxd
.. autofunction:: maxpylang.load_amxd

.. data:: maxpylang.DEVICE_TYPES

   The ``device_type`` values ``save()`` and :func:`save_amxd` accept, mapped to the four-byte
   code written into the file: ``"audio_effect"``, ``"midi_effect"``, ``"instrument"``.
