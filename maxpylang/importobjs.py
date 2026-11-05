import numpy as np
import os
import json
import glob
from pathlib import Path
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
import collections
import keyword
import builtins


#import some constants...
from .tools.constants import get_constant
from .tools.constants import obj_info_folder   #path to maxpy obj info folder
from .tools.constants import obj_io_folder     #path to obj io folder
from .tools.constants import import_tools      #maxpatch json to add open/close functionality 

from .maxpatch import MaxPatch

#other constants
common_box_standin = [{'name': 'COMMON'}] #for attributes 
available_argtypes = ['int', 'symbol', 'number', 'list', 'any', 'float'] #for arguments
known_aliases = {'t':'trigger', 'sel': 'select', 'b': 'bangbang'} #known aliases


def import_objs(*packages, overwrite=False):
    """
    Import objects from MaxMSP packages for compatibility with Python interface.
    Creates object template files.
    
    Requires io files for each package describing the relationship between inlets/outlets and arguments.
    
    Usage:
    input --> list of package folder names, use keyword "vanilla" as shortcut for [max, msp, jit]. 
    overwrite --> flag to re-import previously imported objects 
    
    Make sure the Max application is OPEN when running this command!
    If import fails, set wait_time higher and re-import. 
    """
    
    #create obj_info_folder to hold ref_files
    if not os.path.exists(obj_info_folder):
        os.mkdir(obj_info_folder)

    
    #get paths to Max ref files 
    package_paths = get_package_paths(list(packages))
    
    #create maxpy info folder for each package
    package_info_folders = prep_make_info_folders(package_paths, overwrite=overwrite)
    
    #store object info
    save_obj_info(package_paths, package_info_folders)

    #generate python stub modules
    generate_stubs(package_paths, package_info_folders)

    return



#############################################################################################
########      SHOULD BE PRIVATE FUNCTIONS       #############################################
#############################################################################################


#************************************************************
#*************** FILE PATH STUFF ****************************
#************************************************************

def get_package_paths(packages):
    """
    Gets paths to the Max reference directories for each package in specified list.
    """
    vanilla_refpath = get_constant('max_refpath')
    packages_refpath = get_constant('packages_path')
    
    package_paths = {}
    
    for package in packages:
        
        #add max, msp, jit if vanilla 
        if package == 'vanilla':
            packages.append('max')
            packages.append('msp')
            packages.append('jit')
            
        #add vanilla path for max, msp, jit
        elif package == 'max' or package == 'msp' or package == 'jit':
            package_paths[package] = os.path.join(vanilla_refpath, package + "-ref")
            
        #add from package path for all others
        else:
            package_paths[package] = os.path.join(packages_refpath, package + "/docs")
            
    return package_paths



def prep_make_info_folders(package_paths, overwrite=False):
    
    """
    Makes maxpy info folders for packages specified.
    
    Checks for package existance, deletes old folder if overwriting, makes new folder if new import.
    """
    
    package_info_folders = {}
    for package, package_path in package_paths.items():
        
        #check to see if package exists
        if not os.path.exists(package_path):
            print("package", package, "not found")
            
        else:
        
            #make path for package info folder
            package_info_folder = os.path.join(obj_info_folder, package)

            #if prev. imported and not overwriting, skip import
            if os.path.exists(package_info_folder) and not overwrite:
                print(package, "previously imported, skipping...")

            else:
                #otherwise, import
                
                #remove old folder if necessary
                if os.path.exists(package_info_folder): #package prev imported, overwriting
                    print("prepping to re-import", package, "...")
                    shutil.rmtree(package_info_folder) #remove old folder
                else:
                    print("prepping to import", package, "...") #package importing for first time

                #create new folder
                os.mkdir(package_info_folder)

                #add to dictionary
                package_info_folders[package] = package_info_folder
           
    print()
    print(len(package_info_folders), "package(s) prepped, ready for import\n")
    
    return package_info_folders


#************************************************************
#*************** FOR SAVING OBJECT INFO *********************
#************************************************************

