"""
tools.patchfuncs.patchcords

Methods related to patchcords in a MaxPatch.

    connect() --> create patchcords connecting objects

    check_connection_format() --> check connections are specified correctly as (Outlet, Inlet, [midpoints]) tuples
    check_connection_typing() --> check connections are allowed wrt typing *TBD*

    check_connection_exists() --> for deleting - check connection exists

    swap_patchcords() --> for replacing - swap all possible patchcords between two objects


"""
from __future__ import annotations

from maxpylang.cordcheck import warn_if_problem
from maxpylang.xlet import Inlet, Outlet

# user usage
def connect(self, *connections, verbose=True):
    """
    This method creates patchcords to connect objects. *currently fixing connection specification...*

    :param \\*connections: a list of connections to make. Each connection must be specified as a tuple \
    (:class:`~maxpy.Outlet`, :class:`~maxpy.Inlet` (, ``list``)). The optional third element specifies midpoints \
    (curves) of the patchcord as a list of [x, y] coordinates.

    :param verbose: for logging output.
    :type verbose: bool, optional; default: True

    :returns: None
    """

    # check correct format, remove incorrectly typed connections
    self.check_connection_format(connections)
    connections = self.check_connection_typing(connections)

    link_cords(connections, verbose=verbose)

    return


def link_cords(connections, verbose=True):
    """
    Helper function for patchcords.

    Records already-checked connections in the inlets and outlets they join.
    """

    # update inlet sources, outlet destinations, midpoints
    for connection in connections:
        inlet = connection[1]
        outlet = connection[0]
        midpoints = [None]
        if len(connection) == 3:
            midpoints = connection[2]

        inlet._sources.append(outlet)
        inlet._midpoints.append(midpoints)
        outlet._destinations.append(inlet)

        if verbose:
            print(
                "Patcher: connected: (",
                outlet.parent.name,
                ": outlet",
                outlet.index,
                "--->",
                inlet.parent.name,
                ": inlet",
                inlet.index,
                ")",
            )

    return


def swap_patchcords(self, new, old):
    """
    Helper function for replace.

    Swaps all possible patchcords from the old object to new object.
    """

    new_connections = []
    old_connections = []

    # get patchcords coming into remaining inlets
    for old_in, new_in in zip(old.ins[: len(new.ins)], new.ins):
        # get all source outlets
        for source in old_in.sources:
            # get midpoints associated with this particular source outlet
            midpoints = old_in._midpoints[old_in.sources.index(source)]

            # add connections to lists
            old_connections.append([source, old_in, midpoints])
            new_connections.append([source, new_in, midpoints])

    # get patchcords coming out of remaining outlets
    for old_out, new_out in zip(old.outs[: len(new.outs)], new.outs):
        # get all destination inlets
        for destination in old_out.destinations:
            # get midpoints associated with this particular destination inlet
            midpoints = destination._midpoints[destination.sources.index(old_out)]

            # add connections to lists
            old_connections.append([old_out, destination, midpoints])
            new_connections.append([new_out, destination, midpoints])

    # check the new connections before changing anything, so a ConnectionWarning raised
    # as an error (strict mode) leaves the patch as it was
    self.check_connection_format(new_connections)
    new_connections = self.check_connection_typing(new_connections)

    # delete old connections
    self.delete_cords(*old_connections)
    # connect new connections
    link_cords(new_connections)

    return


def check_connection_format(self, connections):
    """
    Helper function for patchcords.

    Checks proper formatting for connection specifications.
    """

    for connection in connections:
        assert (
            isinstance(connection[0], Outlet)
            and isinstance(connection[1], Inlet)
            and f"connections must be specified as (Outlet, Inlet, [optional: midpoints])"
        )
        if len(connection) == 3:
            assert isinstance(
                connection[2], list
            ), f"optional midpoints must be specified as list"

        # a stub is a template and is never in a patch, so its cord would never be saved
        for xlet in connection[:2]:
            if xlet.parent._is_stub:
                raise ValueError(
                    f"'{xlet.parent.name}' is a stub from maxpylang.objects, which is never placed "
                    f"itself. Connect the object place() returned instead, e.g. "
                    f"obj = patch.place(stub)[0]"
                )

    return


def check_connection_typing(self, connections):
    """
    Helper function for patchcords.

    Warns about connections that send audio into an inlet that takes no audio. The
    connections are kept, as Max keeps them, and returned unchanged.
    """
    for connection in connections:
        warn_if_problem(connection[0], connection[1])

    return connections


def check_connection_exists(self, connections):
    """
    Helper function for patchcords.

    Removes nonexistent connections from list and returns updated list.
    """

    existing_connections = []

    for connection in connections:
        outlet = connection[0]
        inlet = connection[1]

        # check outlet has destination, inlet has source
        if (inlet in outlet.destinations) and (outlet in inlet.sources):
            existing_connections.append(connection)
        else:
            print(
                "PatchError:",
                outlet.parent.name,
                ": outlet",
                outlet.index,
                "not connected to",
                inlet.parent.name,
                ": inlet",
                inlet.index,
            )

    return existing_connections
