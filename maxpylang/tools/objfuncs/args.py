"""
tools.obj.args

Methods dealing with text args for MaxObjects.

    args_valid() --> check validity of given text args against reference file info
    get_typed_args() --> turn string args into their proper types (float/int mainly)

"""

import warnings

from maxpylang.tools import typechecks as tc
from maxpylang.exceptions import UnknownObjectWarning
import tabulate

def args_valid(self, name, args, arg_info):
    """
    Function to check text arguments against argument info.
    """

    #get required, optional arguments
    args_req = arg_info['required']
    args_opt = arg_info['optional']

    #check that we have enough args
    if len(args_req) > len(args):
        req_table = tabulate.tabulate([[x['name'], x['type']] for x in args_req],
                                      ['req arg', 'type'], tablefmt='pretty')
        warnings.warn(
            f"'{name}': missing required arguments\n{req_table}",
            UnknownObjectWarning, stacklevel=4
        )
        return False

    #check all type, argument pairs are valid
    req_types = [arg['type'] for arg in args_req]
    if not all([tc.check_type(t, a) for t, a in zip(req_types, args[:len(args_req)])]):
        req_table = tabulate.tabulate([[x['name'], x['type']] for x in args_req],
                                      ['req arg', 'type'], tablefmt='pretty')
        warnings.warn(
            f"'{name}': bad type(s) for required arguments\n{req_table}",
            UnknownObjectWarning, stacklevel=4
        )
        return False

    #check remaining args against optional args. Max takes optional arguments by their type
    #more than by their place (cycle~ mybuffer, svf~ 0.2 radians), so an argument is fine if
    #it fits any of the optional arguments
    opt_types = [arg['type'] for arg in args_opt]
    if not all([any(tc.check_type(t, a) for t in opt_types)
                for a in args[len(args_req):len(args_req) + len(opt_types)]]):
        req_table = tabulate.tabulate([[x['name'], x['type']] for x in args_req],
                                      ['req arg', 'type'], tablefmt='pretty')
        opt_table = tabulate.tabulate([[x['name'], x['type']] for x in args_opt],
                                      ['opt arg', 'type'], tablefmt='pretty')
        warnings.warn(
            f"'{name}': bad type(s) for optional arguments\n{req_table}\n{opt_table}",
            UnknownObjectWarning, stacklevel=4
        )
        return False

    if self.arg_warning:
        if len(args_req) > 0:
            print("(arg_warning):", name,": args may have special reqs," +
                  " check official docs for details")
            #give warning abt required text arguments, if flag is on

    return True


def get_typed_args(self, args):
    """
    Turn string args into floats or ints.

    (so far only used for special vst case)
    """
    typed_args = []
    for arg in args:
        if tc.check_int(arg):
            typed_args.append(int(arg))
        elif tc.check_number(arg):
            typed_args.append(float(arg))
        else:
            typed_args.append(arg)
    return typed_args
