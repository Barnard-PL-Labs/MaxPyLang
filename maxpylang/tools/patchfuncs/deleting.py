"""
tools.patchfuncs.deleting

Methods related to deleting objects and patchcords from a MaxPatch.

    delete() --> driver method for deleting objs/patchcords
    
    delete_get_extra_cords() --> get a list of all patchcords attached to objs being deleted
    delete_cords() --> delete patchcords
    delete_objs() --> delete objects
    
"""

#delete objects and patchcords
def delete(self, objs=None, cords=None, verbose=True): 
    """
    Delete objects and/or patchcords.
    Deleting objects will automatically delete any patchcords attached to them.

     objs --> list of string "obj-num" objects to delete
    cords --> list of connections (Outlet, Inlet)
    """

    objs = objs or []
    cords = cords or []

    #check format
    for obj in objs:
        assert isinstance(obj, str), f"objects to delete must be given as strings 'obj-num'"
    self.check_connection_format(cords)

    #remove nonexistent cords
    cords = self.check_connection_exists(cords)

    #delete cords
    self.delete_cords(*cords, verbose=verbose) 

    #delete objs
    self.delete_objs(*objs, verbose=verbose)

    return


def delete_get_extra_cords(self, *objs):
    """
    Helper function for deleting.

    Gets patchcords attached to objects being deleted and adds to cords list.
    Returns updated cords list.
    """

    cords = []
    for obj in objs:
        if obj in self._objs.keys():
            obj = self._objs[obj]
            #add cords coming from object to list for deletion
            for outlet in obj.outs:
                for dest_inlet in outlet.destinations:
                    cords.append([outlet, dest_inlet])
            #add cords coming to object to list for deletion
            for inlet in obj.ins:
                for source_outlet in inlet.sources:
                    cords.append([source_outlet, inlet])

    #just to be sure...
    self.check_connection_format(cords) #check proper formatting of cords

    return cords



def delete_cords(self, *cords, verbose=True):
    """
    Helper function for deleting.

    Delete cords in list. 
    Cords must be specified as (Outlet, Inlet) pairs 
    """

    for cord in cords:
        outlet = cord[0]
        inlet = cord[1] 
        midpoints = inlet._midpoints[inlet.sources.index(outlet)]

        #delete inlet from outlet destinations
        outlet._destinations.remove(inlet)
        #delete outlet from inlet sources
        inlet._sources.remove(outlet)
        #delete corresponding midpoint from inlet midpoints
        inlet._midpoints.remove(midpoints)

        if verbose:
            print("disconnected: (", outlet.parent.name, ": outlet", outlet.index, \
                              "-/->", inlet.parent.name, ": inlet", inlet.index, ")")

    return


def delete_objs(self, *objs, verbose=True):
    """
    Helper function for deleting.

    Deletes objects on list. 
    Also deletes any patchcords attached to those objects. 

    Objects must be specified as 'obj-num' strings
    """

    #check for obj existence
    for i in range(len(objs)):
        obj = objs[i]
        if obj not in self.objs.keys():                  #if object in patch
            print("delete error:", obj, "not in patch") #if obj not in patch, print error 
            objs.remove(obj)                           #and remove from delete list

    #get patchcords connected to objs, for deletion
    cords_to_delete = self.delete_get_extra_cords(*objs)
    #delete patchcords
    self.delete_cords(*cords_to_delete)

    #delete objects
    for obj in objs:
        obj_name = self._objs[obj].name #save for logging
        self._objs[obj]._in_patch = False
        del self._objs[obj]

        if verbose:
            print("object deleted:", obj, obj_name)

    return