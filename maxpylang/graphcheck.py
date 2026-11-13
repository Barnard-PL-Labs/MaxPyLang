"""
graphcheck

Checks over the whole patch graph, which no single cord can show. They run when the patch
is saved, once every cord exists.

    hot loop         a message cycle where every cord lands on a hot inlet and nothing in
                     the cycle delays, so one message loops without end
    audio feedback   a signal cycle with no delay in it
    dead output      an object whose output never reaches an output, a display or a side
                     effect, or that has no cords at all

The roles behind them (what counts as an output, which objects break a loop, which have
every inlet hot) are in data/graph_roles.json, ported from maxpy-studio's failure-taxonomy
analysis (research/failure-taxonomy/analyze_patches.py) so both use the same definitions.

Objects whose insides maxpylang cannot see (subpatchers, abstractions, js, unknown objects)
never cause a report: they might do anything.

Dead outputs are a heuristic. Besides the listed roles, a chain ends well in any UI box that
is fed and passes no audio on, a jit.gl object, a message box fed on its right inlet, or a
message starting with ";". Against Max's own shipped patches this reports 105 of 3185
patchers, mostly boxes with no cords at all; without those ends it reported 1002.

Hot loops are reported conservatively. "Leftmost inlet is hot" does not hold for UI objects,
which often take a value without sending it on, so a message cycle is not reported when it
passes through anything that may stop it: a conditional object (sel, gate, route, urn, ...), a
UI object, a `set` message, a Jitter object, or something clocked (line, metro, ...). Against
Max's own shipped patches the unnarrowed rule reports 213 cycles, all in working patches; this
one reports none.

    find_problems() --> problems in a graph given as plain data
    from_patch()    --> that data for a MaxPatch
    from_json()     --> that data for one patcher of a .maxpat, as the corpus test uses it
    warn_problems() --> GraphWarning for each problem, reported at the user's line
"""

import collections
import functools
import json
import re
import warnings
from pathlib import Path

from .cordcheck import _max_name, _table, _user_stacklevel
from .exceptions import GraphWarning

_DATA = Path(__file__).resolve().parent / "data"

SIGNAL_TYPES = ("signal", "multichannelsignal")
_SET_MESSAGE = re.compile(r"\s*(set\b|prepend set\b|append set\b)")

# names: the object's names (as typed, and as maxpylang files it); outlet_types: as Max saves
# them; opaque: what it does is not known; label: how messages name it; ui: a UI box;
# text: the box text, to spot `set` messages
Node = collections.namedtuple("Node", "names outlet_types opaque label ui text")
Problem = collections.namedtuple("Problem", "kind message nodes")


@functools.lru_cache(maxsize=None)
def roles():
    with open(_DATA / "graph_roles.json", encoding="utf-8") as f:
        return {key: frozenset(names) for key, names in json.load(f).items() if not key.startswith("_")}


@functools.lru_cache(maxsize=None)
def _aliases():
    with open(_DATA / "OBJ_INFO" / "obj_aliases.json", encoding="utf-8") as f:
        return json.load(f)


@functools.lru_cache(maxsize=None)
def _known():
    return frozenset(_table()) | frozenset().union(*roles().values())


def _is(names, role):
    return not names.isdisjoint(roles()[role])


def _sinks(max_for_live):
    r = roles()
    sinks = r["audio_out"] | r["midi_out"] | r["side_effect"] | r["display"]
    return sinks if max_for_live else sinks | r["audio_out_outside_max_for_live"]


def _is_hot(node, inlet):
    return inlet == 0 or _is(node.names, "all_inlets_hot")


def _may_stop(node):
    """A message cycle through this node may stop, so a hot loop through it is not reported."""
    return (node.opaque or node.ui or _is(node.names, "conditional") or _is(node.names, "ui")
            or _is(node.names, "clocked") or bool(_SET_MESSAGE.match(node.text))
            or any(name.startswith("jit.") for name in node.names))


