"""
tools.obj.exposed

Functions of the MaxObject class that are exposed to the user. 

    edit() --> edit an object
    parameter() --> set what a Live parameter (live.dial, live.slider...) is called and its range
    link() --> link a file for a js object or abstraction
    inspect() --> inspect an object

"""

import os
from typing import Literal, Optional, Sequence

#Max's unit styles, in the order it numbers them (parameter_unitstyle)
PARAMETER_UNITS = ("int", "float", "time", "hertz", "decibel", "percent", "pan", "semitones", "midi",
                   "custom", "native")
ParameterUnit = Literal["int", "float", "time", "hertz", "decibel", "percent", "pan", "semitones", "midi",
                        "custom", "native"]

def move(self, x, y):
    """
    Move an object to the specified location. 
    """
    
    self._dict['box']['patching_rect'][0] = x
    self._dict['box']['patching_rect'][1] = y
    
    return

def edit(self, text_add = "append", text = None, **extra_attribs):
    """
    Edit an object by adding/replacing text and specifying attributes. 

    text_add --> 'append' : keep current args/text attributes, append specified args/text attributes
    text_add --> 'replace': erase current args/text attributes, replace with specified args/text attributes

    Should not use this function to change object class (i.e. name)!!!
    Can only change args/text attributes/extra attributes
    """

    #only edit if it's not an unknown object
    if self.notknown():
        print("Error: attempting edit on empty object")
        print("       nothing edited")
        return

    
    new_args = []
    new_text_attribs = {}

    #parse text if given
    if text is not None:
        if not text.startswith(self.name): #if missing name
            text = self.name + " " + text
        name, new_args, new_text_attribs = self.parse_text(text) #parse text

    #if appending, add new args/attribs to current args/attribs
    if text_add == "append":
        new_args = self._args + new_args
        new_text_attribs = self._text_attribs | new_text_attribs #will override overlapping attribs in favor of new

        
        
    #if it's an abstraction...
    if self._ref_file == "abstraction":
        
        #directly add new args/text_attribs w/o checking
        self._args = new_args
        self._text_attribs = new_text_attribs
        self.update_text()
        
        #add any extra attribs after checking against common attribs
        attrib_info = [{"name": "COMMON"}]
        x, extra_attribs = self.get_all_valid_attribs({}, extra_attribs, attrib_info)
        self.add_extra_attribs(extra_attribs) 
        
        #log abstraction edit and warn
        print("ObjectWarning:", self.name, ": edit :", "abstraction edited naively. if abstraction args " + \
              "affect inlets/outlets or abstraction has unique attributes, abstraction info must be imported " + \
              "using import_objs() function to reflect arg/attribute behaviors.")
        return
    

    #get obj info 
    info = self.get_info()

    #check args valid; if not, print error and don't edit
    if not self.args_valid(self.name, new_args, info['args']):
        print(self.name, "not edited")
        return
    self._args = new_args

    #get valid attribs
    self._text_attribs, extra_attribs = self.get_all_valid_attribs(new_text_attribs, extra_attribs, info['attribs'])


    #add or remove ins/outs based on arguments
    self.update_ins_outs(info['in/out'], info['default'])
    #add extra attributes to dict
    self.add_extra_attribs(extra_attribs)
    #update text box with name, args, text attribs
    self.update_text()

    return



