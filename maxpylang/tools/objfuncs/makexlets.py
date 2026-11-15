"""
tools.obj.makexlets

Methods related to making/removing xlets in MaxObjects.

    make_xlets_from_self_dict() --> make xlets from information in self._dict

    update_ins_outs() --> (mostly driver func) update xlets according to text args

        parse_io_num() --> get new number of ins/outs by comparing text args with ref file info
        add_xlets() --> add the given number of xlets
        remove_xlets --> remove the given number of xlets

        update_xlet_typing() --> fill in proper type info for all xlets
            parse_io_typing --> read ref file info to get a list of types, one for each xlet

    Special-case functions:
    get_trigger_out_types() --> get outlet types for trigger object
    get_unpack_out_types() --> get outlet types for unpack object
    update_vst() --> update self.dict for vst~ object

"""

import re

from maxpylang.xlet import Inlet, Outlet
from maxpylang.tools import typechecks as tc


def make_xlets_from_self_dict(self):
    """
    Helper function for instantiation.

    Makes inlets and outlets based on information in self._dict.
    """

    #make inlets
    #******WOULD DO SOME INLET TYPING STUFF HERE......[TYPING NEEDED]
    self._ins = [Inlet(self, index) for index in range(self._dict['box']['numinlets'])]

    #get default outlet types
    out_types = [None] * self._dict['box']['numoutlets'] #default to none...

    #if they're given in the dict, retrieve
    if 'outlettype' in self._dict['box'].keys():

        out_types = self._dict['box']['outlettype'].copy()

        #change "" to "any", for typechecking purposes...
        out_types = ["any" if type == "" else type for type in out_types]

    #make outlets
    self._outs = [Outlet(self, index, types=x) for index, x in zip(range(self._dict['box']['numoutlets']), out_types)]


    return


#*************** UPDATE/ADD/REMOVE XLETS ***********************

def update_ins_outs(self, inout_info, default_info):
    """
    Helper function for instantiation and editing.

    Adds or removes inlets and outlets according to text arguments and in/out info.
    if removed xlets had connections, those connections are also removed.
    """

    #if no text args or no changes possible, do nothing
    if self._args==[] or inout_info=={}:
        return

    #add or remove inlets and outlets
    for xlet_type, self_xlets in zip(['numinlets', 'numoutlets'], [self._ins, self._outs]):
        #if there's updates
        if xlet_type in inout_info.keys():
            curr_xlets = len(self_xlets)
            new_xlets = self.parse_io_num(inout_info[xlet_type], curr_xlets) #parse info to get new number

            diff = new_xlets - curr_xlets #get difference between new number and current number

            if diff != 0: #don't do anything if same num
                #add or remove xlets
                if diff > 0:
                    self.add_xlets(diff, xlet_type)
                elif diff < 0:
                    self.remove_xlets(diff, xlet_type)

                #update typing
                self.update_xlet_typing(inout_info, xlet_type, new_xlets)

    #update numbers in self._dict, based on self._ins and self._outs
    self.update_dict_io_nums()

    #update vst bc it's weird....
    if self._name == 'vst~':
        self.update_vst()


    return


def parse_io_num(self, info, default_num):
    """
    Helper function for updating ins and outs.

    Parses xlet info and returns the new number of xlets.
    """
    #parse io info and args to get proper number of xlets

    sum = 0
    for term in info:

        #counts read from the argument text itself, not from one argument's value
        if term['argtype'] == 'fixed':          #receive foo: any argument at all gives this count
            sum += term['num']
            continue
        if term['argtype'] in ('dollar', 'format', 'word'):
            text = " ".join(str(x) for x in self._args)
            if term['argtype'] == 'dollar':     #expr $i1 + $f2: the highest $ index, 9 at most
                base_num = min(9, max([int(n) for n in re.findall(r"\$[ifs](\d{1,2})", text)] or [1]))
            elif term['argtype'] == 'format':   #sprintf %d %s: one per format specifier
                specs = re.findall(r"%[-+ #0]*\d*(?:\.\d+)?(?:ll|l|h)?[a-zA-Z]", text.replace("%%", ""))
                base_num = max(1, len(specs))
            else:                               #if ... out2 ...: 1 when the word is there
                base_num = int(term['word'] in text.split())
            sum += base_num + term.get('add_amt', 0)
            continue

        #first, parse argtype term:
        #get only number args if argtype is n
        if term['argtype'] == 'n':
            args = [int(float(x)) for x in self._args if tc.check_number(x)]
        else:
            args = [x for x in self._args] #otherwise use args as-is

        #next, parse index term
        index = term['index']
        if index=='all':            #take number of args if index is all
            base_num = len(args)
        else:                       #otherwise, look for arg at specified index
            if len(args) <= index:
                return default_num       #if not enough args of type, return default number of xlets
            base_num = int(args[index])  #otherwise, take the arg at index

        #then, parse accepted values term
        if 'acc_vals' in term.keys():
            if base_num not in term['acc_vals']:
                #choose closest out of accepted values (mimics behavior of max env)
                base_num = min(term['acc_vals'], key=lambda x: abs(x - base_num))

        #then, parse comparitor term
        if 'comparitor' in term.keys():
            if not eval(str(base_num) + term['comparitor']): #if it doesn't pass comparitor test, return default number
                return default_num

        #finally, parse add amount term
        sum += base_num
        if 'add_amt' in term.keys():
            sum += term['add_amt']

    return sum


