"""
tools.obj.attribs

Methods dealing with attribs for MaxObjects.

    add_extra_attribs() --> add extra attributes to the object's dictionary

    get_all_valid_attribs() --> check given text/extra attribs against ref file info, returns valid attribs

        remove_bad_attribs() --> checks attribs against ref file info and removes bad attribs

    retain_attribs() --> retain all possible attribs (extra only) from another MaxObject
"""

import json
import re
import warnings
from pathlib import Path

from .. import typechecks as tc
from ...exceptions import AttributeWarning


def _warn(message):
    """An AttributeWarning at the user's line: their place(), edit() or MaxObject() call."""
    from ...cordcheck import _user_stacklevel
    warnings.warn(message, AttributeWarning, stacklevel=_user_stacklevel())


#boxes whose text is what they say or send, not a name and attributes
_TEXT_IS_CONTENT = ('comment', 'message', 'live.comment', 'textbutton', 'textedit')
#what a box is, which no attribute in its text may change
_NOT_A_PROPERTY = ('id', 'maxclass', 'numinlets', 'numoutlets', 'outlettype', 'patching_rect', 'text')

_GROUPS = None
_NUMBERED = re.compile(r"^(in|out)\d+_")


def inherited_attribs(name):
    """The attributes an object has from its family, which its own data does not list.

    A Jitter matrix object takes dim, planecount, type and the in_/out_ forms; an OpenGL
    object takes position, scale, color and the rest. data/attrib_groups.json has both.
    """
    global _GROUPS
    if _GROUPS is None:
        with open(Path(__file__).resolve().parents[2] / "data" / "attrib_groups.json", encoding="utf-8") as f:
            raw = json.load(f)
        _GROUPS = {member: raw["attributes"][group]
                   for group, names in raw["members"].items() for member in names}
    return _GROUPS.get(name, [])


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

    Warns about text attributes it does not know, removes bad extra attributes, and returns
    the rest.

    *As a general rule, text attributes can only access object-specific attributes.
    """

    #what the object's family gives it (dim on a Jitter matrix object, scale on an OpenGL one)
    attrib_info = attrib_info + inherited_attribs(self._name)

    #first, check text attribs. They are part of the box text the user typed, so they stay
    #in it: the data here is not complete, and Max is the judge of what it gets.
    text_attribs = self.remove_bad_attribs(text_attribs, attrib_info + self.common_box_attribs, typed=True)

    #every box has the common box attributes (presentation, varname, hidden...), whether or
    #not its data file says so, and a place for its Live parameter block
    total_attrib_info = attrib_info + [{'name': 'patching_rect', 'type': 'float', 'size': '4'},
                                       {'name': 'parameter_enable', 'type': 'int', 'size': 1},
                                       {'name': 'saved_attribute_attributes', 'type': 'any', 'size': 1}]
    total_attrib_info += self.common_box_attribs

    #then, check extra attribs
    extra_attribs = self.remove_bad_attribs(extra_attribs, total_attrib_info)

    #Max reads the box text of an object box only. A UI box (slider, flonum, waveform~) keeps
    #each attribute as a property of the box, so `slider @size 1000` has to become
    #"size": 1000.0 there or Max never sees it. A property passed by keyword wins.
    #Only an attribute that is known and whose values are the known type is copied: an
    #unknown one stays in the text alone, since a guess here would be a property Max acts on.
    #The words of a comment or a message box are its content, not attributes.
    box = (getattr(self, '_dict', None) or {}).get('box', {})
    if box.get('maxclass', 'newobj') not in ('newobj',) + _TEXT_IS_CONTENT:
        known = attrib_info + self.common_box_attribs
        copied = set()
        for attrib, vals in text_attribs.items():
            spec = next((spec for spec in known if spec['name'] == attrib), None)
            vals = [vals] if isinstance(vals, (int, float, str)) else list(vals)
            if (spec is None or attrib in _NOT_A_PROPERTY
                    or not all(tc.check_type([spec['type']], val) for val in vals)):
                continue
            copied.add(attrib)
            extra_attribs.setdefault(attrib, _as_property(vals, spec['type']))
        #a property that came from the text goes when the text no longer has it
        for attrib in getattr(self, '_props_from_text', set()) - copied:
            if attrib not in extra_attribs:
                box.pop(attrib, None)
        self._props_from_text = copied

    return text_attribs, extra_attribs


def _as_property(vals, kind):
    """The words after an @attribute as the value Max saves for it on a UI box."""
    def one(word):
        if not isinstance(word, str):
            return word
        if len(word) > 1 and word[0] == word[-1] == '"':
            return word[1:-1]      #"my pic.png" is one name, saved without its quotes
        if kind not in ('symbol',):
            try:
                return float(word) if kind == 'float' or not re.fullmatch(r"-?\d+", word) else int(word)
            except ValueError:
                pass
        return word
    vals = [vals] if isinstance(vals, (int, float, str)) else list(vals)
    made = [one(word) for word in vals]
    return made[0] if len(made) == 1 else made


def remove_bad_attribs(self, attribs, attrib_speclist, typed=False):
    """
    Helper function for getting valid attributes.

    Checks attributes against attribute info and removes nonvalid attributes.

    typed: the attributes are `@name value` in the box text. One that is not known, or whose
    values are not the known type, gets a warning and is kept as written. Only one with no
    value at all is removed, since `@name` alone is not something Max can read.
    """

    notvalid = []
    for attrib, vals in attribs.items():

        #make it a list...
        if isinstance(vals, (int, float)):
            vals = [vals]

        #check for no value specified
        if len(vals) == 0:
            _warn(f"{self._name}: no value given for attribute {attrib}, so it is left out.")
            notvalid.append(attrib)
            continue

        #look for attrib spec in attrib_speclist
        #in2_dim, out3_name: the numbered inputs and outputs of a matrix object
        known_as = _NUMBERED.sub(lambda m: m.group(1) + "_", attrib)
        attrib_spec = [spec for spec in attrib_speclist if spec['name'] in (attrib, known_as)]

        #if not found
        if len(attrib_spec) == 0:
            if typed:
                _warn(f"{self._name} has no attribute '{attrib}' that maxpylang knows of. "
                      f"It is kept as written, so check the spelling.")
            else:
                _warn(f"{self._name} has no attribute '{attrib}', so it is left out.")
                notvalid.append(attrib)

        #if found
        else:
            attrib_spec = attrib_spec[0] #bc list comprehension, etc.....
            #a size in the data is the most values the attribute holds (32 for a dim or an
            #expr), not how many it needs, so fewer in the box text is fine. The check stays
            #for the box properties, whose sizes are exact (a rect is 4 numbers).
            if not typed and len(vals) < int(attrib_spec.get('size', 1)):
                _warn(f"{self._name}: attribute {attrib} takes {attrib_spec['size']} values, so it is left out.")
                notvalid.append(attrib)

            #check type for all vals
            elif not all([tc.check_type([attrib_spec['type']], single_val) for single_val in vals]):
                if typed:
                    _warn(f"{self._name}: attribute {attrib} takes values of type {attrib_spec['type']}. "
                          "It is kept as written.")
                else:
                    _warn(f"{self._name}: attribute {attrib} takes values of type {attrib_spec['type']}, "
                          "so it is left out.")
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

    #a Live parameter block describes one kind of control (a dial's range, a tab's choices),
    #so it only moves to an object of the same class
    if self._dict['box'].get('maxclass') != other._dict['box'].get('maxclass') or self._dict['box'].get('maxclass') == 'newobj':
        for attrib in ('parameter_enable', 'saved_attribute_attributes'):
            extra_attribs.pop(attrib, None)

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
