{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 8,
      "minor": 1,
      "revision": 11,
      "architecture": "x64",
      "modernui": 1
    },
    "classnamespace": "box",
    "rect": [
      34.0,
      87.0,
      1372.0,
      779.0
    ],
    "bglocked": 0,
    "openinpresentation": 0,
    "default_fontsize": 12.0,
    "default_fontface": 0,
    "default_fontname": "Arial",
    "gridonopen": 1,
    "gridsize": [
      15.0,
      15.0
    ],
    "gridsnaponopen": 1,
    "objectsnaponopen": 1,
    "statusbarvisible": 2,
    "toolbarvisible": 1,
    "lefttoolbarpinned": 0,
    "toptoolbarpinned": 0,
    "righttoolbarpinned": 0,
    "bottomtoolbarpinned": 0,
    "toolbars_unpinned_last_save": 0,
    "tallnewobj": 0,
    "boxanimatetime": 200,
    "enablehscroll": 1,
    "enablevscroll": 1,
    "devicewidth": 0.0,
    "description": "",
    "digest": "",
    "tags": "",
    "style": "",
    "subpatcher_template": "",
    "assistshowspatchername": 0,
    "boxes": [
      {
        "box": {
          "id": "obj-1",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "bang"
          ],
          "patching_rect": [
            40,
            40,
            39.0,
            22.0
          ],
          "text": "metro 220"
        }
      },
      {
        "box": {
          "id": "obj-2",
          "maxclass": "newobj",
          "numinlets": 5,
          "numoutlets": 4,
          "outlettype": [
            "int",
            "",
            "",
            "int"
          ],
          "patching_rect": [
            40,
            100,
            49.0,
            22.0
          ],
          "text": "counter 0 12"
        }
      },
      {
        "box": {
          "id": "obj-3",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "int"
          ],
          "patching_rect": [
            40,
            160,
            18.0,
            22.0
          ],
          "text": "+ 60"
        }
      },
      {
        "box": {
          "id": "obj-4",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            40,
            220,
            32.0,
            22.0
          ],
          "text": "mtof"
        }
      },
      {
        "box": {
          "id": "obj-5",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            40,
            280,
            43.0,
            22.0
          ],
          "text": "cycle~"
        }
      },
      {
        "box": {
          "id": "obj-6",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            40,
            340,
            20.0,
            22.0
          ],
          "text": "*~ 0.15"
        }
      },
      {
        "box": {
          "id": "obj-7",
          "maxclass": "ezdac~",
          "numinlets": 2,
          "numoutlets": 0,
          "patching_rect": [
            40,
            400,
            45.0,
            45.0
          ],
          "text": "ezdac~"
        }
      }
    ],
    "lines": [
      {
        "patchline": {
          "destination": [
            "obj-2",
            0
          ],
          "source": [
            "obj-1",
            0
          ],
          "midpoints": [
            null
          ]
        }
      },
      {
        "patchline": {
          "destination": [
            "obj-3",
            0
          ],
          "source": [
            "obj-2",
            0
          ],
          "midpoints": [
            null
          ]
        }
      },
      {
        "patchline": {
          "destination": [
            "obj-4",
            0
          ],
          "source": [
            "obj-3",
            0
          ],
          "midpoints": [
            null
          ]
        }
      },
      {
        "patchline": {
          "destination": [
            "obj-5",
            0
          ],
          "source": [
            "obj-4",
            0
          ],
          "midpoints": [
            null
          ]
        }
      },
      {
        "patchline": {
          "destination": [
            "obj-6",
            0
          ],
          "source": [
            "obj-5",
            0
          ],
          "midpoints": [
            null
          ]
        }
      },
      {
        "patchline": {
          "destination": [
            "obj-7",
            0
          ],
          "source": [
            "obj-6",
            0
          ],
          "midpoints": [
            null
          ]
        }
      },
      {
        "patchline": {
          "destination": [
            "obj-7",
            1
          ],
          "source": [
            "obj-6",
            0
          ],
          "midpoints": [
            null
          ]
        }
      }
    ],
    "dependency_cache": [],
    "autosave": 0
  }
}