def add_xlets(self, num, xlet_type):
    """
    Helper function for updating ins and outs.

    Adds the given number of xlets. (does not update typing!)
    """

    if xlet_type == 'numinlets':
        self._ins += [Inlet(self, len(self._ins) + i) for i in range(num)]

    elif xlet_type == 'numoutlets':
        self._outs += [Outlet(self, len(self._outs) + i) for i in range(num)]

    return


def remove_xlets(self, num, xlet_type):
    """
    Helper function for updating ins and outs.

    Removes the given number of xlets from the end, and any attached patchcords. The number
    may be given negative, as the difference update_ins_outs works out. (does not update typing!)
    """

    num = abs(num)
    if num == 0:
        return

    if xlet_type == 'numinlets':
        removed = self._ins[-num:]
        del self._ins[-num:]        #remove inlets from object
        for inlet in removed:       #remove patchcords
            for outlet in inlet.sources:
                outlet._destinations.remove(inlet)
                print("Patchcord removed: (", outlet.parent.name, ": outlet", outlet.index, "--->",
                      inlet.parent.name, ": inlet", inlet.index, ")")
            inlet._sources.clear()
            inlet._midpoints.clear()

    elif xlet_type == 'numoutlets':
        removed = self._outs[-num:]
        del self._outs[-num:]       #remove outlets from object
        for outlet in removed:      #remove patchcords
            for inlet in outlet.destinations:
                cord = inlet._sources.index(outlet)
                del inlet._midpoints[cord]
                del inlet._sources[cord]
                print("Patchcord removed: (", outlet.parent.name, ": outlet", outlet.index, "--->",
                      inlet.parent.name, ": inlet", inlet.index, ")")
            outlet._destinations.clear()

    return


def update_dict_io_nums(self):
    """
    Helper function for updating ins and outs.

    Updates the numinlets/numoutlets entries in self._dict, according to self._ins and self._outs.
    """

    self._dict['box']['numinlets'] = len(self._ins)
    self._dict['box']['numoutlets'] = len(self._outs)

    return



#******************* XLET TYPING ************************

def update_xlet_typing(self, info, xlet_type, num_xlets):
    """
    Helper function for updating ins and outs.

    Fills in typing info for inlets and outlets.
    """

    #get typing info from info dict
    type_info = info[xlet_type][0]['type']

    #parse typing info
    new_types = self.parse_io_typing(type_info, num_xlets)

    #update dict outlettypes, if necessary
    if xlet_type == 'numoutlets':
        self._dict['box']['outlettype'] = new_types.copy()

    #update inlets and outlets
    new_types = ["any" if type=="" else type for type in new_types]
    for i in range(num_xlets):
        if xlet_type == 'numinlets':
            self._ins[i]._types = new_types[i]
        elif xlet_type == 'numoutlets':
            self._outs[i]._types = new_types[i]

    return


def parse_io_typing(self, type_info, num_xlets):
    """
    Helper function for updating xlet typing.

    Returns list of xlet types.
    """

    #when type_info is just one string...
    if isinstance(type_info, str) or type_info is None:
        #some special cases for trigger and unpack outs
        if type_info == "trigger_out":
            new_types = self.get_trigger_out_types()
        elif type_info == "unpack_out":
            new_types = self.get_unpack_out_types()
        #otherwise, they're just all the same type
        else:
            new_types = [type_info] * num_xlets


    #when type_info is a dict...
    else:
        #first, make all xlets of type default
        new_types = [type_info['default']] * num_xlets


        #then, fill in types for beginning xlets
        if 'first' in type_info.keys():
            #how many xlets at the beginning are specified by these types
            num_firsts, first_types = type_info['first']

            #when first_types is just one string, all the same type
            if isinstance(first_types, str):
                first_types = [first_types] * num_firsts

            #fill in the first xlets with first types
            for i in range(num_firsts):
                new_types[i] = first_types[i]


        #then, fill in types for ending xlets
        if 'last' in type_info.keys():
            #how many xlets at the end are specified by these types
            num_lasts, last_types = type_info['last']

            #when last_types is just one string, all the same type
            if isinstance(last_types, str):
                last_types = [last_types] * num_lasts

            #fill in last xlets with last types, from the back
            for i in range(num_lasts):
                new_types[ -(i+1) ] = last_types[ -(i+1) ]


    return new_types
