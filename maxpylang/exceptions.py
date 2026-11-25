"""
Custom warning classes for MaxPyLang.
"""


class UnknownObjectWarning(UserWarning):
    """Raised when a Max object name is not recognized."""
    pass


class ConnectionWarning(UserWarning):
    """Raised when a patch cord sends audio into an inlet that takes no audio."""
    pass


class GraphWarning(UserWarning):
    """Raised at save for a problem in the shape of the patch: a hot loop, audio feedback with
    no delay, or an object whose output reaches nothing."""
    pass


class AttributeWarning(UserWarning):
    """Raised when an attribute given to an object is dropped: the object has no attribute of
    that name, or the value has the wrong type or too few items."""
    pass


class MessageWarning(GraphWarning):
    """Raised at save for a problem with the messages on a cord: an object sent a message it
    has no method for, an object that answers before its right inlet has the new value, or
    an object fed only on its right inlets, which never answers. A GraphWarning, so a filter
    on those catches these too."""
    pass


class DeviceWarning(GraphWarning):
    """Raised at save for a problem with a Max for Live device or its parameters: a device
    that lacks what its type needs, output that nothing limits, two parameters with one
    name, a parameter that controls nothing, or a parameter whose range does not fit the
    inlet it feeds. A GraphWarning, so a filter on those catches these too."""
    pass
