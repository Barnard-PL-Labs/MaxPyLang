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
