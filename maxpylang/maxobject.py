"""
Class representing a MaxObject.
"""


from .tools import misc


class MaxObject():
    """
    This class represents a Max object within a Max patch.

    To create a *cycle~* object with a frequency of 440 Hz, you would use the in-box text: ``"cycle~ 440"``. \
    
    You can also include attributes in the in-box text by using the '@' symbol followed by the attribute name and value. \
    For example, to create a *jit.movie* object that loads the file *crashtest.mov*, you would use the in-box text: \
    ``"jit.movie @moviefile crashtest.mov"``.
    TODO: this seems to not work for UI objects maybe. \

    Objects have inlets and outlets, which are accessible via the ``.ins`` and ``.outs`` properties, respectively. \
    You can access individual inlets and outlets by indexing into these lists. For example, to access the first outlet of an object \
    named *myobj*, you would use ``myobj.outs[0]``.
    """
    #class variables
    arg_warning = True                              #flag to give argument warnings; can be turned off by user
    known_objs = misc.get_objs()                    #objs that have been templated
    from .tools.constants import common_box_attribs #common box attribs shared by non-ui objects
    from .tools.constants import obj_info_folder    #where to find the obj info
    from .tools.constants import unknown_obj_dict   #dictionary of unknown object


    def __init__(self, text, from_dict=False, abstraction=False, inlets=None, outlets=None, **extra_attribs):

        """
        Initialize a MaxObject.

        from_dict = False --> initialize from in-box text (normal initialization in Max env)
            text --> in-box text
            extra_attribs --> attributes to change, formatted as attribute_name = val

        from_dict = True --> initialize from given json dict representation of obj (for loading in from existing file)
            text --> json dict
            extra_attribs --> not used

        abstraction = True --> treat as abstraction without needing the .maxpat file in cwd
            inlets --> number of inlets (default 0)
            outlets --> number of outlets (default 0)

        """

        #instance vars
        self._ref_file = None      #reference file
        self._dict = None          #json rep
        self._name = None          #object name
        self._args = None          #only the args typed in-box
        self._text_attribs = None  #only includes attributes typed in-box
        self._ins = []             #list of Inlets
        self._outs = []            #list of Outlets
        self._ext_file = None      #external file, for js or abstraction
        self._in_patch = False     #set once placed, so placing again makes a copy
        self._is_stub = False      #set on the maxpylang.objects stubs, which are never placed themselves

        if from_dict:
            self.build_from_dict(text)

        else:
            self.build_from_specs(text, extra_attribs, abstraction=abstraction, inlets=inlets, outlets=outlets)

        return


    #some properties...
    @property
    def name(self):
        """
        The name of the MaxObject, e.g. 'sel', 'bang', 'js'.
        """
        return self._name

    @property
    def ins(self):
        """
        A list of Inlet objects attached to the MaxObject.
        """
        return self._ins

    @property
    def outs(self):
        """
        A list of Outlet objects attached to the MaxObject.
        """
        return self._outs

    def __call__(self, *args, **attribs):
        """
        Make a new object of the same class with in-box arguments and attributes.

        ``cycle_tilde(440)`` is ``MaxObject("cycle~ 440")``, and
        ``metro(500, active=1)`` is ``MaxObject("metro 500 @active 1")``.
        """
        words = [self._name] + [str(arg) for arg in args]
        for attrib, val in attribs.items():
            vals = val if isinstance(val, (list, tuple)) else [val]
            words += ["@" + attrib] + [str(v) for v in vals]

        # an abstraction's inlets and outlets come from its contents, not its arguments
        if self._ref_file == "abstraction":
            return MaxObject(" ".join(words), abstraction=True,
                             inlets=len(self._ins), outlets=len(self._outs))

        return MaxObject(" ".join(words))

    from .tools.objfuncs.exposed import move, edit, link, inspect #exposed functions for user use




    #************functions not meant for user use....

    #INSTANTIATION FUNCTIONS
    from .tools.objfuncs.instantiation import build_from_specs, build_from_dict



    #TEXT FUNCTIONS
    from .tools.objfuncs.text import parse_text, update_text, get_text



    #REF FILE FUNCTIONS
    from .tools.objfuncs.reffile import get_ref, check_aliases, get_info



    #FOR XLETS
    from .tools.objfuncs.makexlets import make_xlets_from_self_dict

    #update/add/remove xlets
    from .tools.objfuncs.makexlets import update_ins_outs, parse_io_num, add_xlets, remove_xlets, update_dict_io_nums

    #xlet typing
    from .tools.objfuncs.makexlets import update_xlet_typing, parse_io_typing


    #FOR ARGS
    from .tools.objfuncs.args import args_valid, get_typed_args



    #FOR ATTRIBS
    from .tools.objfuncs.attribs import add_extra_attribs, get_all_valid_attribs, \
                                        remove_bad_attribs, retain_attribs, get_extra_attribs



    #FOR SPECIAL OBJS
    from .tools.objfuncs.specialobjs import create_js, get_js_filename, get_js_io, update_js_from_file, link_js, \
                                            create_abstraction, get_abstraction_io, \
                                            update_abstraction_from_file, link_abstraction,  \
                                            create_declared_abstraction, \
                                            get_trigger_out_types, get_unpack_out_types, update_vst



    #MISC FUNCTIONS
    from .tools.objfuncs.misc import notknown, __repr__


    #temporary debug
    def debug(self):
        print("ref_file", self._ref_file)
        print("dict", self._dict)
        print("name", self._name)
        print("args", self._args)
        print("text_attribs", self._text_attribs)
        print("ins", self._ins)
        print("outs", self._outs)
        print("ext_file", self._ext_file)

        return
