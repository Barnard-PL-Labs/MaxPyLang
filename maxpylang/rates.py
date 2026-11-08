"""
Rates: what travels on a patch cord, as seen by a static type checker.

Inlets and outlets are generic over a rate, so ``Outlet[Signal]`` is an audio
outlet and ``Inlet[Control]`` is an inlet that only takes messages. A checker
such as ty or mypy then rejects ``patch.connect((osc.outs[0], flonum.ins[0]))``.

These classes are markers only and are never instantiated.

    Control  --> messages: numbers, symbols, lists, bang
    Matrix   --> a Jitter matrix; it travels as a message, so it is a Control
    Signal   --> MSP audio
    MCSignal --> multichannel audio; legal wherever a Signal is

Control into an audio inlet is always allowed, because most audio inlets also
take messages (``start``, a float for a constant). Only Signal into an inlet
that takes no audio is rejected.
"""

from typing import TypeVar


class Control:
    """Messages: numbers, symbols, lists and bang."""


class Matrix(Control):
    """A Jitter matrix, sent as a ``jit_matrix`` message."""


class Signal:
    """MSP audio."""


class MCSignal(Signal):
    """Multichannel audio."""


R = TypeVar("R")
R_co = TypeVar("R_co", covariant=True)
R_contra = TypeVar("R_contra", contravariant=True)
