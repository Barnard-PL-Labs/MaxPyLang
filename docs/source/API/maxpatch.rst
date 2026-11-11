========
MaxPatch
========

Creating a patch
~~~~~~~~~~~~~~~~

.. autoclass:: maxpylang.MaxPatch

   **Notes:**

   - If ``load_file`` is given, ``template`` is ignored. With neither, you get an empty patch.
   - ``load_file`` reads ``.maxpat`` and Max for Live ``.amxd`` files. In 0.1.1 it fails on most
     patches saved by Max, and on frozen devices; see :doc:`../guide/known-issues`.
   - To load abstractions or ``js`` objects, the :doc:`linked files<../topics/linked_files>` must be in the current directory.
   - To load a patch with :doc:`external package objects<../topics/ext_packages>`, import those packages first.
   - :doc:`Unknown objects<../topics/unknown_objs>` keep their patch cords when loaded, but cannot be edited.
     Swap them for known objects with :meth:`MaxPatch.replace`.

   **Examples** (the debug lines maxpylang 0.1.1 also prints are left out; see :doc:`../guide/known-issues`):

   Creating an empty patch:

   >>> import maxpylang as mp
   >>> patch = mp.MaxPatch()
   Patcher: new patch created from template file: empty_template.json

   Loading a patch that contains a button connected to a counter:

   >>> loaded = mp.MaxPatch(load_file="my_patch.maxpat")
   Patcher: loading patch from existing file: my_patch.maxpat
   Patcher: button added, total objects 1
   Patcher: counter added, total objects 2
   Patcher: connected: ( button : outlet 0 ---> counter : inlet 0 )
   Patcher: patch loaded from existing file: my_patch.maxpat

Properties
~~~~~~~~~~

.. autoproperty:: maxpylang.MaxPatch.objs
.. autoproperty:: maxpylang.MaxPatch.num_objs
.. autoproperty:: maxpylang.MaxPatch.curr_position
.. autoproperty:: maxpylang.MaxPatch.dict

**Example:**

>>> loaded.objs
{'obj-1': button [button], 'obj-2': counter [counter]}
>>> loaded.num_objs
2
>>> loaded.curr_position
[0.0, 0.0]

Placing and connecting
~~~~~~~~~~~~~~~~~~~~~~

.. automethod:: maxpylang.MaxPatch.place

   **Note:** ``place()`` always returns a **list**, even for one object. Use ``[0]``:
   ``osc = patch.place("cycle~ 440")[0]``.

.. automethod:: maxpylang.MaxPatch.set_position

.. automethod:: maxpylang.MaxPatch.connect

   **Example:**

   >>> osc = patch.place("cycle~ 440")[0]
   >>> dac = patch.place("ezdac~")[0]
   >>> patch.connect((osc.outs[0], dac.ins[0]), (osc.outs[0], dac.ins[1]))
   Patcher: connected: ( cycle~ : outlet 0 ---> ezdac~ : inlet 0 )
   Patcher: connected: ( cycle~ : outlet 0 ---> ezdac~ : inlet 1 )

   A connection can be a tuple ``(outlet, inlet)`` or a list ``[outlet, inlet]``. Only the tuple
   form is checked by a type checker.

Saving
~~~~~~

.. automethod:: maxpylang.MaxPatch.save

Editing
~~~~~~~

.. automethod:: maxpylang.MaxPatch.replace
.. automethod:: maxpylang.MaxPatch.delete
.. automethod:: maxpylang.MaxPatch.reorder

Inspecting and checking
~~~~~~~~~~~~~~~~~~~~~~~

.. automethod:: maxpylang.MaxPatch.inspect
.. automethod:: maxpylang.MaxPatch.check

   ``save()`` runs this for you unless you pass ``check=False``. See also
   :doc:`Linked files<../topics/linked_files>` and :doc:`Unknown objects<../topics/unknown_objs>`.

   **Example:**

   >>> patch.place("not-an-obj")
   >>> patch.check()
   PatchCheck: unknown objects :
                  obj-3 : not-an-obj [not-an-obj]
   PatchCheck: unlinked js objects : no unlinked js objects
   PatchCheck: linked js objects (files must be in same folder as patch file): no linked js objects
   PatchCheck: linked abstractions (files must be in same folder as patch file): no linked abstractions
