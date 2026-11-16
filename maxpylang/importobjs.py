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
from .tools.constants import import_args_file  #arguments for objects Max will not create bare

from .maxpatch import MaxPatch

#other constants
common_box_standin = [{'name': 'COMMON'}] #for attributes 
available_argtypes = ['int', 'symbol', 'number', 'list', 'any', 'float'] #for arguments
known_aliases = {'t':'trigger', 'sel': 'select', 'b': 'bangbang'} #known aliases
vanilla_packages = ['max', 'msp', 'jit', 'm4l'] #packages whose refpages ship inside the Max app


def import_objs(*packages, overwrite=False, defaults="max"):
    """
    Import objects from MaxMSP packages for compatibility with Python interface.
    Creates object template files.
    
    Requires io files for each package describing the relationship between inlets/outlets and arguments.
    
    Usage:
    input --> list of package folder names, use keyword "vanilla" as shortcut for [max, msp, jit, m4l]. 
    overwrite --> flag to re-import previously imported objects 
    defaults --> where each object's default box comes from:
        "max": Max opens a patch of bare objects and saves it. Needs an authorized Max,
               because an unauthorized one cannot save.
        "shipped": read from the patches Max ships (help files and examples), which Max
               saved itself. Needs no running Max. An estimate: see get_shipped_obj_info
               for how a box is chosen and how far it agrees with a Max save.
    
    With defaults="max", make sure the Max application is OPEN when running this command!
    If import fails, set wait_time higher and re-import. 
    """

    if defaults not in ("max", "shipped"):
        raise ValueError('defaults must be "max" or "shipped"')
    
    #create obj_info_folder to hold ref_files
    if not os.path.exists(obj_info_folder):
        os.mkdir(obj_info_folder)

    
    #get paths to Max ref files 
    package_paths = get_package_paths(list(packages))
    
    #create maxpy info folder for each package
    package_info_folders = prep_make_info_folders(package_paths, overwrite=overwrite)
    
    #store object info
    save_obj_info(package_paths, package_info_folders, defaults=defaults)

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
            packages.extend(vanilla_packages)
            
        #add vanilla path for max, msp, jit, m4l
        elif package in vanilla_packages:
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

def save_obj_info(package_paths, package_info_folders, defaults="max"):
    """
    Saves default, argument, attribute, and inlet/outlet info for each object in the specified packages.
    Also saves obj aliases into obj_aliases.json file. 
    """
    
    #start from the aliases already saved, so importing one package keeps the others'
    obj_aliases = dict(known_aliases)
    aliases_file = os.path.join(obj_info_folder, "obj_aliases.json")
    if os.path.exists(aliases_file):
        with open(aliases_file, 'r') as f:
            obj_aliases.update(json.load(f))
    imported_aliases = {}
    
    #store object info, by package
    for package, info_folder in package_info_folders.items():
        
        print("importing", package, "objects...") #log
       
        ref_folder = package_paths[package] #max refs folder
        obj_refs = sorted(glob.glob(os.path.join(ref_folder, "*.maxref.xml"))) #get all object reffiles
        obj_refs = [ref for ref in obj_refs if not is_unlisted(ref)] #remove unlisted objects 
        obj_names = [Path(Path(x).stem).stem for x in obj_refs] #get object names 
        
        #get default obj info (dict for default instantiation)
        print("\tgetting defaults...")
        if defaults == "shipped":
            default_obj_info = get_shipped_obj_info(obj_refs, obj_names)
        else:
            default_obj_info = get_default_obj_info(package, obj_refs, obj_names)
        print("\tdefaults retrieved\n")
        
        #check for obj aliases
        print("\tgetting aliases...")
        imported_aliases.update(get_obj_aliases(default_obj_info, obj_names))
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
        
    #add Max's own short names (s, r, p, f, i, del...) for every object now in the database,
    #then the aliases found while importing, which win where the two disagree
    known = {Path(x).stem for x in glob.glob(os.path.join(obj_info_folder, "*", "*.json"))}
    obj_aliases.update(get_max_aliases(known, obj_aliases))
    obj_aliases.update(imported_aliases)

    #an alias must not hide an object: Max saves a bare fswap as "swap", which is an object too
    obj_aliases = {alias: name for alias, name in obj_aliases.items() if alias not in known}

    #save aliases
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



