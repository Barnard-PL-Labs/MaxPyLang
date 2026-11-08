"""
Classes for Inlets and Outlets of MaxObjects.
"""

from typing import Generic

from .rates import R_co, R_contra


class Inlet(Generic[R_contra]):
    """
    Class representing MaxObject Inlet. 

    Generic over the rate it accepts (see maxpylang.rates), for static checking only.
    
    Keeps track of patchcords through a list of source Outlets.
    Also keeps track of midpoints of the cord, if any. 
    """
    
    def __init__(self, parent, index, sources=None, midpoints=None, types=None):
        
        self._parent = parent             #parent MaxObject
        self._sources = sources or []     #list of Outlets
        self._midpoints = midpoints or [] #list of midpoints (this info only in inlet of outlet, inlet pair) 
        self._types = types or []         #allowed connection types 
        self._index = index               #index in parent object, starting from 0

    
    #some properties for getting info...
    @property
    def parent(self):
        return self._parent
    
    @property
    def sources(self):
        return self._sources
    
    @property
    def midpoints(self):
        return self._midpoints
    
    @property
    def types(self):
        return self._types
    
    @property
    def index(self):
        return self._index
    
    
    #for printing out...
    def __repr__(self):
        
        #report parent, index, and types
        rep = self._parent._name + ": inlet " + str(self._index) + ", types taken: " + str(self._types)
        
        #report sources and existing midpoints
        for source in self._sources:
            rep += "\n\tsource: " + source._parent._name + ": outlet " + str(source._index)
            if self._midpoints[self._sources.index(source)] is not None:
                rep += ", midpoints: " + str(self._midpoints[self._sources.index(source)])
            
        return rep

    
    
    
class Outlet(Generic[R_co]):
    """
    Class representing MaxObject Outlets.

    Generic over the rate it sends (see maxpylang.rates), for static checking only.
    
    Keeps track of patchcords through list of destination Inlets. 
    """
    
    def __init__(self, parent, index, destinations=None, types=None):
        
        self._parent = parent                   #parent MaxObject
        self._destinations = destinations or [] #list of Inlets
        self._types = types or []               #output types
        self._index = index                     #index in parent object, starting from 0
        
        
    #some properties for getting info...
    @property
    def parent(self):
        return self._parent
    
    @property
    def destinations(self):
        return self._destinations
    
    @property
    def types(self):
        return self._types
    
    @property
    def index(self):
        return self._index

    
    #for printing out...
    def __repr__(self):
        
        #report parent, index, and types
        rep = self._parent._name + ": outlet " + str(self._index) + ", types output: " + str(self._types)
        
        #report destinations
        for destination in self._destinations:
            rep += "\n\tdestination: " + destination._parent._name + ": inlet " + str(destination._index)
            if destination._midpoints[destination._sources.index(self)] is not None:
                rep += ", midpoints: " + str(destination._midpoints[destination._sources.index(self)])
                
        return rep