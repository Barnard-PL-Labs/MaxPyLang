"""
tools.obj.text

Methods that deal with MaxObject text. 

    parse_text() --> parse given text into name, args, attribs
    update_text() --> update MaxObject dict with name, args, attribs
"""

import re


def parse_text(self, text):
    """
    Helper function for building objects.

    Parses in-box text into name, arguments, and in-text attributes.

    name --> str
    args --> list of str
    text_attribs --> dict, {attribute_name: [vals]}
    """

    #split into pieces at whitespace; a double-quoted string is one piece, quotes kept,
    #as Max reads it: route "Send to..." has one argument
    text = re.findall(r'"[^"]*"|\S+', text) or [""]

    #name is first word
    name = text[0]
    args = []
    text_attribs = {}

    #first, get args:
    #args must come before attributes
    #so take all elements until you hit one that starts with @
    i=1
    while (i < len(text)) and (text[i][0] != "@"): 
        args.append(text[i])
        i+= 1

    #get attributes; delineated by @
    while (i < len(text)) and (text[i][0] == "@"):
        attrib_name = text[i][1:]

        i+= 1
        attrib_val = []
        while i < len(text) and (text[i][0] !="@"): #get values that come after attribute name
            attrib_val.append(text[i])
            i+= 1

        #add attribute, val to dictionary
        text_attribs[attrib_name] = attrib_val

    #log extraneous text
    if i < len(text): 
        print(name, ": extraneous arguments", " ".join(text[i:]))
    
    args = self.get_typed_args(args)
    
    return name, args, text_attribs



def update_text(self):
    """
    Update text in MaxObject dict with name/args/attributes. 
    """
    self._dict['box']['text'] = self.get_text()

    return


def get_text(self):
    """
    Get text field for MaxObject dict from self.name/args/text_attribs. 
    """
    
    if self._name != "message":
        text = self._name
    else:
        text = ""

    if len(self._args) != 0:
        str_args = [str(x) for x in self._args]
        text += " " + " ".join(str_args)

    for attrib, val in self._text_attribs.items():
        text += " @" + str(attrib)
        if val is not None:
            text += " " + " ".join(val)
    
    return text

