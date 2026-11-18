"""
tools.obj.attribs

Methods dealing with attribs for MaxObjects.

    add_extra_attribs() --> add extra attributes to the object's dictionary

    get_all_valid_attribs() --> check given text/extra attribs against ref file info, returns valid attribs

        remove_bad_attribs() --> checks attribs against ref file info and removes bad attribs

    retain_attribs() --> retain all possible attribs (extra only) from another MaxObject
"""

from .. import typechecks as tc


def add_extra_attribs(self, extra_attribs):
    """
    Add extra attributes to self dict.
    """
    for key, val in extra_attribs.items():
        self._dict['box'][key] = val

    return


def get_all_valid_attribs(self, text_attribs, extra_attribs, attrib_info):
    """
    Helper function for instantiation and editing.

    Removes bad text attributes and bad extra attributes, and returns valid attributes.

    *As a general rule, text attributes can only access object-specific attributes.
    """

    #first, check text attribs
    text_attribs = self.remove_bad_attribs(text_attribs, attrib_info)

    #add common box attributes if necessary
    total_attrib_info = attrib_info
    #add access to patching_rect attrib
    total_attrib_info.append({'name': 'patching_rect', 'type': 'float', 'size': '4'})
    if 'COMMON' in [attrib['name'] for attrib in attrib_info]:
        total_attrib_info += self.common_box_attribs

    #then, check extra attribs
    extra_attribs = self.remove_bad_attribs(extra_attribs, total_attrib_info)

    return text_attribs, extra_attribs


def remove_bad_attribs(self, attribs, attrib_speclist):
    """
    Helper function for getting valid attributes.

    Checks attributes against attribute info and removes nonvalid attributes.
    """

    notvalid = []
    for attrib, vals in attribs.items():

        #make it a list...
        if isinstance(vals, (int, float)):
            vals = [vals]

        #check for no value specified
        if len(vals) == 0:
            print("warning:", self._name,": no argument given for attribute", attrib)
            continue

        #look for attrib spec in attrib_speclist
        attrib_spec = [spec for spec in attrib_speclist if spec['name'] == attrib]

        #if not found
        if len(attrib_spec) == 0:
            print("Error:", self._name, ":", attrib, "is not a valid attribute argument")
            notvalid.append(attrib)

        #if found
        else:
            attrib_spec = attrib_spec[0] #bc list comprehension, etc.....
            #check length of val at least as big as size (reflecting Max behavior...)
            if len(vals) < int(attrib_spec['size']):
                print("Error:", self._name, ":", attrib, "requires", attrib_spec['size'], "arguments")
                notvalid.append(attrib)

            #check type for all vals
            if not all([tc.check_type([attrib_spec['type']], single_val) for single_val in vals]):
                print("Error:", self._name, ":", attrib, "requires arguments of type", attrib_spec['type'])
                notvalid.append(attrib)

    #remove nonvalid attribs from attribs
    for badattrib in notvalid:
        del attribs[badattrib]

    return attribs



def retain_attribs(self, other):
    """
    Retain overlapping extra attributes from another MaxObject.

    Used in MaxPatch for replacement.
    """

    #get non-normal extra attribs from other obj
    extra_attribs = other.get_extra_attribs()


    #add to obj
    self.edit(**extra_attribs)

    return


def get_extra_attribs(self):
    """
    Get an object's extra attributes from its dictionary.
    """

    normal = ['id', 'maxclass', 'numinlets', 'numoutlets', 'outlettype', 'patching_rect', 'text']
    extra_attribs = {}
    for attrib, val in self._dict['box'].items():
        if attrib not in normal:
            extra_attribs[attrib] = val

    return extra_attribs
