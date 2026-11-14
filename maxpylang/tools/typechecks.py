"""
Methods for checking datatypes.
"""

def check_number(arg):
    """
    Check for number (float or int).
    """
    try:
        float(arg)
        return True
    except ValueError:
        return False 


def check_any(arg):
    """
    Check if it's "anything"....
    """
    return True


def check_int(arg):
    """
    Check int. 
    """
    try:
        int(arg)
        return True
    except ValueError:
        return False
    
#functions associated with types, for typechecking
typecheck_funcs = {'int': check_number,        #attrib
                   'symbol': check_any,        #attrib
                   'number': check_number, 
                   'list': check_any,
                   'any': check_any, 
                   'float': check_number,      #attrib
                   'atom_long': check_number,  #attrib
                   'atom': check_any,          #attrib
                   'int32': check_number,      #attrib
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