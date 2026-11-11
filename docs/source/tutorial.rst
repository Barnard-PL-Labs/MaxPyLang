========
Tutorial
========

This tutorial walks through MaxPyLang with short examples. For the full picture, including
the type-checked style with stubs and tuples, see :doc:`guide/getting-started` and
:doc:`guide/connecting`.

Getting Started
===============

Installation
------------

First, install MaxPyLang:

.. code-block:: bash

    pip install maxpylang

Hello World
-----------

Let's create a simple oscillator patch that generates a 440 Hz tone:

.. code-block:: python

    import maxpylang as mp

    # Create a new patch
    patch = mp.MaxPatch()

    # Place objects
    osc = patch.place("cycle~ 440")[0]
    dac = patch.place("ezdac~")[0]

    # Connect them
    patch.connect([osc.outs[0], dac.ins[0]])

    # Save the patch
    patch.save("hello_world.maxpat")

Run this script, then open ``hello_world.maxpat`` in MaxMSP. Click the DAC (ezdac~) to hear the tone!

Basic Concepts
==============

Creating a Patch
----------------

Every MaxPyLang script starts by creating a MaxPatch object:

.. code-block:: python

    import maxpylang as mp
    patch = mp.MaxPatch()

Placing Objects
---------------

Use ``patch.place()`` to add objects to your patch. The method returns a list of created objects:

.. code-block:: python

    # Place a single object
    metro = patch.place("metro 500")[0]

    # Place multiple objects
    oscs = patch.place("cycle~ 220", "cycle~ 330", "cycle~ 440")

You can also specify placement options:

.. code-block:: python

    # Grid placement with custom spacing
    objects = patch.place(
        "cycle~ 100", "cycle~ 200", "cycle~ 300",
        spacing_type="grid",
        spacing=[100, 80]
    )

    # Vertical placement
    objects = patch.place(
        "random 100", "random 200", "random 300",
        spacing_type="vertical",
        spacing=50
    )

Connecting Objects
------------------

Connect objects using their inlets and outlets:

.. code-block:: python

    # Connect outlet 0 of obj1 to inlet 0 of obj2
    patch.connect([obj1.outs[0], obj2.ins[0]])

    # Connect multiple patchcords at once
    patch.connect(
        [obj1.outs[0], obj2.ins[0]],
        [obj1.outs[1], obj3.ins[0]],
        [obj2.outs[0], obj4.ins[0]]
    )

Saving Patches
--------------

Save your patch to a .maxpat file:

.. code-block:: python

    patch.save("my_patch.maxpat")

Working with Inlets and Outlets
================================

Every MaxObject has ``ins`` (inlets) and ``outs`` (outlets) that you can access by index:

.. code-block:: python

    osc = patch.place("cycle~ 440")[0]
    dac = patch.place("ezdac~")[0]

    # Access outlets and inlets by index
    outlet = osc.outs[0]     # First outlet of osc
    inlet = dac.ins[0]       # First inlet of dac

    # Connect them
    patch.connect([outlet, inlet])

Example: Building a Simple Synth
=================================

Let's create a more complex patch with multiple oscillators:

.. code-block:: python

    import maxpylang as mp

    patch = mp.MaxPatch()

    # Create oscillators at different frequencies
    frequencies = [220, 330, 440, 550]
    oscillators = []

    for freq in frequencies:
        osc = patch.place(f"cycle~ {freq}")[0]
        oscillators.append(osc)

    # Create a mixer
    mixer = patch.place("*~ 0.25")[0]  # Scale volume to avoid clipping
    dac = patch.place("ezdac~")[0]

    # Connect all oscillators to mixer
    for osc in oscillators:
        patch.connect([osc.outs[0], mixer.ins[0]])

    # Connect mixer to speakers
    patch.connect([mixer.outs[0], dac.ins[0]])

    patch.save("multi_oscillator.maxpat")

Example: Random Patch Generation
=================================

MaxPyLang makes it easy to generate patches programmatically:

.. code-block:: python

    import maxpylang as mp
    import random

    patch = mp.MaxPatch()

    # Generate random number generators
    num_generators = 5
    generators = []

    for i in range(num_generators):
        max_val = random.randint(50, 500)
        gen = patch.place(f"random {max_val}")[0]
        generators.append(gen)

    # Create outputs
    outputs = []
    for i in range(num_generators):
        out = patch.place("number")[0]
        outputs.append(out)

    # Connect generators to outputs
    for gen, out in zip(generators, outputs):
        patch.connect([gen.outs[0], out.ins[0]])

    # Add a metro to trigger them all
    metro = patch.place("metro 1000")[0]
    for gen in generators:
        patch.connect([metro.outs[0], gen.ins[0]])

    patch.save("random_generators.maxpat")

Loading Existing Patches
=========================

You can load and modify existing MaxMSP patches:

.. code-block:: python

    import maxpylang as mp

    # Load an existing patch
    patch = mp.MaxPatch(load_file="existing_patch.maxpat")

    # Add new objects
    new_obj = patch.place("print")[0]

    # Save modified patch
    patch.save("modified_patch.maxpat")

Next Steps
==========

- Explore the :doc:`API/API` for complete reference documentation
- Check out :doc:`topics/topics` for advanced features
- See the ``examples/`` directory for more complex patches
- Learn about :doc:`topics/unknown_objs` and :doc:`topics/linked_files`
