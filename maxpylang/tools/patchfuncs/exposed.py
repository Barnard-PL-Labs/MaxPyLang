"""
tools.patchfuncs.exposed

Functions of MaxPatch that are exposed to the user.

    
    save() --> save patch to file
    place() --> place objects
    connect() --> connect patchcords
    delete() --> delete objects and patchcords
    check() --> check patch for unknown, js, abstraction objects
   
    reorder() --> re-number objects in the patch
    set_position() --> set cursor position
    replace() --> replace objects
    inspect() --> inspect the patch or patch objects
    
"""

from .saving import save
from .placing import place
from .patchcords import connect
from .deleting import delete
from .checking import check

#reorder objects
def reorder(self, verbose=False):
    """
    Re-number objects in patch, starting from 1. 
    """

    if verbose:
        print("reordering", self.num_objs, "objects...")
        
    #reset number of objects, make new dict
    self._num_objs = 0 
    new_objs_dict = {}
    


    #for each existing obj...
    for old_label, obj in self._objs.items(): 
        self._num_objs += 1
        obj._dict['box']['id'] = 'obj-' + str(self._num_objs) #starting from 1, renumber objects 
        new_objs_dict[obj._dict['box']['id']] = obj #re-label in new obj dict

    #set new obj dict
    self._objs = new_objs_dict
    
    if verbose:
        print(self.num_objs, "objects reordered")

    return        



        


def set_position(self, new_x, new_y, from_place=False, verbose=False):
    """
    Set the current "cursor" position from which objects will be placed.

    Must be formatted as [x, y] tuple or int of length 2. 
    """

    #check format
    if isinstance(new_x, (float, int)) and isinstance(new_y, (float, int)):
        self._curr_position = [new_x, new_y]
        if verbose:
            if from_place:
                print("starting position set to", self._curr_position)
            else:
                print("position set to", self._curr_position)

    else:
        if from_place:
            print("Error: starting position must be specified as int or float, starting position not set")
        else:
            print("Error: position must be specified as int or float, position not set")

    return




#replace objects
def replace(self, curr_obj_num: str, new_obj, retain=True, verbose=False,  **new_attribs):
    """
    Replace an object in the patch with a different object. 

    The new object can be specified as a string, or by reference to a MaxObject.
    Attributes in common (i.e. common box attribs) between old/new objects can be retained (will automatically retain).  
    Additional attribute settings will override retained attributes.
    Patchcords will automatically be retained if possible, starting from xlet 0. 

    curr_obj_num --> id number in 'obj-num' string format of current object to be replaced
    new_obj --> either string specification or MaxObject of new object
    retain --> retain all attributes in common between old/new objects
    verbose --> log to console
    new_attribs --> any new attributes to give to the new object
    """

    #check current obj exists
    if curr_obj_num not in self._objs.keys():
        print(curr_obj_num, "does not exist, nothing changed")
        return

    #get curr obj, position, name
    old_obj = self._objs[curr_obj_num]
    position, old_name = old_obj._dict['box']['patching_rect'][:2], old_obj.name

    #get new obj from spec
    new_obj = self.get_obj_from_spec(new_obj)

    #retain old attributes in new obj, if necessary
    if retain==True:
        new_obj.retain_attribs(old_obj)

    #put in new attributes
    new_obj.edit(**new_attribs, verbose=verbose)

    #give the new obj its final id first, so connection warnings name the right box
    new_obj._dict['box']['id'] = curr_obj_num

    #update patchcords that remain 
    self.swap_patchcords(new_obj, old_obj)

    #delete old obj
    self.delete_objs(curr_obj_num, verbose=verbose)

    #replace new obj in old obj position
    self.place_obj(new_obj, position=position, verbose=verbose, replace_id=curr_obj_num)

    #log
    if verbose:
        print(old_name, "replaced, new", curr_obj_num, ":", new_obj.name)

    return



#get patcher info
def inspect(self, *objs, info="all"):
    """
    Get desired information about specified objects.

       objs --> list of objs to get info about, as strings "obj-num"
           - if objs="all", print info for each object
       info --> desired info to print out 
           - "all": print all info below
           - "canvas": print obj-num, position, connections to each inlet/outlet
           - 
           - "attributes": print current settings of all available attributes
           - "common-box": print current settings of common box attributes, if applicable
           - "obj-attribs": print current settings of obj-specific attributes, if applicable
           -
           - "connections": print connections to each inlet/outlet
           - "position": print position on canvas 

    """

    #probably just call the MaxObject info() function

    return