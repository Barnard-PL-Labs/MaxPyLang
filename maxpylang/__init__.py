"""
maxpylang - Python library for programmatically creating and editing Max/MSP patches (.maxpat files).

Quick Start::

    import maxpylang as mp

    patch = mp.MaxPatch()
    osc = patch.place("cycle~ 440")[0]
    dac = patch.place("ezdac~")[0]
    patch.connect([osc.outs[0], dac.ins[0]])
    patch.save("hello_world")

Core API
--------

**MaxPatch**::

    patch = mp.MaxPatch(template=None, load_file=None, reorder=True, verbose=True)

    patch.place(*objs, num_objs=1, spacing_type="grid", spacing=[80,80],
                starting_pos=None, verbose=False) -> list[MaxObject]
    patch.connect(*connections, verbose=True)
    patch.save(filename="default.maxpat", device_type=None, verbose=True, check=True)
    patch.set_position(new_x, new_y)

- ``place()`` **always returns a list** — use ``[0]`` for a single object.
- Each connection is ``[outlet, inlet]``: ``patch.connect([obj1.outs[0], obj2.ins[0]])``.
- ``save()`` auto-appends ``.maxpat`` if missing.
- For Max for Live devices: ``patch.save("device.amxd", device_type="instrument")``.

Properties: ``patch.objs`` (dict), ``patch.num_objs`` (int), ``patch.curr_position`` (list).

**MaxObject**::

    obj = mp.MaxObject("cycle~ 440")
    obj = mp.MaxObject("metro 500 @active 1")   # with attributes

Properties: ``obj.name``, ``obj.ins`` (list of Inlets, 0-indexed), ``obj.outs`` (list of Outlets, 0-indexed).

Methods: ``obj.edit(text_add="append", text=None, **extra_attribs)``, ``obj.move(x, y)``.

Stub Objects
------------

Pre-instantiated MaxObject stubs for IDE autocomplete::

    from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, toggle

Naming rules:

- ``~`` becomes ``_tilde`` (``cycle~`` → ``cycle_tilde``)
- ``.`` becomes ``_`` (``jit.movie`` → ``jit_movie``)
- ``-`` becomes ``_`` (``live.dial`` → ``live_dial``)
- Leading digit gets ``_`` prefix (``2d.wave~`` → ``_2d_wave_tilde``)
- Python keywords get ``_`` suffix (``in`` → ``in_``)

Stubs have no arguments. Use string syntax when arguments are needed::

    osc = patch.place("cycle~ 440")[0]     # string: has arguments
    dac = patch.place(ezdac_tilde)[0]      # stub: no arguments needed

Available Objects
-----------------

All valid object names are in ``maxpylang/objects/`` (stubs by package: ``max.py``, ``msp.py``, ``jit.py``).

Common objects by category:

- **Audio sources**: cycle~, noise~, pink~, rect~, saw~, tri~, phasor~
- **Audio I/O**: adc~, dac~, ezdac~, ezadc~
- **Audio processing**: gain~, lores~, reson~, biquad~, delay~, tapin~, tapout~
- **Math (audio)**: +~, *~, -~, /~, clip~, abs~, scale~
- **Control**: metro, counter, toggle, button, number, flonum, dial
- **Routing**: gate, switch, route, select, trigger, pack, unpack
- **Data**: coll, dict, table, buffer~, preset
- **MIDI**: notein, noteout, ctlin, ctlout, midiin, midiout
- **UI**: multislider, slider, comment, message, panel, live.dial
- **Timing**: delay, pipe, timer, transport, tempo
- **Math (control)**: +, *, -, /, %, random, drunk, scale

Common Patterns
---------------

Audio chain::

    from maxpylang.objects import gain_tilde, ezdac_tilde

    patch = mp.MaxPatch()
    osc = patch.place("cycle~ 440")[0]
    gain = patch.place(gain_tilde)[0]
    dac = patch.place(ezdac_tilde)[0]
    patch.connect([osc.outs[0], gain.ins[0]],
                  [gain.outs[0], dac.ins[0]],
                  [gain.outs[0], dac.ins[1]])
    patch.save("audio_chain")

Multiple objects with loops::

    n = 10
    toggles = patch.place("toggle", num_objs=n, starting_pos=[0, 100])
    gates = patch.place("gate", num_objs=n, starting_pos=[0, 200])

    for t, g in zip(toggles, gates):
        patch.connect([t.outs[0], g.ins[0]])

Attributes via @ syntax::

    patch.place("metro 500 @active 1")[0]
    patch.place("jit.movie @moviefile crashtest.mov")[0]

Loading existing patches::

    patch = mp.MaxPatch(load_file="existing.maxpat")
    for key, obj in patch.objs.items():
        print(obj.name)
    patch.save("modified")

Abstractions
------------

For custom Max abstractions (sub-patches), use ``abstraction=True`` to declare
objects without needing the ``.maxpat`` file in the current directory::

    # Declare abstraction with known I/O (file doesn't need to exist)
    synth = mp.MaxObject("my_synth", abstraction=True, inlets=2, outlets=2)

    # Then place it in a patch
    patch.place(synth)

    # If the file exists in cwd, auto-detection still works as before
    synth = mp.MaxObject("my_synth")

Key Rules
---------

- ``place()`` **always returns a list** — use ``[0]`` for single objects.
- Object names are **case-sensitive** and must match Max names exactly.
- Coordinates are floats. Inlet/outlet indices are **0-based**.
- ``save()`` auto-appends ``.maxpat``. ``verbose=False`` suppresses console output.
- **Typos raise UnknownObjectWarning** — if you see this warning, fix the object name
  immediately. The object will have 0 inlets/outlets and won't work.
  Use ``obj.notknown()`` to check programmatically.

Patch Layout
------------

Call ``set_position(x, y)`` **before every ``place()`` call**.
Without it, objects pile up and cords cross::

    Y_STEP = 40       # between objects in a chain
    SECTION_GAP = 80  # between logical sections
    COL_WIDTH = 150   # between parallel columns

    patch.set_position(30, 100)
    osc = patch.place("cycle~")[0]

    patch.set_position(30, 140)          # +Y_STEP
    filt = patch.place("lores~")[0]

    patch.set_position(30 + COL_WIDTH, 100)  # parallel column
    lfo = patch.place("cycle~ 2")[0]

Layout rules:

- Top-to-bottom signal flow (increasing y).
- Parallel chains side by side (same y, different x).
- Labels (comment) 20px above their object.
- Section headers: ``patch.place("comment === SECTION NAME ===")``.
- loadbang/defaults to the right of main flow.
- Group ``connect()`` calls by section, not scattered throughout.

Regenerate Stubs
----------------

Optional, requires Max open::

    mp.import_objs()

Vanilla stubs (max, msp, jit) ship with the package.
Use ``import_objs()`` to add third-party packages or refresh stubs.
"""

from .tools import constants
from .maxobject import MaxObject
from .maxpatch import MaxPatch
from .importobjs import import_objs
from .xlet import Inlet, Outlet
from .amxd import save_amxd, load_amxd, DEVICE_TYPES

try:
    from . import objects
except ImportError:
    pass  # objects not yet generated