def save_obj_info(package_paths, package_info_folders):
    """
    Saves default, argument, attribute, and inlet/outlet info for each object in the specified packages.
    Also saves obj aliases into obj_aliases.json file. 
    """
    
    obj_aliases = known_aliases
    
    #store object info, by package
    for package, info_folder in package_info_folders.items():
        
        print("importing", package, "objects...") #log
       
        ref_folder = package_paths[package] #max refs folder
        obj_refs = sorted(glob.glob(os.path.join(ref_folder, "*.maxref.xml"))) #get all object reffiles
        obj_refs = [ref for ref in obj_refs if not is_unlisted(ref)] #remove unlisted objects 
        obj_names = [Path(Path(x).stem).stem for x in obj_refs] #get object names 
        
        #get default obj info (dict for default instantiation)
        print("\tgetting defaults...")
        default_obj_info = get_default_obj_info(package, obj_refs, obj_names)
        print("\tdefaults retrieved\n")
        
        #check for obj aliases
        print("\tgetting aliases...")
        obj_aliases.update(get_obj_aliases(default_obj_info, obj_names))
        print("\taliases retrieved\n")

        #get objarg info (required and optional args, types, size) 
        print("\tgetting argument info...")
        objarg_info = get_objarg_info(obj_refs, obj_names)
        print("\targument info retrieved\n")
        
        #get attribute info (specific and/or specific attributes, types, size) 
        print("\tgetting attribute info...")
        objattrib_info = get_objattrib_info(obj_refs, obj_names)
        print("\tattribute info retrieved\n")
        
        #get inlet/outlet info (from io files)
        print("\tgetting inlet/outlet info...")
        objinout_info = get_objinout_info(package, obj_names)
        print("\tinlet/outlet info retrieved\n")

        #get doc info (digest, description, inlets, outlets, methods, seealso)
        print("\tgetting doc info...")
        obj_doc_info = get_obj_doc_info(obj_refs, obj_names)
        print("\tdoc info retrieved\n")

        #save maxpy obj info files
        print("\tsaving object info files...")
        for name in obj_names:
            obj_info = {'default': default_obj_info[name],
                        'args': objarg_info[name],
                        'attribs': objattrib_info[name],
                        'in/out': objinout_info[name],
                        'doc': obj_doc_info[name]}
            
            obj_file = os.path.join(info_folder, name + '.json')
            with open(obj_file, 'w') as f:
                json.dump(obj_info, f, indent=2)
        
        print("\t", len(obj_names), "object info files saved\n")
        print(package, "imported successfully,", len(obj_names), "objects imported\n")
        
    #save aliases
    aliases_file = os.path.join(obj_info_folder, "obj_aliases.json")
    with open(aliases_file, 'w') as f:
        json.dump(obj_aliases, f, indent=2)
    print("object aliases saved successfully")
        
    return


def is_unlisted(ref):
    
    """
    Helper func for saving object info. 
    Returns true if an object is unlisted.
    
    ref --> Max reference file of the object
    """
    
    xmltree = ET.parse(ref)
    root = xmltree.getroot()
    if 'category' in root.attrib.keys():
        category = root.attrib['category']
    else:
        return False
    
    return (category == "Unlisted")


def get_obj_aliases(default_info, names):
    
    """
    Helper for saving obj info. 
    
    Return aliases for objects. 
    """
    
    aliases = {}
    for name in names:
        try:
            default_text = default_info[name]['box']['text']
            if name != default_text: #object name is different from text-field string
                aliases[default_text] = name
        except KeyError:
            pass
    
    return aliases



#************************************************************
#*************** GETTING DEFAULT OBJ INFO *******************
#************************************************************

