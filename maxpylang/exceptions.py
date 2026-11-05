"""
Custom warning classes for MaxPyLang.
"""


class UnknownObjectWarning(UserWarning):
    """Raised when a Max object name is not recognized."""
    pass


class ConnectionWarning(UserWarning):
    """Raised when a patch cord sends audio into an inlet that takes no audio."""
    pass
