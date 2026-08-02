{
 "patcher": {
  "fileversion": 1,
  "appversion": { "major": 8, "minor": 1, "revision": 11, "architecture": "x64", "modernui": 1 },
  "classnamespace": "box",
  "rect": [34.0, 87.0, 1372.0, 779.0],
  "default_fontsize": 12.0,
  "default_fontname": "Arial",
  "boxes": [
   {
    "box": {
     "id": "obj-1",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": ["bang"],
     "patching_rect": [40.0, 40.0, 65.0, 22.0],
     "text": "metro 220"
    }
   },
   {
    "box": {
     "id": "obj-2",
     "maxclass": "newobj",
     "numinlets": 5,
     "numoutlets": 1,
     "outlettype": ["int"],
     "patching_rect": [40.0, 100.0, 75.0, 22.0],
     "text": "counter 0 12"
    }
   },
   {
    "box": {
     "id": "obj-3",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": ["int"],
     "patching_rect": [40.0, 160.0, 40.0, 22.0],
     "text": "+ 60"
    }
   },
   {
    "box": {
     "id": "obj-4",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": ["float"],
     "patching_rect": [40.0, 220.0, 40.0, 22.0],
     "text": "mtof"
    }
   },
   {
    "box": {
     "id": "obj-5",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": ["signal"],
     "patching_rect": [40.0, 280.0, 50.0, 22.0],
     "text": "cycle~"
    }
   },
   {
    "box": {
     "id": "obj-6",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": ["signal"],
     "patching_rect": [40.0, 340.0, 50.0, 22.0],
     "text": "*~ 0.15"
    }
   },
   {
    "box": {
     "id": "obj-7",
     "maxclass": "ezdac~",
     "numinlets": 2,
     "numoutlets": 0,
     "patching_rect": [40.0, 400.0, 45.0, 45.0],
     "text": "ezdac~"
    }
   }
  ],
  "lines": [
   { "patchline": { "source": ["obj-1", 0], "destination": ["obj-2", 0] } },
   { "patchline": { "source": ["obj-2", 0], "destination": ["obj-3", 0] } },
   { "patchline": { "source": ["obj-3", 0], "destination": ["obj-4", 0] } },
   { "patchline": { "source": ["obj-4", 0], "destination": ["obj-5", 0] } },
   { "patchline": { "source": ["obj-5", 0], "destination": ["obj-6", 0] } },
   { "patchline": { "source": ["obj-6", 0], "destination": ["obj-7", 0] } },
   { "patchline": { "source": ["obj-6", 0], "destination": ["obj-7", 1] } }
  ],
  "dependency_cache": [],
  "autosave": 0
 }
}