def get_max_aliases(known, aliases):
    """
    Helper for saving obj info.

    Returns the short and old names Max itself maps to another object (s to send, p to
    patcher, list.group to zl.group), read from the objectmappings files in Max's init
    folder. Each line there is `max objectfile NAME FILE [CLASS ...];`.

    known --> names of the objects in the database
    aliases --> the aliases already saved; one of these is never replaced

    Only a name that is another spelling of one known object is returned. Left out:
    - a name that is an object in the database, or already an alias
    - a line whose class is the name itself: an object of its own that shares another
      object's file (qmetro lives in metro's file, but is not metro). Its target is then
      its own name, which is not in the database, or it would be an object already
    - the names in "not_aliases" in import_args.json: xbendin2 and xbendout2 map to the
      files of xbendin and xbendout, but have one more outlet and inlet than they do
    - multichannel names (mc., mcs., mcp.): they carry multichannel signals, so they are
      not the object they wrap
    """

    init = Path(get_constant('max_refpath')).resolve().parents[1] / "init"
    with open(import_args_file, 'r') as f:
        not_aliases = json.load(f)['not_aliases']

    found = {}
    for mappings in sorted(init.glob("*objectmappings.txt")):
        for line in mappings.read_text(encoding="utf-8", errors="replace").splitlines():
            words = line.strip().rstrip(";").split()
            if len(words) not in (4, 5) or words[:2] != ["max", "objectfile"]:
                continue
            name, target = words[2], words[-1]
            target = aliases.get(target, target) #Max's file for + is plus; the database's too
            if name in known or name in aliases or target not in known:
                continue
            if name.startswith(("mc.", "mcs.", "mcp.")) or name in not_aliases:
                continue
            found[name] = target

    return found


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
        #an object captured with arguments is stored bare, like the others
        if 'text' in box['box']:
            box['box']['text'] = box['box']['text'].split(' ')[0]
        obj_info[name] = box
        
    #remove defaults file
    os.remove(defaultsfile)
        
    return obj_info




def get_shipped_obj_info(refs, names):
    """
    Helper function for import_objs().
    Builds each object's default box from the patches Max ships, for when Max cannot be
    asked to save one.

    An object's box is chosen among its bare boxes in those patches (text is just the name,
    or a UI box). An object in import_args.json has no working bare box, so its boxes with
    arguments are used instead. Among those boxes:
    - only the ones saved by the newest Max version count. An object can gain an outlet
      between versions (live.remote~), and old patches would outvote the current help file.
    - a shape with the inlet and outlet counts of the refpage wins. A box can set an
      attribute that changes its counts (live.comment @suppressinlet 1), and such boxes can
      outnumber the plain ones.
    - otherwise the most common shape wins.

    An object with no such box gets the inlets and outlets its refpage documents. Boxes of
    it with arguments are used only for their outlet types, and only when their counts are
    the refpage's: their counts may come from the arguments.

    This is an estimate of what Max would save, not the same thing. Against the defaults
    Max saved for the max, msp and jit packages it agrees on 574 of 583 objects that have a
    bare box; the rest are mostly containers (gen~, jit.pix, bpatcher).

    Returns dictionary of {object_name: default_patching_box}
    """

    with open(import_args_file, 'r') as f:
        import_args = json.load(f)['args']

    c74 = Path(get_constant('max_refpath')).resolve().parents[1]
    bare = {name: collections.Counter() for name in names}
    with_args = {name: collections.Counter() for name in names}
    sizes = collections.defaultdict(collections.Counter)
    for version, box in shipped_boxes(c74, versions=True):
        if 'numinlets' not in box or 'numoutlets' not in box:
            continue
        words = box.get('text', '').split()
        is_ui = box.get('maxclass', 'newobj') != 'newobj'
        name = box['maxclass'] if is_ui else (words[0] if words else '')
        if name not in bare:
            continue
        shape = (is_ui, box['numinlets'], box['numoutlets'], tuple(box.get('outlettype', [])),
                 box.get('parameter_enable'))
        (bare if is_ui or len(words) == 1 else with_args)[name][(version, shape)] += 1
        if is_ui or len(words) == 1: #a box with arguments is as wide as its arguments
            sizes[name][tuple(box.get('patching_rect', [])[2:4])] += 1

    obj_info = {}
    for ref, name in zip(refs, names):
        root = ET.parse(ref).getroot()
        documented = (len(root.findall("./inletlist/inlet")), len(root.findall("./outletlist/outlet")))

        seen = with_args[name] if name in import_args else bare[name]
        shapes = collections.Counter()
        if seen:
            newest = max(version for version, _ in seen)
            for (version, shape), count in seen.items():
                if version == newest:
                    shapes[shape] += count
        else:
            for (_, shape), count in (bare[name] + with_args[name]).items():
                if shape[1:3] == documented:
                    shapes[shape] += count

        if shapes:
            #most common first; a shape with the refpage's counts ahead of that; ties by value
            best = min(shapes, key=lambda shape: (shape[1:3] != documented, -shapes[shape], repr(shape)))
            is_ui, numinlets, numoutlets, outlettype, parameter_enable = best
        else:
            is_ui, parameter_enable = False, None
            numinlets, numoutlets = documented
            outlettype = [""] * numoutlets
            print("\t", name, "has no usable box in a shipped patch, using its refpage:",
                  numinlets, "in,", numoutlets, "out")

        box = {'id': 'obj-1', 'maxclass': name if is_ui else 'newobj',
               'numinlets': numinlets, 'numoutlets': numoutlets}
        if numoutlets:
            box['outlettype'] = list(outlettype)
        if parameter_enable is not None:
            box['parameter_enable'] = parameter_enable
        size = sizes[name].most_common(1)[0][0] if sizes[name] else ()
        box['patching_rect'] = [100.0, 100.0, *(size if len(size) == 2 else (50.0, 22.0))]
        if not is_ui:
            box['text'] = name
        obj_info[name] = {'box': box}

    return obj_info


