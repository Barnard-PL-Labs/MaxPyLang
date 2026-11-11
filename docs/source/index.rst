=========
MaxPyLang
=========

MaxPyLang is a Python package for making Max (MaxMSP) patches with code. You write a Python
script that places objects and connects them, and it saves a ``.maxpat`` file you open in Max,
or a ``.amxd`` device for Ableton Live. Code makes it easy to do things that are slow by hand:
place and connect hundreds of objects, generate patches randomly or procedurally, and edit
patches you made in Max.

Quick example
=============

.. code-block:: python

    import maxpylang as mp

    patch = mp.MaxPatch()
    osc = patch.place("cycle~ 440")[0]   # place() returns a list
    dac = patch.place("ezdac~")[0]
    patch.connect((osc.outs[0], dac.ins[0]), (osc.outs[0], dac.ins[1]))
    patch.save("hello_world")             # writes hello_world.maxpat

Open ``hello_world.maxpat`` in Max and click the speaker to hear a 440 Hz tone.
Start with :doc:`guide/getting-started`.

For coding agents, the whole site is also one Markdown file:
`llms-full.txt <llms-full.txt>`_ (index: `llms.txt <llms.txt>`_).

.. toctree::
   :maxdepth: 1
   :caption: Guide

   guide/getting-started
   guide/connecting
   guide/max-for-live
   guide/checks
   guide/editor-setup
   guide/agents

.. toctree::
   :maxdepth: 1
   :caption: More

   install
   tutorial
   topics/topics
   API/API
   support
   indices
