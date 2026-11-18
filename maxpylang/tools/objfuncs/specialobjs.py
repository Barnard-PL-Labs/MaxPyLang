"""
tools.objfuncs.specialobjs

Methods to handle special objects.

    create_js() --> for creating js objects, look for ext files and update object accordingly
    update_js_from_file() --> update inlets, outlets, args, and text of js object according to file
    get_js_filename() --> get js object filename from args
    link_js() --> links js object to an external file

    link_abstraction() --> links abstraction to external file

"""

from pathlib import Path
import os
import json
import copy

from maxpylang.tools import typechecks as tc


def create_js(self, from_dict=None):
    """
    Special-case: update for js objects.

    Updates self._dict entries (filename, text), self._args, and self._ext_file.

    Update filename:
        if from_dict:
            do nothing (should be in there already)
        else:
            filename is third arg + .js
                if third arg doesn't exist, do nothing
                if third arg already ends in js, don't append
            Update dict['box']['saved_object_attributes']['filename']

    Try to find file:
        look in current folder, if not found, print warning and mark as not found
        else, put (absolute) path as self._ext_file

    Update args and text:
        If updating from dict, look at numinlets/numoutlets.
        Else, look at the provided js file for inlets/outlets markers.
            If no js file provided, do nothing (default 1 in, 1 out)
            Or if js file doesn't specify, do nothing (default in/out)


    """

    #1. get filename
    if not from_dict: #get filename from args
        filename = self.get_js_filename()
        if filename is None:
            print ("ObjectWarning: js : creation : no filename specified")
            return
        else:
            self._dict['box']['saved_object_attributes']['filename'] = filename #save to dict

    #if from dict, get filename from dict
    else:
        filename = self._dict['box']['saved_object_attributes']['filename']



    #2. try to find file, looking only in current directory
    if os.path.exists(filename):
        self._ext_file = os.path.abspath(filename)
        print("  ObjectMsg: js : creation :", filename, "found, parsing for inlet/outlet numbers")
    else:
        print("ObjectError: js : creation :", filename, "not found in current directory, file not linked")
        if not from_dict:
            return


    #update args and text from dict
    if from_dict:
        numinlets = self._dict['box']['numinlets']
        numoutlets = self._dict['box']['numoutlets']
        self._args = [numinlets, numoutlets, filename]
        self.update_text()


    #or, update args and text from file, and make proper ins/outs
    else:
        self.update_js_from_file(filename, log_var="creation")

    return


def update_js_from_file(self, filename, log_var=None):
    """
    References external .js file to update js object inlets, outlets, args, and text.
    """

    #ASSUME INLET/OUTLET NUMBERS SET ONLY ONCE IN JS FILE.......
    #get inlet/outlet numbers
    numinlets, numoutlets = self.get_js_io(filename, log_var=log_var)

    #set new args
    self._args = [numoutlets, numinlets, filename]

    #edit to update text and inlet/outlets
    new_args_string = [str(numoutlets), str(numinlets), filename]
    self.edit(text = " ".join(new_args_string), text_add="replace")

    print("  ObjectMsg: js :", log_var, ":", numinlets, "inlets,", numoutlets, "outlets in accordance with", filename)

    return

def get_js_io(self, filename, log_var=None):
    """
    Get the number of ins and outs from an external js file.
    """

    with open(filename, 'r') as f:
        lines = f.readlines()
        numinlets = None
        numoutlets = None

        #look thru file to get (first occurence of) numinlets/numoutlets being set
        i = 0
        while (i < len(lines)) and (numinlets is None or numoutlets is None):
            line = lines[i]
            if "inlets" in line:
                numinlets = line.split(";")[0].split("//")[0].split("=")[1].strip() #parse lines
            elif "outlets" in line:
                numoutlets = line.split(";")[0].split("//")[0].split("=")[1].strip()
            i+= 1

        #if inlets/outlets not found...
        if numinlets is None or numoutlets is None:
            print("ObjectWarning: js :", log_var, ":", "inlet/outlet numbers not found in",
                  filename, "defaults assumed (1 inlet, 1 outlet)")
            numinlets = 1
            numoutlets = 1

    return numinlets, numoutlets



def get_js_filename(self):
    """
    Gets the js filename from js args.
    Returns None if no filename in args.
    """

    try:
        filename = [x for x in self._args if not tc.check_number(x)][0] #use first non-number arg as filename
        if ".js" not in Path(filename).suffixes: #add .js if necessary
            filename += ".js"

    except IndexError:
        filename = None

    return filename



def link_js(self, link_file=None):

    """
    Helper function for linking.

    Links a js object to external .js file, and updates js object args/text to match.
    If no file given, try to link to its current filename.
    """

    #if no file given, get it from js object
    if link_file is None:
        link_file = self._dict['box']['saved_object_attributes']['filename']
        #if no existing filename, give error and return
        if link_file == '':
            print("ObjectError: js : link : no filename specified")
        return

    #now we have a link_file, check it for existence, looking only in current directory
    if os.path.exists(link_file):

        #set ext_file if it exists
        self._ext_file = os.path.abspath(link_file)
        print("js : link :", link_file, "found, parsing for inlet/outlet numbers")

    else: #else, give error and return
        print("ObjectError: js : link :", link_file, "not found in current directory, file not linked")
        return

    #lastly, update js object from given file
    self.update_js_from_file(link_file, log_var="link")

    return



