"""Pre-instantiated MaxObject stubs for all imported packages."""
import warnings
from maxpylang.exceptions import UnknownObjectWarning

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
    try:
        from .gen import *
    except ImportError:
        pass
