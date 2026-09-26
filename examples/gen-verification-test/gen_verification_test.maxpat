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
          "maxclass": "comment",
          "numinlets": 1,
          "numoutlets": 0,
          "patching_rect": [
            110.0,
            30,
            150.0,
            20.0
          ],
          "text": "comment === GEN~ VERIFICATION TEST ==="
        }
      },
      {
        "box": {
          "id": "obj-2",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patcher": {
            "fileversion": 1,
            "appversion": {
              "major": 8,
              "minor": 1,
              "revision": 11,
              "architecture": "x64",
              "modernui": 1
            },
            "classnamespace": "dsp.gen",
            "rect": [
              0.0,
              0.0,
              600.0,
              450.0
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
                  "maxclass": "comment",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    130.0,
                    50,
                    150.0,
                    20.0
                  ],
                  "text": "comment --- MAIN SIGNAL PATH ---"
                }
              },
              {
                "box": {
                  "id": "obj-2",
                  "maxclass": "newobj",
                  "numinlets": 0,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    130.0,
                    80,
                    60.0,
                    22.0
                  ],
                  "text": "param freq 220"
                }
              },
              {
                "box": {
                  "id": "obj-3",
                  "maxclass": "newobj",
                  "numinlets": 2,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    130.0,
                    130,
                    60.0,
                    22.0
                  ],
                  "text": "phasor"
                }
              },
              {
                "box": {
                  "id": "obj-4",
                  "maxclass": "newobj",
                  "numinlets": 2,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    130.0,
                    180,
                    60.0,
                    22.0
                  ],
                  "text": "cycle"
                }
              },
              {
                "box": {
                  "id": "obj-5",
                  "maxclass": "newobj",
                  "numinlets": 2,
                  "numoutlets": 1,
                  "outlettype": [
                    "int"
                  ],
                  "patching_rect": [
                    130.0,
                    230,
                    18.0,
                    22.0
                  ],
                  "text": "* 0.8"
                }
              },
              {
                "box": {
                  "id": "obj-6",
                  "maxclass": "newobj",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    130.0,
                    350,
                    60.0,
                    22.0
                  ],
                  "text": "out 1"
                }
              },
              {
                "box": {
                  "id": "obj-7",
                  "maxclass": "comment",
                  "numinlets": 1,
                  "numoutlets": 0,
                  "patching_rect": [
                    380.0,
                    50,
                    150.0,
                    20.0
                  ],
                  "text": "comment --- VERIFICATION OPS ---"
                }
              },
              {
                "box": {
                  "id": "obj-8",
                  "maxclass": "newobj",
                  "numinlets": 1,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    380.0,
                    80,
                    60.0,
                    22.0
                  ],
                  "text": "history"
                }
              },
              {
                "box": {
                  "id": "obj-9",
                  "maxclass": "newobj",
                  "numinlets": 2,
                  "numoutlets": 1,
                  "outlettype": [
                    "int"
                  ],
                  "patching_rect": [
                    380.0,
                    130,
                    18.0,
                    22.0
                  ],
                  "text": "+"
                }
              },
              {
                "box": {
                  "id": "obj-10",
                  "maxclass": "newobj",
                  "numinlets": 3,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    380.0,
                    180,
                    60.0,
                    22.0
                  ],
                  "text": "wrap 0 1"
                }
              },
              {
                "box": {
                  "id": "obj-11",
                  "maxclass": "newobj",
                  "numinlets": 3,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    380.0,
                    230,
                    60.0,
                    22.0
                  ],
                  "text": "clip 0 1"
                }
              },
              {
                "box": {
                  "id": "obj-12",
                  "maxclass": "newobj",
                  "numinlets": 3,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    380.0,
                    280,
                    60.0,
                    22.0
                  ],
                  "text": "fold 0 1"
                }
              },
              {
                "box": {
                  "id": "obj-13",
                  "maxclass": "newobj",
                  "numinlets": 1,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    80.0,
                    160.0,
                    60.0,
                    22.0
                  ],
                  "text": "delta"
                }
              },
              {
                "box": {
                  "id": "obj-14",
                  "maxclass": "newobj",
                  "numinlets": 1,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    80.0,
                    210.0,
                    60.0,
                    22.0
                  ],
                  "text": "abs"
                }
              },
              {
                "box": {
                  "id": "obj-15",
                  "maxclass": "newobj",
                  "numinlets": 0,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    80.0,
                    280.0,
                    60.0,
                    22.0
                  ],
                  "text": "noise"
                }
              },
              {
                "box": {
                  "id": "obj-16",
                  "maxclass": "newobj",
                  "numinlets": 3,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    80.0,
                    330.0,
                    60.0,
                    22.0
                  ],
                  "text": "sah"
                }
              },
              {
                "box": {
                  "id": "obj-17",
                  "maxclass": "newobj",
                  "numinlets": 3,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    80.0,
                    390.0,
                    60.0,
                    22.0
                  ],
                  "text": "slide"
                }
              },
              {
                "box": {
                  "id": "obj-18",
                  "maxclass": "newobj",
                  "numinlets": 6,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    80.0,
                    450.0,
                    60.0,
                    22.0
                  ],
                  "text": "scale"
                }
              },
              {
                "box": {
                  "id": "obj-19",
                  "maxclass": "newobj",
                  "numinlets": 3,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    380.0,
                    330,
                    60.0,
                    22.0
                  ],
                  "text": "mix"
                }
              },
              {
                "box": {
                  "id": "obj-20",
                  "maxclass": "newobj",
                  "numinlets": 3,
                  "numoutlets": 1,
                  "outlettype": [
                    ""
                  ],
                  "patching_rect": [
                    380.0,
                    380,
                    60.0,
                    22.0
                  ],
                  "text": "switch 0"
                }
              }
            ],
            "lines": [
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
                    "obj-13",
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
                    "obj-8",
                    0
                  ],
                  "source": [
                    "obj-9",
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
                    "obj-14",
                    0
                  ],
                  "source": [
                    "obj-13",
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
                    "obj-16",
                    1
                  ],
                  "source": [
                    "obj-14",
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
                    "obj-16",
                    0
                  ],
                  "source": [
                    "obj-15",
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
                    "obj-17",
                    0
                  ],
                  "source": [
                    "obj-16",
                    0
                  ],
                  "midpoints": [
                    null
                  ]
                }
              }
            ]
          },
          "patching_rect": [
            110.0,
            60,
            36.0,
            22.0
          ],
          "text": "gen~"
        }
      },
      {
        "box": {
          "id": "obj-3",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            110.0,
            130,
            20.0,
            22.0
          ],
          "text": "*~ 0.3"
        }
      },
      {
        "box": {
          "id": "obj-4",
          "maxclass": "ezdac~",
          "numinlets": 2,
          "numoutlets": 0,
          "patching_rect": [
            110.0,
            200,
            45.0,
            45.0
          ],
          "text": "ezdac~"
        }
      },
      {
        "box": {
          "id": "obj-5",
          "maxclass": "scope~",
          "numinlets": 2,
          "numoutlets": 0,
          "patching_rect": [
            280.0,
            130,
            130.0,
            130.0
          ],
          "text": "scope~"
        }
      }
    ],
    "lines": [
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
            "obj-5",
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
            "obj-4",
            1
          ],
          "source": [
            "obj-3",
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