"""
tools.patchfuncs.placing

Methods related to placing objects in a MaxPatch.

    place() --> user function, driver for placing objs

    place_check_args() --> check that arguments given are correct
    place_pick_objs() --> generate list of objs to be placed (picked randomly or multiplied from given list)

    place_random() --> place objects randomly
    place_grid() --> place objects on grid
    place_custom() --> place objects with custom spacing
    place_vertical() --> place objects with vertical spacing

    place_obj() --> place a single object
    get_obj_from_spec() --> return object from specification (either MaxObject or string)

"""
from __future__ import annotations

import random
from maxpylang.maxobject import MaxObject

# for user usage
def place(
    self,
    *objs,
    randpick=False,
    num_objs=1,
    seed=None,
    weights=None,
    spacing_type="grid",
    spacing=[80.0, 80.0],
    starting_pos=None,
    verbose=False,
    gen_patcher=None,
) -> list[MaxObject]:
    """
    Place objects in the patch.

            objs --> list of object names as strings, OR list of objects as prev. created MaxObjects (or mix of both)
        randpick --> True: pick n random objs from objs list (default pick 1)
              - num_objs --> integer: n = num_objs
              - num_objs --> list: give error & take first element on list
              - num_objs --> None: n = len(objs)
        randpick --> False: pick all objs on objs list (default each picked once)
              - num_objs --> integer: each obj multiplied by num_objs
              - num_objs --> list: each objs multiplied by corresponding num_objs entry
              - num_objs --> None: n = len(objs)
            seed --> random seed for picking/placing objs, if None then random seed
         weights --> weight probabilities for picking objs, if None then equal probability
    spacing_type --> options for how to place objs on canvas
              - "grid": objects centered on a grid
                    - spacing --> tuple/list length 2: [x, y] grid spacings
              - "random": random locations, using same seed as before (overlaps possible)
                    - spacing --> N/A
              - "custom": location specified for each object
                    - spacing --> list: positions [[x, y]], can only be used for num_objs=1
              - "vertical": objects stacked vertically
                    - spacing --> number: specify height
    starting_pos --> starting position to place from, must be tuple/list length 2: [x, y]

    verbose --> print output for seed, etc.

    :returns: a list of the MaxObjects that have been created

    """

    # check arguments are correct
    num_objs, starting_pos = self.place_check_args(
        objs, randpick, num_objs, seed, weights, spacing_type, spacing, starting_pos
    )

    # set the starting position
    if starting_pos is not None:
        self.set_position(
            starting_pos[0], starting_pos[1], from_place=True, verbose=verbose
        )

    # generate total list of objects to be placed
    picked_objs = self.place_pick_objs(objs, randpick, num_objs, seed, weights, verbose)

    # place objects according to spacing
    if spacing_type == "grid":
        placed_objs = self.place_grid(picked_objs, spacing, verbose=verbose, gen_patcher=gen_patcher)
    elif spacing_type == "custom":
        placed_objs = self.place_custom(picked_objs, spacing, verbose=verbose, gen_patcher=gen_patcher)
    elif spacing_type == "random":
        if seed is None:  # generate seed if not given
            seed = random.randrange(2 ** 32 - 1)
        placed_objs = self.place_random(picked_objs, seed, verbose=verbose, gen_patcher=gen_patcher)
    elif spacing_type == "vertical":
        placed_objs = self.place_vertical(picked_objs, spacing, verbose=verbose, gen_patcher=gen_patcher)

    return placed_objs