def get_default_obj_info(package, refs, names):
    """
    Helper function for import_objs().
    Place objects in a MaxPatch and extracts default settings.
    
    *relies on the fact that Max will save 'barebones' objects with default parameters auto-filled in. 
    
    Returns dictionary of {object_name: default_patching_box}
    """
    
    wait_time = get_constant('wait_time')
    
    #create empty patch
    patch = MaxPatch(verbose=False)
    
    #add save+close mechanism to patch 
    add_save_close(patch)
    
    #manually add barebones object dicts to patch
    add_barebones_objs(refs, patch)
    
    #temporarily save patch
    defaultsfile = "defaults_" + package + ".maxpat"
    patch.save(filename=defaultsfile, verbose=False)
    
    #open file, wait for it to save and close
    subprocess.call(['open', defaultsfile])
    time.sleep(wait_time)
    
    #read saved file
    with open(defaultsfile, 'r') as f:
        patchdict = json.loads(f.read())
    
    patchboxes = patchdict['patcher']['boxes'][6:] #ignoring the save/close objects
    
    #parse for object info
    obj_info = {}
    for name, box in zip(names, patchboxes):
        obj_info[name] = box
        
    #remove defaults file
    os.remove(defaultsfile)
        
    return obj_info




def add_barebones_objs(refs, patch):
    """
    Add a barebones instantiation of each object in refs to the patch.
    """
    
    for ref in refs:
        xmltree = ET.parse(ref)
        root = xmltree.getroot()
        text = root.attrib['name'] #get text from xml file
        patch.add_barebones_obj(text)
        
    return 




def add_save_close(patch):
    """
    Helper func for get_default_obj_info.
    Puts thispatcher object arrangement in patch so that it opens, saves, and closes. 
    """
    with open(import_tools, 'r') as f:
        tools = json.loads(f.read())

    patch._patcher_dict['patcher']['boxes'] = tools['boxes']
    patch._patcher_dict['patcher']['lines'] = tools['lines']

    return



#************************************************************
#*************** GETTING OBJ ARGUMENT INFO ******************
#************************************************************

def get_objarg_info(refs, names):
    
    """
    Helper func for import_objs.
    
    Gets info on obj text arguments, returned as dictionary of required and optional arguments. 
    """
    
    #arginfo template
    objarg_info = collections.defaultdict(lambda: {'required':[], 'optional':[]})
    
    #for each obj...
    for ref, name in zip(refs, names):
        
        #parse ref file
        xmltree = ET.parse(ref)
        root = xmltree.getroot()
        
        #get required and optional args
        objarg_info[name]['required'] = get_objargs_by_flag(root, "[@optional='0']")
        objarg_info[name]['optional'] = get_objargs_by_flag(root, "[@optional='1']")
        
    return objarg_info
        

def get_objargs_by_flag(root, flag):
    """
    Retrieves objargs from xml file, according to flag.
    
    Returns a list of cleaned dictionaries, with argument name and type.
    """
    
    findstring = "./objarglist/objarg" + flag
    args = []
    
    for objarg in root.findall(findstring):
        
        #get attrib dict
        objarg = objarg.attrib
        
        #check for placeholder arg
        if not (objarg['name'] == 'OBJARG_NAME' and objarg['type'] == 'OBJARG_TYPE'):
            
            #get argtypes
            if 'type' not in objarg:
                objarg['type'] = []
            else:
                #parse list of possible types, bc reffile might list it as "int, string, or float" etc. 
                objarg['type'] = [type for type in available_argtypes if type in objarg['type']]
            
            #don't need to log the optional flag
            del objarg['optional']
            
            #save to list
            args.append(objarg)
    
    return args
                            

#************************************************************
#*************** GETTING OBJ ATTRIB INFO ********************
#************************************************************
    
    
def get_objattrib_info(refs, names):
    
    """
    Helper func for import_objs.
    
    Gets info on object attributes, returned as a dictionary containing name, type, and size.  
    """
    
    #template for attribute info 
    objattrib_info = collections.defaultdict(lambda: [])
    
    #for each obj...
    for ref, name in zip(refs, names):
        
        #parse xml file
        xmltree = ET.parse(ref)
        root = xmltree.getroot()
        
        #add common box if not UI object
        if 'category' in root.attrib.keys() and root.attrib['category'] != "U/I":
            objattrib_info[name]+= common_box_standin
        
        #get all attributes 
        for attrib in root.findall("./attributelist/attribute"):
            
            attrib_info = attrib.attrib
            
            #remove extraneous info 
            if 'get' in attrib_info.keys():
                del attrib_info['get']
            if 'set' in attrib_info.keys():
                del attrib_info['set']
            
            #save to list
            objattrib_info[name].append(attrib.attrib)

    return objattrib_info
        
                                         
    
