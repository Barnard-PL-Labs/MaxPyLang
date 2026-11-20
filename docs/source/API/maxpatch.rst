==============
MaxPatch
==============

Instantiation
~~~~~~~~~~~~~

.. autoclass:: maxpy.MaxPatch

			**Notes:**

				- If ``load_file`` is given, ``template`` will be ignored. If neither files are given, a default empty MaxPatch will be created.
				- To load in abstractions or js objects, the :doc:`linked files<../topics/linked_files>` must be in the current directory.
				- To load in a patch with :doc:`external package objects<../topics/ext_packages>`, the packages should first be imported.
				- :doc:`Unknown objects<../topics/unknown_objs>` will retain patchcord connections when loaded in, but cannot be edited. They can be replaced with known objects via :func:`MaxPatch.replace`.


			**Examples:**

			Creating an empty patch:

			>>> empty_patch = maxpy.MaxPatch()

			A patch prints nothing while it is built. Pass ``verbose=True`` to see each step:

			Loading in a patch containing a button connected to a counter:

			>>> loaded_patch = maxpy.MaxPatch(load_file='my_patch.maxpat', verbose=True)
			Patcher: loading patch from existing file: my_patch.maxpat
			Patcher: button added, total objects 1
			Patcher: counter added, total objects 2
			Patcher: connected: ( button : outlet 0 ---> counter : inlet 0 )
			Patcher: patch loaded from existing file: my_patch.maxpat

Properties
~~~~~~~~~~
.. currentmodule:: maxpy.maxpatch
.. autoproperty:: MaxPatch.objs
.. autoproperty:: MaxPatch.num_objs
.. autoproperty:: MaxPatch.curr_position
.. autoproperty:: MaxPatch.dict

**Example:**

		>>> loaded_patch.objs
		{'obj-1': button [button], 'obj-2': counter [counter]}
		>>> loaded_patch.num_objs
		2
		>>> loaded_patch.curr_position
		[0.0, 0.0]
		>>> loaded_patch.dict
		{
		'patcher':
			{
			'fileversion': 1,
			...
			'boxes': [ ... ],
			'lines': [ ... ],
			'dependency_cache': [],
			'autosave': 0
			}
		}

Functions
~~~~~~~~~
.. currentmodule:: maxpy.maxpatch
.. automethod:: MaxPatch.check

	**Notes:**

		- See :doc:`Linked Files<../topics/linked_files>`, :doc:`Unknown Objects<../topics/unknown_objs>`.

	**Example:**

	>>> patch.objs
	{'obj-1': not-an-obj [not-an-obj],
	'obj-2': existing-abstraction [existing-abstraction],
	'obj-3': js [js 5 4 existing.js],
	'obj-4': js [js not-a-file.js]}
	>>> patch.check()
	PatchCheck: unknown objects :
	   obj-1 : not-an-obj [not-an-obj]
	PatchCheck: unlinked js objects :
	   obj-4 : js [js not-a-file.js]
	PatchCheck: linked js objects (files must be in same folder as patch file):
	   obj-3 : js [js 5 4 existing.js] --> existing.js
	PatchCheck: linked abstractions (files must be in same folder as patch file):
	   obj-2 : existing-abstraction [existing-abstraction] --> existing-abstraction.maxpat


.. currentmodule:: maxpy.maxpatch
.. automethod:: MaxPatch.connect

	**Notes:**

		- The current scheme for specifying connections is somewhat clunky (see example below). This will be fixed at some point...

	**Example:**

	>>> patch.objs

.. automethod:: MaxPatch.delete
.. automethod:: MaxPatch.inspect
.. automethod:: MaxPatch.place
.. automethod:: MaxPatch.reorder
.. automethod:: MaxPatch.replace
.. automethod:: MaxPatch.save
.. automethod:: MaxPatch.set_position