def create_abstraction(self, text=None, extra_attribs=None, from_dict=True):
    """
    Helper function for instantiating an abstraction.

    *abstractions will NOT have args/text attribs checked....so users must make sure those parts are correct.
    *abstractions will only have common box attribs available
    *also apparently Max will take those fine lmao so whatever
    """

    #name, args, text_attribs, ref_file all inputted already
    #if from_dict, also dict filled
    #missing: (dict), ins/outs, ext_file


    #fill in ext_file
    self._ext_file = self.name
    if ".maxpat" not in self.name:
        self._ext_file += ".maxpat"

    if not from_dict:
        self.update_abstraction_from_file(text, extra_attribs, log_var="creation")


    else:
        self.make_xlets_from_self_dict()
        print("  ObjectMsg:", self.name, ": creation :", self._ext_file, "file found, abstraction created")

    return


def update_abstraction_from_file(self, text, extra_attribs, log_var=None):
    """
    Update abstraction dictionary, extra attribs, and xlets from external file.
    """

    #parse ext_file to get inlets/outlet numbers
    numinlets, numoutlets = self.get_abstraction_io()

    #fill in dict
    self._dict = copy.deepcopy(self.unknown_obj_dict)
    self._dict['box']['numinlets'] = numinlets
    self._dict['box']['numoutlets'] = numoutlets
    self._dict['box']['outlettype'] = [""] * numoutlets
    self._dict['box']['patching_rect'] = [0.0, 0.0] #only put position; Max will fill in the proper size
    self._dict['box']['text'] = text #use the whole inputted text, no arg/text_attrib testing

    #fill in attribs
    attrib_info = [{"name": "COMMON"}]
    x, extra_attribs = self.get_all_valid_attribs({}, extra_attribs, attrib_info)
    self.add_extra_attribs(extra_attribs)


    #create ins/outs from dict
    self.make_xlets_from_self_dict()

    #log abstraction creation
    print("  ObjectMsg:", self.name, ":", log_var, ":", self._ext_file, "file found, abstraction created")

    return

def create_declared_abstraction(self, text, numinlets, numoutlets, extra_attribs):
    """
    Create an abstraction with user-declared I/O counts (no file needed).

    Used when abstraction=True is passed to MaxObject, allowing users to declare
    abstractions that don't exist in the current working directory.
    """

    #fill in ext_file
    self._ext_file = self.name
    if ".maxpat" not in self.name:
        self._ext_file += ".maxpat"

    #fill in dict
    self._dict = copy.deepcopy(self.unknown_obj_dict)
    self._dict['box']['numinlets'] = numinlets
    self._dict['box']['numoutlets'] = numoutlets
    self._dict['box']['outlettype'] = [""] * numoutlets
    self._dict['box']['patching_rect'] = [0.0, 0.0]
    self._dict['box']['text'] = self._name  #start with just the name

    #fill in attribs
    self._text_attribs, extra_attribs = self.get_all_valid_attribs(
        self._text_attribs, extra_attribs, [{"name": "COMMON"}]
    )
    self.add_extra_attribs(extra_attribs)

    #update text with args and attribs
    self.update_text()

    #create ins/outs from dict
    self.make_xlets_from_self_dict()

    return


def get_abstraction_io(self):
    """
    Returns the number of inlets and outlets in an abstraction file.
    """

    numinlets = 0
    numoutlets = 0

    #read file, get list of objects
    with open(self._ext_file, 'r') as f:
        boxes = json.loads(f.read())['patcher']['boxes']

    #look for inlets/outlets
    for box in boxes:
        if box['box']['maxclass'] == "inlet":
            numinlets += 1
        elif box['box']['maxclass'] == 'outlet':
            numoutlets += 1

    return numinlets, numoutlets


def link_abstraction(self, link_file=None):
    """
    Helper function for linking.

    Links an unknown object or abstraction object to external .maxpat file.
    Updates object name to match given file, and updates object ins/outs to match external file.
    If no file given, try to link to [name].maxpat file.
    """

    #if file not given, use object name
    if link_file is None:
        link_file = self.name

    #add extension if necessary
    if '.maxpat' not in link_file:
        link_file += '.maxpat'

    #check file for existence
    if os.path.exists(link_file): #if found....
        self._ref_file = "abstraction"
        self._ext_file = link_file

        #update name to new file name
        self._name = Path(link_file).stem

        #update from file, with new text and old extra_attribs
        text = self.get_text()
        extra_attribs = self.get_extra_attribs()
        self.update_abstraction_from_file(text, extra_attribs, log_var="link")

    else: #if not found...
        print("ObjectError:", self.name, ": link :", link_file, "not found in current directory, file not linked")

    return


def get_trigger_out_types(self):
    """
    Special-case: getting trigger outlet types.
    """
    types = []
    for arg in self._args:
        if arg == 'b':
            types.append('bang')
        elif tc.check_int(arg) or arg == 'i':
            types.append('int')
        elif tc.check_number(arg) or arg =='f':
            types.append('float')
        elif arg in ('s', 'l'):
            types.append('')
        else:   #a constant symbol (t clear b): Max saves the symbol itself
            types.append(arg)
    return types

def get_unpack_out_types(self):
    """
    Special-case: getting unpack outlet types.
    """
    types = []
    for arg in self._args:
        if tc.check_int(arg) or arg == 'i':
            types.append('int')
        elif tc.check_number(arg) or arg == 'f':
            types.append('float')
        else:
            types.append('')
    return types

def update_vst(self):
    """
    Special-case: dict update from args.
    """

    self._dict['box']['save'].remove(";")
    self._dict['box']['save'] += self._args
    self._dict['box']['save'].append(";")

    return