def shipped_boxes(node, versions=False):
    """
    Every box in the patches under a folder (given as a Path), nested patchers included.
    A dict or list is searched as parsed patch json. gen~ and RNBO patchers hold their
    own operators, so they are skipped along with everything inside them.

    versions --> for a folder, yield (major version of the Max that saved the file, box)
    """

    if isinstance(node, Path):
        for path in sorted(node.rglob("*")):
            if path.suffix in (".maxpat", ".maxhelp"):
                try:
                    data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
                except (ValueError, OSError):
                    continue
                patcher = data.get("patcher") if isinstance(data, dict) else None
                appversion = patcher.get("appversion") if isinstance(patcher, dict) else None
                major = appversion.get("major", 0) if isinstance(appversion, dict) else 0
                for box in shipped_boxes(data):
                    yield (major, box) if versions else box
    elif isinstance(node, dict):
        if "boxes" in node and "lines" in node:
            if node.get("classnamespace", "box") != "box":
                return
            for box in node["boxes"]:
                if "box" in box:
                    yield box["box"]
        for value in node.values():
            yield from shipped_boxes(value)
    elif isinstance(node, list):
        for value in node:
            yield from shipped_boxes(value)



def add_barebones_objs(refs, patch):
    """
    Add a barebones instantiation of each object in refs to the patch.

    Max will not create some objects without arguments (send, peek~, expr): it saves an
    error box with no inlets or outlets. Those get the arguments in import_args.json, so
    the box Max saves has the object's real inlets and outlets.
    """

    with open(import_args_file, 'r') as f:
        import_args = json.load(f)['args']
    
    for ref in refs:
        xmltree = ET.parse(ref)
        root = xmltree.getroot()
        text = root.attrib['name'] #get text from xml file
        if text in import_args:
            text += ' ' + import_args[text]
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
    
    with open(import_args_file, 'r') as f:
        import_args = json.load(f)
    free_text, required_count = import_args['free_text'], import_args['required_count']

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

        #an expression is free text, whatever parts of it the refpage lists as arguments
        if name in free_text:
            objarg_info[name] = {'required': [{'name': 'expression', 'type': ['any']}], 'optional': []}

        #a refpage marks arguments required that Max's own patches leave out
        if name in required_count:
            objarg_info[name] = demote_required_args(objarg_info[name], required_count[name])
        
    return objarg_info
        

def demote_required_args(arg_info, count):
    """
    Keeps the first `count` required arguments and moves the rest to the front of the
    optional ones.
    """
    required = arg_info['required']
    return {'required': required[:count], 'optional': required[count:] + arg_info['optional']}


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
    
    #read file (a package with no io file has no argument-dependent xlets)
    info = {}
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
