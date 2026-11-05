"""Pre-instantiated MaxObject stubs for all imported packages."""
import warnings
from maxpylang.exceptions import UnknownObjectWarning
from maxpylang.maxobject import MaxObject as _MaxObject

# Stubs intentionally create objects without args; suppress warnings during import
with warnings.catch_warnings():
    warnings.simplefilter("ignore", UnknownObjectWarning)
    try:
        from .jit import *
    except ImportError:
        pass
    try:
        from .max import *
    except ImportError:
        pass
    try:
        from .msp import *
    except ImportError:
        pass

# Stubs are templates: placing or calling one makes a new object
for _stub in list(globals().values()):
    if isinstance(_stub, _MaxObject):
        _stub._is_stub = True
del _stub