def cycles(nodes, adj):
    """Strongly connected components with a cycle in them (more than one node, or a node
    with an edge to itself). Tarjan's algorithm, iterative, so deep patches cannot hit
    Python's recursion limit."""
    index, low, on_stack, stack, found = {}, {}, set(), [], []
    counter = 0
    for root in nodes:
        if root in index:
            continue
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)
        work = [(root, iter(adj.get(root, ())))]
        while work:
            v, edges = work[-1]
            for w in edges:
                if w not in index:
                    index[w] = low[w] = counter
                    counter += 1
                    stack.append(w)
                    on_stack.add(w)
                    work.append((w, iter(adj.get(w, ()))))
                    break
                if w in on_stack:
                    low[v] = min(low[v], index[w])
            else:
                work.pop()
                if work:
                    low[work[-1][0]] = min(low[work[-1][0]], low[v])
                if low[v] == index[v]:
                    component = []
                    while True:
                        w = stack.pop()
                        on_stack.discard(w)
                        component.append(w)
                        if w == v:
                            break
                    if len(component) > 1 or v in adj.get(v, ()):
                        found.append(component)
    return found


def find_problems(nodes, edges, max_for_live=False):
    """
    nodes: {node id: Node}. edges: (source, outlet, destination, inlet) for every cord.
    max_for_live: inside a device, dac~ and ezdac~ are not outputs.
    """

    def kind_of(source, outlet):
        types = nodes[source].outlet_types
        return types[outlet] if outlet < len(types) else ""

    def describe(component):
        return ", ".join(sorted(nodes[n].label for n in component))

    problems = []

    # audio feedback: a signal cycle. tapin~ -> tapout~ is a tapconnect cord, not a signal, so
    # it breaks the cycle; delay~ is inside the signal chain and does not.
    signal_adj = collections.defaultdict(set)
    for source, outlet, dest, _ in edges:
        if kind_of(source, outlet) in SIGNAL_TYPES:
            signal_adj[source].add(dest)
    for component in cycles(list(nodes), signal_adj):
        if any(nodes[n].opaque for n in component):
            continue
        problems.append(Problem("audio feedback", f"audio feedback with no delay through {describe(component)}. "
                                "Put a delay in the loop: tapin~ and tapout~, or send~ and receive~.", component))

    # hot loops: message cycles through hot inlets that nothing in the cycle can stop
    hot_adj = collections.defaultdict(set)
    for source, outlet, dest, inlet in edges:
        if kind_of(source, outlet) in SIGNAL_TYPES + ("tapconnect",):
            continue
        if _is(nodes[source].names, "loop_breakers") or _is(nodes[dest].names, "loop_breakers"):
            continue
        if _is_hot(nodes[dest], inlet):
            hot_adj[source].add(dest)
    for component in cycles(list(nodes), hot_adj):
        if any(_may_stop(nodes[n]) for n in component):
            continue
        problems.append(Problem("hot loop", f"hot loop through {describe(component)}: every cord lands on a hot "
                                "inlet, so one message loops without end. Send one cord into a cold inlet, "
                                "or put deferlow or delay in the loop.", component))

    # dead outputs: walk back from everything that has an effect, then report what is left,
    # one warning per connected group
    sinks = _sinks(max_for_live)
    fed = {dest for _, _, dest, _ in edges}
    # a message box shows what arrives at its right inlet
    shown_messages = {dest for _, _, dest, inlet in edges if inlet == 1 and "message" in nodes[dest].names}

    def is_end(n):
        node = nodes[n]
        # an object with no outlets must do something with its input, except dac~ and ezdac~
        # inside Max for Live, which do nothing there
        silent_dac = max_for_live and _is(node.names, "audio_out_outside_max_for_live")
        # a UI box shows what it is given (umenu, led, kslider, plot~, ...), unless it passes
        # audio on: gain~ with nothing after it is a missing connection
        shows = (node.ui and n in fed and not silent_dac
                 and not any(kind in SIGNAL_TYPES for kind in node.outlet_types))
        # jit.gl objects draw into their context; a message starting with ";" sends by name
        draws = any(name.startswith("jit.gl.") for name in node.names)
        sends = "message" in node.names and node.text.lstrip().startswith(";")
        return (node.opaque or (not node.outlet_types and not silent_dac) or not node.names.isdisjoint(sinks)
                or _is(node.names, "named") or _is(node.names, "decor")
                or shows or draws or sends or n in shown_messages)

    feeders, linked = collections.defaultdict(set), collections.defaultdict(set)
    for source, _, dest, _ in edges:
        feeders[dest].add(source)
        linked[source].add(dest)
        linked[dest].add(source)
    live, frontier = set(), [n for n in nodes if is_end(n)]
    while frontier:
        n = frontier.pop()
        if n not in live:
            live.add(n)
            frontier.extend(feeders[n])
    dead = [n for n in nodes if n not in live]
    seen = set()
    for n in dead:
        if n in seen:
            continue
        group, todo = [], [n]
        while todo:
            m = todo.pop()
            if m in seen or m in live:
                continue
            seen.add(m)
            group.append(m)
            todo.extend(linked[m])
        if len(group) == 1 and not linked[n]:
            message = f"{nodes[n].label} is not connected to anything."
        else:
            message = f"{describe(group)}: output never reaches an output, a display, or a side effect."
        problems.append(Problem("dead output", message, group))

    return problems


