import os
from pathlib import Path
import json

"""
Set some constants.
"""

#path to package
maxpy_path = os.path.abspath(os.path.join(os.path.realpath(__file__), os.pardir, os.pardir))


#paths to files and folders in data folder
data_folder = os.path.join(maxpy_path, "data")
import_tools = os.path.join(data_folder, "import_tools.json")
import_args_file = os.path.join(data_folder, "import_args.json")
obj_info_folder = os.path.join(data_folder, "OBJ_INFO/")
obj_io_folder = os.path.join(data_folder, "OBJ_IO/")
patch_templates_path = os.path.join(data_folder, "PATCH_TEMPLATES/")
constants_file = os.path.join(data_folder, "constants.json")


#common box attributes available to all non-ui objects 
common_box_attribs = [{'name': 'annotation', 'type': 'symbol', 'size': 1}, 
                      {'name': 'background', 'type': 'int', 'size': 1}, #0 or 1
                      {'name': 'color', 'type': 'float', 'size': 4},
                      {'name': 'fontface', 'type': 'int', 'size': 1}, #0, 1, 2, 3
                      {'name': 'fontname', 'type': 'symbol', 'size': 1}, 
                      {'name': 'fontsize', 'type': 'float', 'size': 1},
                      {'name': 'hidden', 'type': 'int', 'size': 1}, #0 or 1
                      {'name': 'hint', 'type': 'symbol', 'size': 1},
                      {'name': 'ignoreclick', 'type': 'int', 'size': 1}, #0 or 1
                      {'name': 'jspainterfile', 'type': 'symbol', 'size': 1},
                      {'name': 'presentation', 'type': 'int', 'size': 1}, #0 or 1
                      {'name': 'presentation_rect', 'type': 'float', 'size': 4},
                      {'name': 'textcolor', 'type': 'float', 'size': 4},
                      {'name': 'textjustification', 'type': 'int', 'size': 1}, #0 , 1 , 2
                      {'name': 'varname', 'type': 'symbol', 'size': 1},
                      {'name': 'style', 'type': 'symbol', 'size': 1},
                      {'name': 'bgcolor', 'type': 'float', 'size': 4}]


unknown_obj_dict = {'box': {'id': 'obj-1', 
                            'maxclass': 'newobj', 
                            'numinlets': 0,
                            'numoutlets': 0,
                            'patching_rect': [ 234.0, 81.0, 34.0, 22.0 ],
                            'text': 'UNK'
                           }
                   }

#***** FOR SETTING CONSTANTS ********

def set_packages_path(newpath):
    """
    Set the path to the Packages folder where the Max app keeps package information.
    """
        
    set_constant('packages_path', newpath)
    
    return


def set_max_path(newpath):
    """
    Set the path to the Max application, likely in your applications folder.
    """
        
    refpath = os.path.join(newpath, "Contents/Resources/C74/docs/refpages/")
    set_constant('max_refpath', refpath)
    
    return

    
def set_wait_time(new_time):
    """
    Set the wait time for opening and closing Max files while importing packages.
    """
    
    set_constant('wait_time', new_time)
    
    return

def set_constant(name, val):
    
    """
    Sets constants according to name and value. 
    """
    
    with open(constants_file, 'r') as f:
        constants = json.loads(f.read())
    constants[name] = val
    with open(constants_file, 'w') as f:
        json.dump(constants, f, indent=2)
    
    return


#**** FOR GETTING CONSTANTS *****

def get_constant(name):
    """
    Returns the specified constant.
    """
    
    with open(constants_file, 'r') as f:
        constants = json.loads(f.read())
    
    return constants[name]
    
    
    
    