# check arguments
def place_check_args(
    self, objs, randpick, num_objs, seed, weights, spacing_type, spacing, starting_pos
):
    """
    Helper function for placing objects.

    Check that all arguments are formatted correctly.
    Format num_objs correctly.
    """

    # check objs
    for obj in objs:
        assert isinstance(
            obj, (MaxObject, str, list)
        ), f"objs list must be strings or existing MaxObjects"

    # check num_objs
    if num_objs == None:
        if (
            randpick == False
        ):  # if not randomly picking, num_objs refers to how many multiples of each given object
            num_objs = 1  # default to 1
        if (
            randpick == True
        ):  # if randomly picking, num_objs refers to how many random selections to make
            num_objs = len(
                objs
            )  # default to randomly selecting as many objs as are given

    # check randpick possibilities
    if randpick == False:
        if isinstance(
            num_objs, list
        ):  # giving number of multiples for each given object
            assert len(num_objs) == len(
                objs
            ), f"if num_objs is list, length of num_objs must match length of objs"
    elif randpick == True:
        if isinstance(num_objs, list):  # only take the first number for random picking
            print(
                "warning: randpick only uses the first element of num_objs to determine the number of objects picked"
            )
            num_objs = int(num_objs[0])
        if weights is not None:
            assert len(weights) == len(
                objs
            ), f"length of weights must match length of objs"

    # check spacing args
    if spacing_type == "grid":
        assert isinstance(spacing, (list, tuple)) and len(spacing) == 2, (
            f"spacing_type=grid: spacing must "
            "be 2-element list or tuple of [x, y] grid spacings"
        )
    elif spacing_type == "random":
        pass
    elif spacing_type == "custom":
        # tricky num_objs dealing here....
        # case 1: randpick = False, num_objs is an integer
        # case 2: randpick = False, num_objs is a list
        # case 3: randpick = True, num_objs is an integer
        if randpick == False:
            if isinstance(num_objs, int):
                # num_objs is the multiplier for each obj in objs_list
                actual_num = num_objs * len(objs)
            elif isinstance(num_objs, list):
                # num_objs specifies a multiplier for each obj in objs_list
                actual_num = sum(num_objs)
        elif randpick == True:
            # num_objs is the number of objects being picked
            actual_num = num_objs
        assert isinstance(spacing, (list)) and len(spacing) == actual_num, (
            f"spacing_type=custom: "
            "must give one position for each object in objs list"
        )
    elif spacing_type == "vertical":
        assert isinstance(spacing, (int, float)), (
            f"spacing_type=vertical: spacing must "
            "be int or float for vertical spacing"
        )
    else:
        assert (
            False
        ), f"spacing_type not recognized, must be one of grid, random, custom, or vertical"

    if starting_pos is not None:
        if not (isinstance(starting_pos, (list, tuple)) and len(starting_pos) == 2):
            print(
                " PatchError: starting position must be [x, y] list or tuple of length 2, starting position not set"
            )
            starting_pos = None

    return num_objs, starting_pos


# pick objects
def place_pick_objs(self, objs, randpick, num_objs, seed, weights, verbose):
    """
    Helper function for placing objects.

    Returns list of picked objects to place, either picked randomly or multiplied from given list.
    """

    picked_objs = []

    print(objs)
    # picking randomly
    if randpick == True:
        if seed is None:  # generate seed if not given
            seed = random.randrange(2 ** 32 - 1)
        np.random.seed(seed)  # set seed
        if verbose:
            print("Patcher: picking", num_objs, "random objects with seed", seed)
        picked_objs = list(
            np.random.choice(objs, size=int(num_objs), p=weights)
        )  # generate list

    # multiply from given list
    elif randpick == False:
        #objs = objs[0] not sure why this was here
        if isinstance(objs, str):
            objs = [objs]

        if isinstance(num_objs, (int, float)):  # make num_objs into proper list form
            num_objs = [int(num_objs)] * len(objs)
            for obj, num in zip(
                objs, num_objs
            ):  # make copies of each obj, according to num_obj
                picked_objs += [obj] * num

    print(picked_objs)
    return picked_objs


# spacing
def place_grid(self, objs, spacing, verbose=False, gen_patcher=None):
    """
    Helper function for placing.
    Places objects in a grid.
    """

    if verbose:
        print("Patcher: placing", len(objs), "objects with grid spacings of", spacing)

    x_space = float(spacing[0])
    y_space = float(spacing[1])

    # get current positions
    curr_x = self._curr_position[0]
    curr_y = self._curr_position[1]

    # if current y pos is 0, go down one row so we're not starting at the very top of the page
    if curr_y == 0:
        curr_y += y_space

    canvas_x = self._patcher_dict["patcher"]["rect"][2]

    createdObjs = []

    for obj in objs:
        curr_x += x_space
        if curr_x > (canvas_x - x_space):
            curr_x = x_space
            curr_y += y_space
        placedObj = self.place_obj(obj, position=[curr_x, curr_y], verbose=verbose, gen_patcher=gen_patcher)
        createdObjs.append(placedObj)

    self._curr_position = [curr_x, curr_y]

    return createdObjs


