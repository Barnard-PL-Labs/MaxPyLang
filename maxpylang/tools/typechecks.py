"""
Methods for checking datatypes.
"""

import re

#what Max takes where a number is asked for, besides a number:
#  a patcher argument that is filled in when the patch loads: #1, #0_name
#  a time value: note values (4n, 8nd, 16nt), 100ms, 2s, 10hz, 480ticks, 44100samples, 1:30, 2.1.0
_PLACEHOLDER = re.compile(r"#\d")
_TIME_VALUE = re.compile(r"(\d+n[dt]?|\d+(\.\d+)?(ms|s|hz|ticks|samples|samps)|\d+(:\d+){1,2}|\d+\.\d+\.\d+)$")

def check_number(arg):
    """
    Check for number (float or int).
    """
    try:
        float(arg)
        return True
    except ValueError:
        return False 


def check_number_arg(arg):
    """
    Check an argument given where a number is asked for: a number, a patcher argument
    (#1) or a time value (4n, 100ms).
    """
    if check_number(arg):
        return True
    return isinstance(arg, str) and bool(_PLACEHOLDER.match(arg) or _TIME_VALUE.match(arg))


def check_any(arg):
    """
    Check if it's "anything"....
    """
    return True


def check_int(arg):
    """
    Check int. A float is not one: int(1.5) works, but 1.5 is not an int.
    """
    if isinstance(arg, float):
        return False
    try:
        int(arg)
        return True
    except ValueError:
        return False
    
#functions associated with types, for typechecking
typecheck_funcs = {'int': check_number_arg,        #attrib
                   'symbol': check_any,        #attrib
                   'number': check_number_arg, 
                   'list': check_any,
                   'any': check_any, 
                   'float': check_number_arg,      #attrib
                   'atom_long': check_number_arg,  #attrib
                   'atom': check_any,          #attrib
                   'int32': check_number_arg,      #attrib
                   'object': check_any,        #attrib
                   'atomarray': check_any      #attrib
                  }

    
def check_type(types: list, arg: str):
    """
    Checks a single argument against a list of types.

    Returns True if the argument matches any of the types.
    Returns False if the argument matches none of the types. 
    An empty list means the refpage gives the argument no type, so anything matches.
    """
    return not types or any([typecheck_funcs[t](arg) for t in types])