#************************************************************
#*************** GETTING OBJ XLET INFO **********************
#************************************************************

    
def get_objinout_info(package, names):
    """
    Helper func for get_default_obj_info.
    
    Returns info about inlets/outlets affected by arguments. 
    *Requires io files for each package, dictating the relationship between arguments and xlets.
    """
    
    objinout_info = {}
    
    #get path to io file
    info_file = os.path.join(obj_io_folder, package + "_io.json")
    
    #read file
    if os.path.exists(info_file):
        with open(info_file, 'r') as f:
            info = json.loads(f.read())
    
    #pull in info
    for name in names:
        if name in info.keys():
            objinout_info[name] = info[name]
        else:
            objinout_info[name] = {}

        
        
    return objinout_info


#************************************************************
#*************** GETTING OBJ DOC INFO ***********************
#************************************************************


def strip_xml_text(element):
    """
    Extract plain text from an XML element, stripping inline tags like <o>, <m>, <br />.
    Returns joined text or empty string if element is None.
    """
    if element is None:
        return ""
    return "".join(element.itertext()).strip()


def get_obj_doc_info(refs, names):
    """
    Helper func for import_objs.

    Extracts semantic documentation from XML ref files:
    digest, description, inlets, outlets, methods, and seealso.

    Returns dict of {name: doc_dict}.
    """

    obj_doc_info = {}

    for ref, name in zip(refs, names):

        xmltree = ET.parse(ref)
        root = xmltree.getroot()

        doc = {}

        # digest
        digest_text = strip_xml_text(root.find("digest"))
        if digest_text and digest_text != "TEXT_HERE":
            doc["digest"] = digest_text

        # description
        desc_text = strip_xml_text(root.find("description"))
        if desc_text and desc_text != "TEXT_HERE":
            doc["description"] = desc_text

        # inlets
        inlets = []
        for inlet in root.findall("./inletlist/inlet"):
            inlet_info = dict(inlet.attrib)
            inlet_digest = strip_xml_text(inlet.find("digest"))
            if inlet_digest and inlet_digest != "TEXT_HERE":
                inlet_info["digest"] = inlet_digest
            inlet_desc = strip_xml_text(inlet.find("description"))
            if inlet_desc and inlet_desc != "TEXT_HERE":
                inlet_info["description"] = inlet_desc
            inlets.append(inlet_info)
        if inlets:
            doc["inlets"] = inlets

        # outlets
        outlets = []
        for outlet in root.findall("./outletlist/outlet"):
            outlet_info = dict(outlet.attrib)
            outlet_digest = strip_xml_text(outlet.find("digest"))
            if outlet_digest and outlet_digest != "TEXT_HERE":
                outlet_info["digest"] = outlet_digest
            outlet_desc = strip_xml_text(outlet.find("description"))
            if outlet_desc and outlet_desc != "TEXT_HERE":
                outlet_info["description"] = outlet_desc
            outlets.append(outlet_info)
        if outlets:
            doc["outlets"] = outlets

        # methods
        methods = []
        for method in root.findall("./methodlist/method"):
            method_info = dict(method.attrib)
            method_digest = strip_xml_text(method.find("digest"))
            if method_digest and method_digest != "TEXT_HERE":
                method_info["digest"] = method_digest
            method_desc = strip_xml_text(method.find("description"))
            if method_desc and method_desc != "TEXT_HERE":
                method_info["description"] = method_desc
            # method args
            arglist = method.find("arglist")
            if arglist is not None:
                args = [dict(arg.attrib) for arg in arglist.findall("arg")]
                if args:
                    method_info["args"] = args
            methods.append(method_info)
        if methods:
            doc["methods"] = methods


        obj_doc_info[name] = doc

    return obj_doc_info


#************************************************************
#*************** PYTHON STUB GENERATION *********************
#************************************************************