# spacing
def place_random(self, objs, seed, verbose=False, gen_patcher=None):
    """
    Helper function for placing.
    Places objects randomly.
    """

    if verbose:
        print("Patcher: placing", len(objs), "objects randomly with seed", seed)  # log

    np.random.seed(seed)  # set seed

    # get canvas size
    x = self._patcher_dict["patcher"]["rect"][2]
    y = self._patcher_dict["patcher"]["rect"][3]

    createdObjs = []
    for obj in objs:
        position = [np.random.random() * x, np.random.random() * y]
        placedObj = self.place_obj(obj, position=position, verbose=verbose, gen_patcher=gen_patcher)
        createdObjs.append(placedObj)

    return createdObjs


# spacing
def place_custom(self, objs, positions, verbose=False, gen_patcher=None):
    """
    Helper function for placing.
    Places objects according to custom positions.
    """

    if verbose:
        print(
            "Patcher: placing", len(objs), "objects with custom positions of", positions
        )  # log

    createdObjs = []
    for obj, pos in zip(objs, positions):
        placedObj = self.place_obj(obj, position=pos, verbose=verbose, gen_patcher=gen_patcher)
        createdObjs.append(placedObj)

    self._curr_position = pos

    return createdObjs


# spacing
def place_vertical(self, objs, spacing, verbose=False, gen_patcher=None):
    """
    Helper function for placing.
    Places objects vertically.
    """

    if verbose:
        print(
            "Patcher: placing", len(objs), "objects with vertical spacing of", spacing
        )

    x = self._curr_position[0] + spacing
    y = self._curr_position[1]

    createdObjs = []
    for obj in objs:
        y += spacing
        placedObj = self.place_obj(obj, position=[x, y], verbose=verbose, gen_patcher=gen_patcher)
        createdObjs.append(placedObj)

    self._curr_position = [x, y]

    return createdObjs


# actual placement of a single object
def place_obj(self, obj, position=[0.0, 0.0], verbose=False, replace_id=None, gen_patcher=None):
    """
    Helper function for placing.
    If obj denoted by string, creates obj; otherwise, adds existing object to patcher at specified position.

    obj --> object to be placed (str or MaxObject)
    position --> patcher position
    verbose --> debug commands
    replace_id --> 'obj-num' string of object being replaced
    gen_patcher --> MaxPatch instance to embed as a gen sub-patcher inside this object
    """

    # get object from specification
    obj = self.get_obj_from_spec(obj)

    if replace_id == None:  # for just adding (not replacing)...
        self._num_objs += 1  # increment patch number of objects
        obj._dict["box"]["id"] = "obj-" + str(
            self._num_objs
        )  # change obj id to number of patch objects
    else:
        obj._dict["box"]["id"] = replace_id  # change obj id to replacement id

    obj._dict["box"]["patching_rect"][0:2] = position  # change position

    # embed gen patcher if provided
    if gen_patcher is not None:
        obj._dict["box"]["patcher"] = gen_patcher.get_json()["patcher"]

    # add to various dictionaries of patch objects by obj-id
    obj_id = obj._dict["box"]["id"]
    self._objs[obj_id] = obj

    if verbose:
        print("Patcher:", obj.name, end="")
        if obj.notknown():
            print(" (unknown)", end="")
        print(" added, total objects", self._num_objs)  # log

    return obj


# also used in replace
def get_obj_from_spec(self, obj_spec):
    """
    Helper function to get object from specification, either from string or from MaxObject.
    """

    # if given as string, make object (warning fires from MaxObject constructor)
    if isinstance(obj_spec, str):
        obj = MaxObject(obj_spec)

    # otherwise, make sure it's a MaxObject
    else:
        assert isinstance(
            obj_spec, MaxObject
        ), f"object must be specified as a string or a MaxObject"
        obj = obj_spec

    return obj
