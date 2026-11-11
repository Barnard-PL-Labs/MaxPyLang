"""
tools.objfuncs.instantiation

Methods related to object instantiation.
"""


def build_from_specs(self, text, extra_attribs, abstraction=False, inlets=None, outlets=None):
    """
    Helper function for initialization.

    Builds object from in-box text and extra attributes given.
    """

    #parse into name, args, text_attribs
    self._name, self._args, self._text_attribs = self.parse_text(text)

    #if declared as abstraction, skip ref lookup and build directly
    if abstraction:
        self._ref_file = "abstraction"
        self.create_declared_abstraction(text, inlets or 0, outlets or 0, extra_attribs)
        return

    #find reference file
    ref_file = self.get_ref(self._name)
    
    #if not found, treat as unknown object (0 in/outs, keep text/args/text_attribs)
    if ref_file == "not_found":
        self._ref_file = None
        self._dict = self.unknown_obj_dict
        self.update_text()
        return
    
    #if abstraction, create as abstraction
    if ref_file == "abstraction":
        self._ref_file = ref_file
        self.create_abstraction(text=text, extra_attribs=extra_attribs, from_dict=False)
        return
    
    #for normal objs...

    #read ref file
    info = self.get_info(ref_file=ref_file)

    #check that args given are valid; if not, return empty object
    if not self.args_valid(self._name, self._args, info['args']):
        self._ref_file = None
        self._dict = self.unknown_obj_dict
        self.update_text()
        return

    #now, fill in the object
    self._ref_file = ref_file
    self._dict = info['default']
    self._text_attribs, extra_attribs = self.get_all_valid_attribs(self._text_attribs, extra_attribs, info['attribs'])
    self.make_xlets_from_self_dict()

    #add or remove ins/outs based on arguments
    self.update_ins_outs(info['in/out'], info['default'])

    #add extra attributes to dict
    self.add_extra_attribs(extra_attribs)

    #update text box with name, args, text attribs
    self.update_text()
    
    #if it's a js object, additional js handling
    if self.name =="js":
        self.create_js(from_dict=False)


    return
    
    
    
def build_from_dict(self, given_dict):

    """
    Helper function for instantiation.

    Builds object from given json dict representation. 
    """

    #get name, args, attribs
    if given_dict['box']['maxclass'] == 'newobj': #not ui obj
        self._name, self._args, self._text_attribs = self.parse_text(given_dict['box']['text'])
    else: #ui obj
        self._name = given_dict['box']['maxclass']

    #find reference file; if not found, mark with None
    self._ref_file = self.get_ref(self._name)
    if self._ref_file == "not_found":
        self._ref_file = None
        #****we still want to fill in the dict/xlets tho bc unknown obj might have stuff connected to it!!!
        
   
    #fill in dict
    self._dict = given_dict
    
    #treat abstraction
    if self._ref_file == "abstraction":
        self.create_abstraction(from_dict=True)
        return
    
    #if it's a js file, update obj
    if self.name == "js":
        self.create_js(from_dict=True)
    self.make_xlets_from_self_dict()
    
    return