def from_patch(patch):
    """find_problems() input for a MaxPatch: one node per object, keyed by box id."""
    ids = {id(obj): box_id for box_id, obj in patch.objs.items()}
    nodes, edges = {}, []
    for box_id, obj in patch.objs.items():
        box = (obj._dict or {}).get("box", {})
        canonical = _max_name(obj)
        names = frozenset(n for n in (obj.name, canonical) if n)
        opaque = canonical is None or obj.notknown() or _is(names, "opaque")
        outlet_types = box.get("outlettype") or [""] * len(obj.outs)
        ui = box.get("maxclass", "newobj") not in ("newobj", "message")
        nodes[box_id] = Node(names, outlet_types, opaque, f"{obj.name} ({box_id})", ui, box.get("text") or "")
        for outlet in obj.outs:
            for inlet in outlet.destinations:
                dest = ids.get(id(inlet.parent))
                if dest is not None:
                    edges.append((box_id, outlet.index, dest, inlet.index))
    return nodes, edges


def from_json(patcher):
    """find_problems() input for one patcher dict of a .maxpat (nested patchers are separate)."""
    boxes = {b["box"]["id"]: b["box"] for b in patcher.get("boxes", []) if "box" in b}
    nodes = {}
    for box_id, box in boxes.items():
        maxclass, text = box.get("maxclass", ""), box.get("text") or ""
        words = text.split()
        typed = words[0] if maxclass == "newobj" and words else maxclass
        names = frozenset({typed, _aliases().get(typed, typed)})
        opaque = "patcher" in box or _is(names, "opaque") or names.isdisjoint(_known())
        nodes[box_id] = Node(names, box.get("outlettype") or [], opaque, f"{typed} ({box_id})",
                             maxclass not in ("newobj", "message"), text)
    edges = []
    for line in patcher.get("lines", []):
        cord = line.get("patchline", {})
        (source, outlet), (dest, inlet) = cord.get("source", [None, 0]), cord.get("destination", [None, 0])
        if source in nodes and dest in nodes:
            edges.append((source, outlet, dest, inlet))
    return nodes, edges


def warn_problems(problems):
    """One GraphWarning per problem, at the first line outside maxpylang (the user's save())."""
    level = _user_stacklevel()
    for problem in problems:
        warnings.warn(problem.message, GraphWarning, stacklevel=level)