def sanitize_py_name(max_name):
    """Convert a Max object name to a valid Python identifier."""
    name = max_name.replace("~", "_tilde")
    name = name.replace(".", "_")
    name = name.replace("-", "_")
    if name and name[0].isdigit():
        name = "_" + name
    if keyword.iskeyword(name) or name in dir(builtins):
        name = name + "_"
    return name


def _build_docstring(max_name, obj_info):
    """Build a docstring for a Max object from its JSON info."""
    doc = obj_info.get("doc", {})
    args = obj_info.get("args", {})
    attribs = obj_info.get("attribs", [])

    lines = []

    # line 1: name - digest
    digest = doc.get("digest", "")
    if digest:
        lines.append(f"{max_name} - {digest}")
    else:
        lines.append(max_name)

    # description
    description = doc.get("description", "")
    if description:
        lines.append("")
        lines.append(description)

    # Args section
    req_args = args.get("required", [])
    opt_args = args.get("optional", [])
    if req_args or opt_args:
        lines.append("")
        lines.append("Args:")
        for arg in req_args:
            arg_type = ", ".join(arg.get("type", [])) if isinstance(arg.get("type"), list) else arg.get("type", "")
            lines.append(f"  {arg.get('name', '?')} ({arg_type}, required)")
        for arg in opt_args:
            arg_type = ", ".join(arg.get("type", [])) if isinstance(arg.get("type"), list) else arg.get("type", "")
            lines.append(f"  {arg.get('name', '?')} ({arg_type}, optional)")

    # Inlets section
    inlets = doc.get("inlets", [])
    if inlets:
        lines.append("")
        lines.append("Inlets:")
        for i, inlet in enumerate(inlets):
            idx = inlet.get("id", str(i))
            inlet_type = inlet.get("type", "")
            digest_text = inlet.get("digest", "")
            if inlet_type and digest_text:
                lines.append(f"  {idx} ({inlet_type}): {digest_text}")
            elif digest_text:
                lines.append(f"  {idx}: {digest_text}")
            elif inlet_type:
                lines.append(f"  {idx} ({inlet_type})")

    # Outlets section
    outlets = doc.get("outlets", [])
    if outlets:
        lines.append("")
        lines.append("Outlets:")
        for i, outlet in enumerate(outlets):
            idx = outlet.get("id", str(i))
            outlet_type = outlet.get("type", "")
            digest_text = outlet.get("digest", "")
            if outlet_type and digest_text:
                lines.append(f"  {idx} ({outlet_type}): {digest_text}")
            elif digest_text:
                lines.append(f"  {idx}: {digest_text}")
            elif outlet_type:
                lines.append(f"  {idx} ({outlet_type})")

    # Messages section (one-liner, just names)
    methods = doc.get("methods", [])
    if methods:
        method_names = [m.get("name", "") for m in methods if m.get("name")]
        if method_names:
            lines.append("")
            lines.append("Messages: " + ", ".join(method_names))

    # Attributes section (one-liner, just names, skip COMMON)
    if attribs:
        attrib_names = [a.get("name", "") for a in attribs
                        if a.get("name") and a.get("name") != "COMMON"]
        if attrib_names:
            lines.append("")
            lines.append("Attributes: " + ", ".join(attrib_names))


    return "\n".join(lines)