def parameter(self, name: str, lo: Optional[float] = None, hi: Optional[float] = None, *,
              initial: Optional[float] = None, unit: Optional[ParameterUnit] = None,
              exponent: Optional[float] = None, short_name: Optional[str] = None,
              integer: bool = False, options: Optional[Sequence[str]] = None):
    """
    Make this object a Live parameter: what Live calls it, and the values it can take.

    A live.dial, live.slider or live.numbox is only useful with a range, and Live finds a
    parameter by its name, for automation and for MIDI mapping. Both are kept in the
    object's parameter block, which this writes::

        cutoff = patch.place("live.dial")[0]
        cutoff.parameter("Cutoff", 40, 18000, initial=1000, unit="hertz", exponent=3)

        mode = patch.place("live.tab")[0]
        mode.parameter("Mode", options=["Low", "Band", "High"])

    Once the range is here the checks at save can read it: two parameters with one name, a
    parameter wired to nothing, and a range that does not fit the inlet it feeds.

    :param name: the parameter's long name, which Live shows and automates by. It must be
        the only parameter of that name in the device.
    :param lo, hi: the range. Max's own default is 0 to 127.
    :param initial: the value the device starts with. It must lie in the range.
    :param unit: how the value is displayed: ``"hertz"``, ``"decibel"``, ``"time"`` (ms),
        ``"percent"``, ``"pan"``, ``"semitones"``, ``"midi"``, ``"int"``, ``"float"``.
    :param exponent: the curve of the control. 1 is linear; 2 or 3 gives a frequency dial
        more travel at the low end.
    :param short_name: the name shown on the control itself, if it differs.
    :param integer: whole numbers only.
    :param options: the choices of a live.tab or live.menu, in place of a range.

    :raises TypeError: on an object that cannot be a parameter (``cycle~``).
    :raises ValueError: on an empty range, a start value outside it, or an unknown unit.
    :returns: the object, so the call can follow ``place(...)[0]``.
    """
    box = (self._dict or {}).get("box", {})
    if "parameter_enable" not in box:
        raise TypeError(f"{self.name} cannot be a Live parameter. The objects that can are the live.* "
                        "controls (live.dial, live.slider, live.numbox, live.toggle, live.tab, live.menu...) "
                        "and Max's own UI controls.")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("a parameter needs a name")
    if unit is not None and unit not in PARAMETER_UNITS:
        raise ValueError(f"unknown unit {unit!r}. The units are: {', '.join(PARAMETER_UNITS)}.")
    if options is not None and (lo is not None or hi is not None):
        raise ValueError("give a range or a list of options, not both")
    if options is not None and len(options) < 2:
        raise ValueError("a parameter with options needs at least two")

    block = dict(box.get("saved_attribute_attributes", {}).get("valueof", {}))
    if options is not None:
        low, high = 0, len(options) - 1
        block.update(parameter_type=2, parameter_enum=[str(option) for option in options])
        block.pop("parameter_mmin", None)
        block.pop("parameter_mmax", None)
    else:
        low = block.get("parameter_mmin", 0.0) if lo is None else lo
        high = block.get("parameter_mmax", 127.0) if hi is None else hi
        if not low < high:
            raise ValueError(f"parameter {name!r}: the range {low:g} to {high:g} is empty. lo must be below hi.")
        if lo is not None or hi is not None:
            block.update(parameter_mmin=float(low), parameter_mmax=float(high))
        block.pop("parameter_enum", None)
        block["parameter_type"] = 1 if integer else 0
    if initial is not None:
        if not low <= initial <= high:
            raise ValueError(f"parameter {name!r}: the start value {initial:g} is outside its range, "
                             f"{low:g} to {high:g}.")
        block.update(parameter_initial=[initial], parameter_initial_enable=1)
    if unit is not None:
        block["parameter_unitstyle"] = PARAMETER_UNITS.index(unit)
    if exponent is not None:
        if exponent <= 0:
            raise ValueError(f"parameter {name!r}: the exponent must be above 0")
        block["parameter_exponent"] = float(exponent)
    block.update(parameter_longname=name, parameter_shortname=name if short_name is None else short_name)

    box.setdefault("saved_attribute_attributes", {})["valueof"] = block
    box["parameter_enable"] = 1
    return self


def link(self, link_file=None):
    """
    Link a file for a js object or abstraction.
    
    link_file --> the filename, file MUST be placed in current directory
    link_file = None --> for js object with prev. given filename, will try to link that again
                     --> otherwise, won't work
    
    For js objects, linking or re-linking will automatically update the text field to reflect the proper filename.
    """
    
    #check for js file or abstraction or unknown (only three cases allowed)
    if not (self.name == "js" or self._ref_file is None or self._ref_file == 'abstraction'):
        print("ObjectError:", self.name, ": link : cannot be linked to a file")
        return
    
    #do linking for js file
    if self.name == 'js':  
        self.link_js(link_file=link_file)
    
    #or do linking for abstraction
    else:
        self.link_abstraction(link_file=link_file) 
    
    return


def inspect(self):
    """
    Print out specified information about the object. 
    """

    return