def generate_stubs(package_paths, package_info_folders):
    """
    Generate Python stub modules for imported Max objects.

    Creates maxpylang/objects/{package}.py with pre-instantiated MaxObject
    variables so users get IDE autocomplete.
    """

    # path to maxpylang/objects/
    objects_dir = os.path.join(
        os.path.abspath(os.path.join(os.path.realpath(__file__), os.pardir)),
        "objects"
    )
    os.makedirs(objects_dir, exist_ok=True)

    for package, info_folder in package_info_folders.items():

        # read all JSON files for this package
        json_files = sorted(glob.glob(os.path.join(info_folder, "*.json")))
        if not json_files:
            continue

        names_map = {}   # py_name -> max_name
        obj_infos = {}   # max_name -> parsed json

        for jf in json_files:
            max_name = Path(jf).stem
            with open(jf, "r") as f:
                obj_info = json.load(f)
            py_name = sanitize_py_name(max_name)
            names_map[py_name] = max_name
            obj_infos[max_name] = obj_info

        stub_text = build_stub_module(package, names_map, obj_infos)

        # write the stub file
        stub_path = os.path.join(objects_dir, f"{package}.py")
        with open(stub_path, "w") as f:
            f.write(stub_text)

        print(f"\tstub module generated: objects/{package}.py ({len(names_map)} objects)")

    # regenerate __init__.py based on existing stub files
    init_path = os.path.join(objects_dir, "__init__.py")
    existing_stubs = [Path(p).stem for p in sorted(glob.glob(os.path.join(objects_dir, "*.py")))
                      if Path(p).stem != "__init__"]
    with open(init_path, "w") as f:
        f.write(build_objects_init(existing_stubs))

    print("stub generation complete\n")


def build_stub_module(package, names_map, obj_infos):
    """
    Text of maxpylang/objects/{package}.py.

    names_map --> python name: Max name
    obj_infos --> Max name: parsed OBJ_INFO json
    """

    stub_lines = []
    stub_lines.append(f'"""MaxObject stubs for {package} objects. Auto-generated by import_objs()."""')
    stub_lines.append("import os as _os")
    stub_lines.append("import sys as _sys")
    stub_lines.append("from maxpylang.maxobject import MaxObject")
    stub_lines.append("")

    # __all__
    all_names = sorted(names_map.keys())
    stub_lines.append("__all__ = [")
    for py_name in all_names:
        stub_lines.append(f"    '{py_name}',")
    stub_lines.append("]")
    stub_lines.append("")

    # _NAMES dict
    stub_lines.append("_NAMES = {")
    for py_name in all_names:
        stub_lines.append(f"    '{py_name}': '{names_map[py_name]}',")
    stub_lines.append("}")
    stub_lines.append("")

    # suppress all stdout during stub instantiation
    stub_lines.append("_devnull = open(_os.devnull, 'w')")
    stub_lines.append("_old_stdout = _sys.stdout")
    stub_lines.append("_sys.stdout = _devnull")
    stub_lines.append("")

    # per-object variable declarations, each followed by its docstring
    # (tools/typedstubs.py reads the docstring after each stub)
    for py_name in all_names:
        max_name = names_map[py_name]
        obj_info = obj_infos[max_name]
        docstring = _build_docstring(max_name, obj_info)
        docstring = docstring.replace('"""', '\\"""')

        stub_lines.append(f"{py_name} = MaxObject('{max_name}')")
        stub_lines.append('"""')
        stub_lines.append(docstring)
        stub_lines.append('"""')
        stub_lines.append("")

    # restore stdout
    stub_lines.append("_sys.stdout = _old_stdout")
    stub_lines.append("_devnull.close()")
    stub_lines.append("del _devnull, _old_stdout")
    stub_lines.append("")

    return "\n".join(stub_lines)


def build_objects_init(stems):
    """Text of maxpylang/objects/__init__.py, importing the given stub modules."""

    init_lines = [
        '"""Pre-instantiated MaxObject stubs for all imported packages."""',
        "import warnings",
        "from maxpylang.exceptions import UnknownObjectWarning",
        "from maxpylang.maxobject import MaxObject as _MaxObject",
        "",
        "# Stubs intentionally create objects without args; suppress warnings during import",
        "with warnings.catch_warnings():",
        '    warnings.simplefilter("ignore", UnknownObjectWarning)',
    ]
    for stem in stems:
        init_lines.append("    try:")
        init_lines.append(f"        from .{stem} import *")
        init_lines.append("    except ImportError:")
        init_lines.append("        pass")
    init_lines += [
        "",
        "# Stubs are templates: placing or calling one makes a new object",
        "for _stub in list(globals().values()):",
        "    if isinstance(_stub, _MaxObject):",
        "        _stub._is_stub = True",
        "del _stub",
    ]
    return "\n".join(init_lines) + "\n"
